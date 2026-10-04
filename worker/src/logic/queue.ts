/**
 * 受付係の待ち行列（UPDATE_v2 §8-4・§10、SPEC §11-9）。Cloudflare に関係しない、ふつうの処理だけ（テストしやすいように）。
 * - レートは使わない。待ち始めた順（joinedAt → seq）に組む。
 * - 直前の相手（どちらかが覚えていれば）・同じ playerId（同じセーブの別のタブ）・プロトコル版数の違う人とは組まない。
 * - 待っているのが直前の相手だけなら、ほかの人が来るまで待つ。
 */

export type Waiter = {
  /** WebSocket ごとの番号（受付係の中だけで使う） */
  id: string;
  playerId: string;
  protocol: number;
  lastOpponentId: string;
  name: string;
  rate: number;
  /** 待ち始めた時刻（ミリ秒） */
  joinedAt: number;
  /** 同じ時刻の時の順番 */
  seq: number;
};

/** この2人は組めるか */
export function canPair(a: Waiter, b: Waiter): boolean {
  if (a.protocol !== b.protocol) return false;
  if (a.playerId === b.playerId) return false;
  if (a.playerId === b.lastOpponentId || b.playerId === a.lastOpponentId) return false;
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
  const used = new Set<string>();
  const out: { a: Waiter; b: Waiter }[] = [];
  for (let i = 0; i < list.length; i++) {
    const a = list[i];
    if (used.has(a.id)) continue;
    for (let j = i + 1; j < list.length; j++) {
      const b = list[j];
      if (used.has(b.id) || !canPair(a, b)) continue;
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

/** 受け取った join の中身を確かめる（形の変なものは null） */
export function cleanJoin(x: unknown): Omit<Waiter, 'id' | 'joinedAt' | 'seq'> | null {
  if (!x || typeof x !== 'object') return null;
  const o = x as Record<string, unknown>;
  const id = (v: unknown) => (typeof v === 'string' && /^[0-9a-f]{16}$/.test(v) ? v : null);
  const playerId = id(o.playerId);
  if (!playerId) return null;
  if (!Number.isInteger(o.protocol) || (o.protocol as number) < 1 || (o.protocol as number) > 1000) return null;
  const name = typeof o.name === 'string' && o.name.trim() !== '' ? [...o.name.trim()].slice(0, 8).join('') : '';
  const rate = Number.isFinite(o.rate) ? Math.max(0, Math.min(100000, Math.round(o.rate as number))) : 100;
  return { playerId, protocol: o.protocol as number, lastOpponentId: id(o.lastOpponentId) ?? '', name, rate };
}
