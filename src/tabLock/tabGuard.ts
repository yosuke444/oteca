/**
 * 複数のタブで同時に動かないようにする（v2.3。SPEC §12-1「1つのタブだけ」）
 * - 動いてよいタブは、いつも1つだけ。2つ目のタブは「ほかの タブで ひらいています」で止まり、セーブ・通信・BGM を動かさない
 * - 「この タブで あそぶ」で、動くタブを移せる（前のタブは「べつの タブで ひらかれました」で止まる）
 * - 仕組み：Web Locks API（navigator.locks）。使えないブラウザでは localStorage の「いまのタブ」の札と心拍で判定する
 * - どちらの仕組みでも、localStorage に「いまのタブ」の札（OWNER_KEY）を置く。セーブを書く直前に
 *   mayWriteSave() で「自分が動いてよいタブか」と「札が自分か」を確かめる（札は全部のタブから見えるので、
 *   札が届いたとたん、前のタブは書けなくなる。札が届くのが少し遅れることがあるので、移る側は TAKEOVER_GRACE_MS 待ってから動き出す）
 */

export type TabState =
  /** まだ始めていない（テスト・Node）。セーブは書ける */
  | 'off'
  /** 確かめ中（何も描かない・書かない） */
  | 'checking'
  /** このタブが動いている */
  | 'active'
  /** ほかのタブが動いている（このタブは最初から止まっている） */
  | 'blocked'
  /** べつのタブに移った（このタブは止まった） */
  | 'stolen';

type KeyValueStore = { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void };

/** 動いているタブの札（localStorage）。hidden：画面が見えていない（心拍が遅れても古いとみなさない） */
export type OwnerRecord = { id: string; t: number; battle: boolean; hidden?: boolean };

/** navigator.locks のうち使うところだけ */
export type LockLike = {
  request(name: string, opts: { ifAvailable?: boolean; steal?: boolean }, cb: (lock: unknown) => Promise<void>): Promise<void>;
};

export type TabEnv = {
  id: string;
  locks: LockLike | null;
  storage: KeyValueStore | null;
  now(): number;
  wait(ms: number): Promise<void>;
  setInterval(fn: () => void, ms: number): unknown;
  clearInterval(id: unknown): void;
  /** ほかのタブが localStorage を書いた時（storage イベント）。外す関数を返す */
  onStorage(fn: (key: string | null) => void): () => void;
  /** ページを閉じる・読み込み直す時 */
  onPageHide(fn: () => void): () => void;
  /** 画面が見えていないか（裏のタブ・最小化） */
  hidden(): boolean;
  /** 見える・見えないが変わった時 */
  onVisibility(fn: () => void): () => void;
};

export const LOCK_NAME = 'oteca-tab';
export const OWNER_KEY = 'oteca_tab';
/** 心拍（localStorage の時だけ）の間かく（ms） */
export const HEARTBEAT_MS = 1000;
/** 心拍がこれより古い札は、もう閉じたタブの札とみなす（ms） */
export const STALE_MS = 3500;
/**
 * 空いていなかった時に、もう一度確かめるまでの時間（ms）。読み込み直しの直後は、前のページがまだ鍵を持っていることがあるため
 */
export const RETRY_MS = [300, 600, 900];
/**
 * 「この タブで あそぶ」で札を書いてから、動き出すまで待つ時間（ms）。
 * 札（localStorage）がほかのタブに届くのは少し遅れることがあるので、前のタブが止まってからセーブを読む
 */
export const TAKEOVER_GRACE_MS = 300;

export class TabGuard {
  private st: TabState = 'off';
  private env: TabEnv | null = null;
  private listeners = new Set<(s: TabState) => void>();
  private release: (() => void) | null = null;
  private heartbeat: unknown = null;
  private battle = false;
  private offs: (() => void)[] = [];

  get state(): TabState {
    return this.st;
  }

  get id(): string | null {
    return this.env?.id ?? null;
  }

