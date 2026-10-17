import { apiBase } from '../config/api';
import type { SaveData } from '../save/saveData';
import { TROPHIES_MAX, normalizeTrophies } from '../save/saveData';
import { type Gift, applyGift, giftFits, isReceivable } from '../gift/gifts';

/**
 * 郵便受け（v2.0-J。SPEC §7 S20）：トロフィあげと、贈り物（v2.7。大会パックなど。src/data/gifts.json の種類）。
 * いつ確かめるかは giftLink.ts（届け係の知らせ・つないだ時・使えない時は60秒ごと）。
 * 二重にも0にもならない順番（v2.7）：① 届いたものをセーブに入れる → ② サーバーに「受け取った」と返す → ③ サーバーが「渡し済み」にする。
 * ② が届かなければ、次に確かめた時にまた届くが、セーブにある番号（トロフィーの番号・贈り物の番号 giftIds）は足さずに ② だけやり直す。
 * ③ の前に切れても、郵便受けに残っているので0にはならない。
 */

const TIMEOUT_MS = 8000;

type Update = (fn: (d: SaveData) => void) => void;

/** 届いた演出を待っているもの（トロフィあげ：番号／贈り物：贈り物の番号・種類・数） */
export type ArrivalItem = { key: string; kind: 'trophy'; number: number } | { key: string; kind: 'gift'; giftId: number; giftKind: string; count: number };

const trophyItem = (number: number): ArrivalItem => ({ key: `t${number}`, kind: 'trophy', number });
const giftItem = (g: Gift): ArrivalItem => ({ key: `g${g.id}`, kind: 'gift', giftId: g.id, giftKind: g.kind, count: g.count });

/** 演出を待っているもの。閉じても次に開いた時に出せるように、端末にも書いておく */
const UNSEEN_KEY = 'oteca.trophyUnseen';
const ARRIVED_MAX = 200;
const arrived: ArrivalItem[] = readUnseen();
const listeners = new Set<() => void>();

