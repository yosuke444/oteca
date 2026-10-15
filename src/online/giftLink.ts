import { apiBase } from '../config/api';
import type { SaveData } from '../save/saveData';
import { checkMailbox } from './mailbox';

/**
 * トロフィあげを すぐ受け取る（v2.7。SPEC §7 S20）。
 * - ゲームを開いている間は、Worker の届け係（Durable Object・WebSocket の休止機能）と1本つないだままにする。
 *   管理画面で渡した瞬間に「とどいたよ」が来るので、郵便受け（/mailbox）を確かめる。待っている間は何も送らない。
 * - つないだ時も確かめる（閉じていた間・切れていた間に届いた物）。切れたら自動でつなぎ直す（失敗が続くほど間を空ける）。
 * - タブが裏に回ったら切る。表に戻ったら つなぎ直して確かめる。
 * - WebSocket が使えない・つながっていない間は、起動した時・メニューに戻った時・60秒ごとに確かめる。
 */

type Update = (fn: (d: SaveData) => void) => void;

/** つながっていない間に確かめる間隔 */
export const GIFT_POLL_MS = 60 * 1000;
/** つなぎ直すまでの待ち（失敗が続くほど長く） */
export const GIFT_RETRY_MS = [1000, 3000, 10000, 30000];
/** 一度もつながらずに続けて失敗したら、表に戻るまで つなぎ直さない（token が違う時など。その間は60秒ごとに確かめる） */
export const GIFT_MAX_FAILURES = 6;
/** 届け係が「ほかのつなぎに替えた」で切った時の番号（つなぎ直さない） */
export const GIFT_CLOSE_REPLACED = 4000;

export type GiftSocket = {
  onopen: (() => void) | null;
  onmessage: ((e: { data: unknown }) => void) | null;
  onclose: ((e?: { code?: number }) => void) | null;
  onerror: (() => void) | null;
  close: () => void;
};

type Doc = {
  visibilityState: string;
  addEventListener: (k: 'visibilitychange', fn: () => void) => void;
  removeEventListener: (k: 'visibilitychange', fn: () => void) => void;
};

export type GiftLinkDeps = {
  getSave: () => SaveData;
  update: Update;
  /** テスト用：WebSocket の代わり（null＝使えない） */
  openSocket?: ((url: string) => GiftSocket) | null;
  /** テスト用：確かめる処理 */
  check?: () => void;
  /** テスト用：document の代わり */
  doc?: Doc | null;
};

let current: { open: () => boolean; check: () => void } | null = null;

/** メニューに戻った（届け係につながっていない時だけ確かめる） */
export function giftMenuCheck(): void {
  if (current && !current.open()) current.check();
}

/** 届け係につながっているか（確かめ用） */
export function giftLinkOpen(): boolean {
  return current?.open() ?? false;
}

function defaultSocket(): ((url: string) => GiftSocket) | null {
  return typeof WebSocket === 'undefined' ? null : (url) => new WebSocket(url) as unknown as GiftSocket;
}

export function startGiftLink(deps: GiftLinkDeps): () => void {
  const open = deps.openSocket === undefined ? defaultSocket() : deps.openSocket;
  const doc = deps.doc === undefined ? (typeof document === 'undefined' ? null : document) : deps.doc;
  const check = deps.check ?? (() => void checkMailbox(deps.getSave, deps.update));
  let ws: GiftSocket | null = null;
  let isOpen = false;
  let failures = 0;
  let stopped = false;
  let retry: ReturnType<typeof setTimeout> | null = null;
  let poll: ReturnType<typeof setInterval> | null = null;
  const visible = () => !doc || doc.visibilityState !== 'hidden';

  const startPoll = () => {
    if (!poll && !stopped) poll = setInterval(() => visible() && !isOpen && check(), GIFT_POLL_MS);
  };
  const stopPoll = () => {
    if (poll) clearInterval(poll);
    poll = null;
  };
  const clearRetry = () => {
    if (retry) clearTimeout(retry);
    retry = null;
  };
  const drop = () => {
    const w = ws;
    ws = null;
    isOpen = false;
    if (!w) return;
    w.onclose = w.onopen = w.onmessage = w.onerror = null;
    try {
      w.close();
    } catch {
      // もう閉じている
    }
  };
  const connect = () => {
    clearRetry();
    if (stopped || ws || !visible()) return;
    const s = deps.getSave();
    const base = apiBase();
    if (!open || !base || !s.userIdRegistered || !s.ranking.token) {
      startPoll();
      return;
    }
    let sock: GiftSocket;
    try {
      sock = open(`${base.replace(/^http/, 'ws')}/gift-link?userId=${s.userId}&token=${s.ranking.token}`);
    } catch {
      startPoll();
      return;
    }
    ws = sock;
    sock.onopen = () => {
      isOpen = true;
      failures = 0;
      stopPoll();
      // 閉じていた間・切れていた間に届いた物
      check();
    };
    sock.onmessage = (e) => {
      if (typeof e.data === 'string' && e.data.includes('gift')) check();
    };
    sock.onerror = () => {};
    sock.onclose = (e) => {
      ws = null;
      isOpen = false;
      if (stopped) return;
      startPoll();
      // ほかのタブ・端末に替えられた・失敗が続いた：つなぎ直さない（60秒ごとに確かめる。表に戻った時に もう一度）
      if (!visible() || e?.code === GIFT_CLOSE_REPLACED || failures >= GIFT_MAX_FAILURES) return;
      retry = setTimeout(connect, GIFT_RETRY_MS[Math.min(failures, GIFT_RETRY_MS.length - 1)]);
      failures += 1;
    };
  };
  const onVisibility = () => {
    if (!visible()) {
      // 裏に回った：切る（表に戻った時につなぎ直す）
      clearRetry();
      stopPoll();
      drop();
      return;
    }
    failures = 0;
    // つなげる時は、つながった時に確かめる（2回確かめない）
    connect();
    if (!ws) {
      check();
      startPoll();
    }
  };

  doc?.addEventListener('visibilitychange', onVisibility);
  // 起動した時：つなぐ（つながった時に確かめる）。つなげなければ すぐ確かめ、60秒ごと
  connect();
  if (!ws) {
    check();
    startPoll();
  }
  const me = { open: () => isOpen, check };
  current = me;
  return () => {
    stopped = true;
    clearRetry();
    stopPoll();
    drop();
    doc?.removeEventListener('visibilitychange', onVisibility);
    if (current === me) current = null;
  };
}