  subscribe(fn: (s: TabState) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** 始める。動いてよければ 'active'、ほかのタブが動いていれば 'blocked' */
  async start(env: TabEnv): Promise<TabState> {
    this.env = env;
    this.set('checking');
    this.offs.push(
      env.onStorage((key) => {
        if (key !== OWNER_KEY || this.st !== 'active') return;
        // 札がほかのタブに変わった：止まる
        const o = this.readOwner();
        if (o && o.id !== env.id) this.lose();
      }),
      env.onPageHide(() => {
        // 閉じる時は札を外す（読み込み直した次のページが、すぐ動けるように）
        if (this.st === 'active' && this.readOwner()?.id === env.id) this.removeOwner();
      }),
      env.onVisibility(() => {
        // 裏に回った・戻った：札の hidden を書き直す（裏のタブは心拍のタイマーが遅れるため）
        if (this.st === 'active' && this.ownerOk()) this.writeOwner();
      }),
    );
    for (let i = 0; i <= RETRY_MS.length; i++) {
      if (await this.tryAcquire(false)) return this.st;
      if (i < RETRY_MS.length) await env.wait(RETRY_MS[i]);
    }
    this.set('blocked');
    return this.st;
  }

  /** 「この タブで あそぶ」：動くタブをこのタブに移す */
  async takeOver(): Promise<void> {
    const env = this.env;
    if (!env || this.st === 'active') return;
    // 先に札を自分にする（前のタブは、札が届いた時点でセーブを書けなくなる）。届くのを少し待ってから動き出す
    this.writeOwner();
    await env.wait(TAKEOVER_GRACE_MS);
    await this.tryAcquire(true);
  }

  /** 動いているタブが対戦中か（「この タブで あそぶ」の確認に使う） */
  otherInBattle(): boolean {
    const o = this.readOwner();
    return !!o && o.id !== this.env?.id && o.battle;
  }

  /** 対戦中かを札に書く（動いているタブだけ） */
  setBattle(battle: boolean): void {
    this.battle = battle;
    if (this.st === 'active' && this.ownerOk()) this.writeOwner();
  }

  /**
   * セーブを書いてよいか（セーブを書く処理の直前に呼ぶ）。
   * 始めていない時（テスト）は書ける。止まったタブ・確かめ中のタブは書けない
   */
  mayWrite(): boolean {
    if (this.st === 'off') return true;
    if (this.st !== 'active') return false;
    if (this.ownerOk()) return true;
    // 札がほかのタブ：知らせ（storage イベント・鍵を取られた知らせ）より先に気づいた。ここで止まる
    this.lose();
    return false;
  }

  // ---------------------------------------------------------------- 内部

  private async tryAcquire(steal: boolean): Promise<boolean> {
    const env = this.env!;
    if (!env.locks) {
      // localStorage だけで判定：心拍の新しい ほかのタブの札があれば動けない
      const o = this.readOwner();
      if (!steal && o && o.id !== env.id && (o.hidden || env.now() - o.t < STALE_MS)) return false;
      this.claim();
      return true;
    }
    let got = false;
    let settle: () => void = () => {};
    const decided = new Promise<void>((r) => (settle = r));
    const held = env.locks.request(LOCK_NAME, steal ? { steal: true } : { ifAvailable: true }, (lock) => {
      if (!lock) {
        settle();
        return Promise.resolve();
      }
      got = true;
      this.claim();
      settle();
      // ページを閉じるまで（または取られるまで）持ち続ける
      return new Promise<void>((r) => (this.release = r));
    });
    held.catch(() => {
      // 鍵を取られた（steal）：止まる
      if (got && this.st === 'active') this.lose();
      settle();
    });
    await decided;
    return got;
  }

  private claim(): void {
    const env = this.env!;
    this.writeOwner();
    this.set('active');
    if (!env.locks) {
      // 心拍：札の時刻を新しくする。札がほかのタブに変わっていたら止まる
      this.heartbeat = env.setInterval(() => {
        if (this.st !== 'active') return;
        if (!this.ownerOk()) this.lose();
        else this.writeOwner();
      }, HEARTBEAT_MS);
    }
  }

  private lose(): void {
    if (this.heartbeat !== null) this.env?.clearInterval(this.heartbeat);
    this.heartbeat = null;
    this.release?.();
    this.release = null;
    this.set('stolen');
  }

  private ownerOk(): boolean {
    const env = this.env!;
    if (!env.storage) return true; // localStorage が使えない：鍵の知らせだけで判断する
    let raw: string | null;
    try {
      raw = env.storage.getItem(OWNER_KEY);
    } catch {
      return true;
    }
    if (raw === null) {
      // 札が消えていた（手で消した など）：自分の札を置き直す
      this.writeOwner();
      return true;
    }
    return parseOwner(raw)?.id === env.id;
  }

  private readOwner(): OwnerRecord | null {
    try {
      const raw = this.env?.storage?.getItem(OWNER_KEY);
      return raw ? parseOwner(raw) : null;
    } catch {
      return null;
    }
  }

  private writeOwner(): void {
    const env = this.env!;
    const rec: OwnerRecord = { id: env.id, t: env.now(), battle: this.battle, hidden: env.hidden() };
    try {
      env.storage?.setItem(OWNER_KEY, JSON.stringify(rec));
    } catch {
      // 書けない環境：鍵だけで判断する
    }
  }

  private removeOwner(): void {
    try {
      this.env?.storage?.removeItem(OWNER_KEY);
    } catch {
      // 何もしない
    }
  }

  private set(s: TabState): void {
    if (this.st === s) return;
    this.st = s;
    for (const fn of this.listeners) fn(s);
  }
}

function parseOwner(raw: string): OwnerRecord | null {
  try {
    const o = JSON.parse(raw) as Partial<OwnerRecord>;
    return typeof o.id === 'string' && typeof o.t === 'number' ? { id: o.id, t: o.t, battle: !!o.battle, hidden: !!o.hidden } : null;
  } catch {
    return null;
  }
}

/** アプリ全体で1つ */
export const tabGuard = new TabGuard();

/** セーブを書いてよいか（cookieStore の persist・wipe が書く直前に呼ぶ） */
export function mayWriteSave(): boolean {
  return tabGuard.mayWrite();
}

/** ブラウザの道具で始める */
export function browserTabEnv(): TabEnv {
  let storage: KeyValueStore | null = null;
  try {
    storage = window.localStorage;
  } catch {
    storage = null;
  }
  const locks = (navigator as Navigator & { locks?: LockLike }).locks ?? null;
  const b = new Uint8Array(8);
  crypto.getRandomValues(b);
  return {
    id: [...b].map((x) => x.toString(16).padStart(2, '0')).join(''),
    locks: locks && typeof locks.request === 'function' ? locks : null,
    storage,
    now: () => Date.now(),
    wait: (ms) => new Promise((r) => window.setTimeout(r, ms)),
    setInterval: (fn, ms) => window.setInterval(fn, ms),
    clearInterval: (id) => window.clearInterval(id as number),
    onStorage: (fn) => {
      const h = (e: StorageEvent) => fn(e.key);
      window.addEventListener('storage', h);
      return () => window.removeEventListener('storage', h);
    },
    onPageHide: (fn) => {
      window.addEventListener('pagehide', fn);
      return () => window.removeEventListener('pagehide', fn);
    },
    hidden: () => document.visibilityState === 'hidden',
    onVisibility: (fn) => {
      document.addEventListener('visibilitychange', fn);
      return () => document.removeEventListener('visibilitychange', fn);
    },
  };
}