function readUnseen(): ArrivalItem[] {
  try {
    const v = JSON.parse(globalThis.localStorage?.getItem(UNSEEN_KEY) ?? '[]') as unknown;
    if (!Array.isArray(v)) return [];
    const out: ArrivalItem[] = [];
    for (const x of v) {
      // v2.7 のはじめは、トロフィーの番号だけを書いていた
      if (Number.isInteger(x) && (x as number) >= 1) out.push(trophyItem(x as number));
      else if (x && typeof x === 'object') {
        const o = x as Record<string, unknown>;
        if (o.kind === 'trophy' && Number.isInteger(o.number)) out.push(trophyItem(o.number as number));
        if (o.kind === 'gift' && Number.isSafeInteger(o.giftId) && typeof o.giftKind === 'string' && Number.isInteger(o.count))
          out.push(giftItem({ id: o.giftId as number, kind: o.giftKind, count: o.count as number }));
      }
    }
    return out.slice(0, ARRIVED_MAX);
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
function pushArrived(item: ArrivalItem): void {
  if (!arrived.some((a) => a.key === item.key)) arrived.push(item);
}

/** 演出を待っているもの（届いた順） */
export function arrivedItems(): ArrivalItem[] {
  return [...arrived];
}

/** 演出を待っているトロフィーの番号 */
export function arrivedTrophies(): number[] {
  return arrived.flatMap((a) => (a.kind === 'trophy' ? [a.number] : []));
}

/** 1つ演出を出した（key） */
export function shownItem(key: string): void {
  const i = arrived.findIndex((a) => a.key === key);
  if (i >= 0) arrived.splice(i, 1);
  changed();
}

/** 1つ演出を出した（トロフィーの番号） */
export function shownArrived(n: number): void {
  shownItem(`t${n}`);
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

/** この起動で受け取ったもの（セーブの書き換えが画面に届く前に、もう一度確かめても二重にしない） */
const received = new Set<number>();
const receivedGifts = new Set<number>();

let checking: Promise<number[]> | null = null;
/** 確かめている間に、もう一度確かめてと言われた（知らせが続いた時など）。終わったらもう1回 */
let again = false;

/**
 * 郵便受けを確かめる（登録できている時だけ）。確かめている途中に呼ばれたら、終わってからもう1回だけ確かめる
 * @returns 新しく受け取ったトロフィーの番号（贈り物は arrivedItems で分かる）
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
  const body = (await res.json().catch(() => null)) as { trophies?: { number: number }[]; gifts?: Gift[] } | null;

  // トロフィあげ
  const have = new Set([...save.trophies.map((t) => t.number), ...received]);
  const got = [...new Set((body?.trophies ?? []).map((t) => t.number))].filter((n) => Number.isInteger(n) && n >= 1);
  // セーブに入るのは TROPHIES_MAX（100）個まで。入らない分は受け取らない（郵便受けに残し、知らせない）
  const fresh = got.filter((n) => !have.has(n)).slice(0, Math.max(0, TROPHIES_MAX - have.size));
  const taken = got.filter((n) => have.has(n) || fresh.includes(n));

  // 贈り物（知らない種類・おかしな数は受け取らない＝郵便受けに残す）
  const gifts = (Array.isArray(body?.gifts) ? body!.gifts : []).filter((g) => g && isReceivable(g));
  const haveGift = new Set([...save.giftIds, ...receivedGifts]);
  // 上限を超えて入らない贈り物は受け取らない（郵便受けに残す。順に入れてみて、入るものだけ）
  const room = { ownedPacks: { ...save.ownedPacks }, coins: save.coins, collection: { ...save.collection } };
  const freshGifts = gifts
    .filter((g) => !haveGift.has(g.id))
    .filter((g) => {
      if (!giftFits(room, g)) return false;
      const k = { ...room, giftIds: [] as number[] };
      applyGift(k, g);
      Object.assign(room, { ownedPacks: k.ownedPacks, coins: k.coins, collection: k.collection });
      return true;
    });
  const takenGifts = gifts.filter((g) => haveGift.has(g.id)).map((g) => g.id);

  let saved: number[] = [];
  let savedGifts: number[] = [];
  if (fresh.length || freshGifts.length) {
    // ① セーブに入れる（1回の保存で。同じ番号は二重にしない）。入ったのを確かめてから ② へ
    update((d) => {
      if (fresh.length) d.trophies = normalizeTrophies([...d.trophies, ...fresh.map((number) => ({ number, receivedAt: now }))]);
      for (const g of freshGifts) applyGift(d, g);
    });
    ({ trophies: saved, gifts: savedGifts } = await waitSaved(
      get,
      fresh,
      freshGifts.map((g) => g.id),
    ));
    for (const n of saved) {
      received.add(n);
      pushArrived(trophyItem(n));
    }
    for (const g of freshGifts.filter((x) => savedGifts.includes(x.id))) {
      receivedGifts.add(g.id);
      pushArrived(giftItem(g));
    }
    if (saved.length || savedGifts.length) changed();
  }
  // セーブに入らなかったものは「受け取った」と返さない（郵便受けに残る。0にしない）
  const ackList = taken.filter((n) => !fresh.includes(n) || saved.includes(n));
  const ackGifts = [...takenGifts, ...savedGifts];
  // ② 受け取ったと知らせる（前に知らせられなかった分も）→ ③ サーバーが渡し済みにする
  if (ackList.length || ackGifts.length)
    await call('/mailbox/ack', {
      method: 'POST',
      body: JSON.stringify({ userId: save.userId, token: save.ranking.token, numbers: ackList, giftIds: ackGifts }),
      headers: { 'content-type': 'text/plain;charset=UTF-8' },
    });
  return saved;
}

/** セーブの書き換えが入ったか（React の書き換えは次に描く時になることがある）。2秒まで待ち、入ったものを返す */
async function waitSaved(get: () => SaveData, nums: number[], giftIds: number[]): Promise<{ trophies: number[]; gifts: number[] }> {
  const inSave = () => {
    const d = get();
    const have = new Set(d.trophies.map((t) => t.number));
    return { trophies: nums.filter((n) => have.has(n)), gifts: giftIds.filter((id) => d.giftIds.includes(id)) };
  };
  for (let i = 0; i < 40; i++) {
    const got = inSave();
    if (got.trophies.length === nums.length && got.gifts.length === giftIds.length) return got;
    await new Promise((r) => setTimeout(r, 50));
  }
  return inSave();
}
