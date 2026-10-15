import { apiBase } from '../config/api';
import type { SaveData } from '../save/saveData';
import { TROPHIES_MAX, normalizeTrophies } from '../save/saveData';

/**
 * トロフィーの郵便受け（v2.0-J。SPEC §7 S20）。いつ確かめるかは giftLink.ts（v2.7：届け係の知らせ・つないだ時・使えない時は60秒ごと）。
 * 二重にも0枚にもならない順番（v2.7）：① 届いた番号をセーブに入れる → ② サーバーに「受け取った」と返す → ③ サーバーが「渡し済み」にする。
 * ② が届かなければ、次に確かめた時にまた届くが、セーブにある番号は足さずに ② だけやり直す（1つの番号は1枚だけ）。
 * ③ の前に切れても、郵便受けに残っているので0枚にはならない。
 */

const TIMEOUT_MS = 8000;

type Update = (fn: (d: SaveData) => void) => void;

/** 受け取ったトロフィー（演出を出すまで待っているもの）。閉じても次に開いた時に出せるように、端末にも書いておく */
const UNSEEN_KEY = 'oteca.trophyUnseen';
const arrived: number[] = readUnseen();
const listeners = new Set<() => void>();

function readUnseen(): number[] {
  try {
    const v = JSON.parse(globalThis.localStorage?.getItem(UNSEEN_KEY) ?? '[]') as unknown;
    return Array.isArray(v) ? v.filter((n): n is number => Number.isInteger(n) && n >= 1).slice(0, TROPHIES_MAX) : [];
  } catch {
    return [];
  }
}
function writeUnseen(): void {
  try {
    if (arrived.length) globalThis.localStorage?.setItem(UNSEEN_KEY, JSON.stringify(arrived));
    else globalThis.localStorage?.removeItem(UNSEEN_KEY);
  } catch {
    // 書けなくても、この起動の間は出せる
  }
}
function changed(): void {
  writeUnseen();
  for (const fn of listeners) fn();
}

/** 演出を待っているトロフィーの番号 */
export function arrivedTrophies(): number[] {
  return [...arrived];
}

/** 1つ演出を出した */
export function shownArrived(n: number): void {
  const i = arrived.indexOf(n);
  if (i >= 0) arrived.splice(i, 1);
  changed();
}

/** 演出を待っているものを全部消す（テスト用） */
export function clearArrived(): void {
  arrived.length = 0;
  changed();
}

export function onArrived(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

async function call(path: string, init?: RequestInit): Promise<Response | null> {
  const base = apiBase();
  if (!base) return null;
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    return await fetch(`${base}${path}`, { ...init, signal: ctl.signal });
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

/** この起動で受け取った番号（セーブの書き換えが画面に届く前に、もう一度確かめても二重にしない） */
const received = new Set<number>();

let checking: Promise<number[]> | null = null;
/** 確かめている間に、もう一度確かめてと言われた（知らせが続いた時など）。終わったらもう1回 */
let again = false;

/**
 * 郵便受けを確かめる（登録できている時だけ）。確かめている途中に呼ばれたら、終わってからもう1回だけ確かめる
 * @returns 新しく受け取った番号
 */
export function checkMailbox(save: SaveData | (() => SaveData), update: Update, now?: number): Promise<number[]> {
  const get = typeof save === 'function' ? save : () => save;
  if (checking) {
    again = true;
    return checking;
  }
  checking = (async () => {
    const out: number[] = [];
    do {
      again = false;
      out.push(...(await checkOnce(get, update, now ?? Date.now())));
    } while (again);
    return out;
  })().finally(() => {
    checking = null;
  });
  return checking;
}

async function checkOnce(get: () => SaveData, update: Update, now: number): Promise<number[]> {
  const save = get();
  if (!save.userIdRegistered || !save.ranking.token) return [];
  const res = await call(`/mailbox?userId=${save.userId}&token=${save.ranking.token}`);
  if (!res?.ok) return [];
  const body = (await res.json().catch(() => null)) as { trophies?: { number: number }[] } | null;
  const have = new Set([...save.trophies.map((t) => t.number), ...received]);
  const got = [...new Set((body?.trophies ?? []).map((t) => t.number))].filter((n) => Number.isInteger(n) && n >= 1);
  // セーブに入るのは TROPHIES_MAX（100）個まで。入らない分は受け取らない（郵便受けに残し、知らせない）
  const fresh = got.filter((n) => !have.has(n)).slice(0, Math.max(0, TROPHIES_MAX - have.size));
  const taken = got.filter((n) => have.has(n) || fresh.includes(n));
  let saved = fresh;
  if (fresh.length) {
    // ① セーブに入れる（同じ番号は1つだけ。normalizeTrophies が重ねない）。入ったのを確かめてから ② へ
    update((d) => {
      d.trophies = normalizeTrophies([...d.trophies, ...fresh.map((number) => ({ number, receivedAt: now }))]);
    });
    saved = await waitSaved(get, fresh);
    for (const n of saved) {
      received.add(n);
      if (!arrived.includes(n)) arrived.push(n);
    }
    if (saved.length) changed();
  }
  // セーブに入らなかった番号は「受け取った」と返さない（郵便受けに残る。0枚にしない）
  const ackList = taken.filter((n) => !fresh.includes(n) || saved.includes(n));
  // ② 受け取ったと知らせる（前に知らせられなかった分も）→ ③ サーバーが渡し済みにする
  if (ackList.length)
    await call('/mailbox/ack', {
      method: 'POST',
      body: JSON.stringify({ userId: save.userId, token: save.ranking.token, numbers: ackList }),
      headers: { 'content-type': 'text/plain;charset=UTF-8' },
    });
  return saved;
}

/** セーブの書き換えが入ったか（React の書き換えは次に描く時になることがある）。2秒まで待ち、入った番号を返す */
async function waitSaved(get: () => SaveData, nums: number[]): Promise<number[]> {
  const inSave = () => {
    const have = new Set(get().trophies.map((t) => t.number));
    return nums.filter((n) => have.has(n));
  };
  for (let i = 0; i < 40; i++) {
    const got = inSave();
    if (got.length === nums.length) return got;
    await new Promise((r) => setTimeout(r, 50));
  }
  return inSave();
}
