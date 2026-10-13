/**
 * 受付係の待ち行列（UPDATE_v2 §8-4・§10、SPEC §11-9）。Cloudflare に関係しない、ふつうの処理だけ（テストしやすいように）。
 * - レートは使わない。待ち始めた順（joinedAt → seq）に組む。
 * - 同じ playerId（同じセーブの別のタブ）・プロトコル版数の違う人とは組まない。
 * - 直前の相手（どちらかが覚えていれば）とは組まない。ただし、同じプロトコル版数で待っているのが2人だけの時は、
 *   直前の相手どうしでも組む（v2.7。3人以上いる時は今までどおり避ける）。
 */

import { isUserId } from '../../../src/save/userId';

/** 待っている人（playerId は、v2.0-J からはユーザーID（15桁）） */
export type Waiter = {
  /** WebSocket ごとの番号（受付係の中だけで使う） */
  id: string;
  playerId: string;
  protocol: number;
  lastOpponentId: string;
  name: string;
  /** レート（v2.2 からは D1 の正式なレート。Worker がつないだ時に読んで渡す） */
  rate: number;
  /** 配ったトロフィあげの数（v2.2。D1 の trophies から） */
  trophies: number;
  /** タブの印（v2.2。同じタブの入り直しは前の接続と置き換え、ほかのタブ・端末の同じユーザーID は断る。'' ＝無し） */
  tab: string;
  /** 待ち始めた時刻（ミリ秒） */
  joinedAt: number;
  /** 同じ時刻の時の順番 */
  seq: number;
};

/** 直前の相手どうしか（どちらかが覚えていれば） */
export function isLastOpponents(a: Pick<Waiter, 'playerId' | 'lastOpponentId'>, b: Pick<Waiter, 'playerId' | 'lastOpponentId'>): boolean {
  return a.playerId === b.lastOpponentId || b.playerId === a.lastOpponentId;
}

/**
 * この2人は組めるか。onlyTwo：同じプロトコル版数で待っているのがこの2人だけ（その時は直前の相手どうしでも組む。v2.7）
 */
export function canPair(a: Waiter, b: Waiter, onlyTwo = false): boolean {
  if (a.protocol !== b.protocol) return false;
  if (a.playerId === b.playerId) return false;
  if (!onlyTwo && isLastOpponents(a, b)) return false;
  return true;
}

/** 待ち始めた順 */
export function byJoin(a: Waiter, b: Waiter): number {
  return a.joinedAt - b.joinedAt || a.seq - b.seq || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/**
 * 組み合わせを作る：待ち始めた順に、まだ組んでいない人を、いちばん早く待ち始めた組める人と組む
 * @returns 組んだ2人（先に待っていた方が a）
 */
export function pickPairs(waiters: readonly Waiter[]): { a: Waiter; b: Waiter }[] {
  const list = [...waiters].sort(byJoin);
  // 同じプロトコル版数で待っている人数（2人だけなら、直前の相手どうしでも組む。v2.7）
  const counts = waitingCounts(list);
  const used = new Set<string>();
  const out: { a: Waiter; b: Waiter }[] = [];
  for (let i = 0; i < list.length; i++) {
    const a = list[i];
    if (used.has(a.id)) continue;
    for (let j = i + 1; j < list.length; j++) {
      const b = list[j];
      if (used.has(b.id) || !canPair(a, b, counts.get(a.protocol) === 2)) continue;
      used.add(a.id);
      used.add(b.id);
      out.push({ a, b });
      break;
    }
  }
  return out;
}

/** プロトコル版数ごとの、待っている人数 */
export function waitingCounts(waiters: readonly Waiter[]): Map<number, number> {
  const m = new Map<number, number>();
  for (const w of waiters) m.set(w.protocol, (m.get(w.protocol) ?? 0) + 1);
  return m;
}

/**
 * サーバーの記録（つないだ時に Worker が D1 から読んで、受付係の札に付けたもの）を読む。
 * 札は ["ユーザーID", "rate:123", "trophies:2"]。無ければ null（その時は端末が送ってきたレート・トロフィー 0）
 */
export function serverRecord(tags: readonly string[]): { rate: number; trophies: number } | null {
  const num = (prefix: string) => {
    const t = tags.find((x) => x.startsWith(prefix));
    const n = t ? Number(t.slice(prefix.length)) : NaN;
    return Number.isSafeInteger(n) && n >= 0 ? n : null;
  };
  const rate = num('rate:');
  const trophies = num('trophies:');
  return rate === null || trophies === null ? null : { rate, trophies };
}

/** 受け取った join の中身を確かめる（形の変なものは null） */
export function cleanJoin(x: unknown): Omit<Waiter, 'id' | 'joinedAt' | 'seq' | 'trophies'> | null {
  if (!x || typeof x !== 'object') return null;
  const o = x as Record<string, unknown>;
  // ユーザーID（v2.0-J。join では userId）
  const id = (v: unknown) => (isUserId(v) ? v : null);
  const playerId = id(o.userId);
  if (!playerId) return null;
  if (!Number.isInteger(o.protocol) || (o.protocol as number) < 1 || (o.protocol as number) > 1000) return null;
  const name = typeof o.name === 'string' && o.name.trim() !== '' ? [...o.name.trim()].slice(0, 8).join('') : '';
  const rate = Number.isFinite(o.rate) ? Math.max(0, Math.min(100000, Math.round(o.rate as number))) : 100;
  const tab = typeof o.tab === 'string' && /^[0-9a-f]{16}$/.test(o.tab) ? o.tab : '';
  return { playerId, protocol: o.protocol as number, lastOpponentId: id(o.lastOpponentId) ?? '', name, rate, tab };
}
