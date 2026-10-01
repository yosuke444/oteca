/**
 * CPU が使う乱数（SPEC §13-5）。でたらめに選ぶ・見えない情報を仮に決める・試算のサイコロに使う。
 * ルールエンジンの乱数（GameState.rng）とは別。種を渡すと毎回同じ並びになる（テスト用）。
 */

/** 0 以上 1 未満の乱数 */
export type Rand = () => number;

/** 種付きの乱数（mulberry32） */
export function seededRand(seed: number): Rand {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 2 ** 32;
  };
}

/** 0〜n-1 の整数 */
export function randInt(rand: Rand, n: number): number {
  return Math.min(n - 1, Math.floor(rand() * n));
}

export function pick<T>(rand: Rand, list: readonly T[]): T {
  return list[randInt(rand, list.length)];
}

/** 並びを その場で混ぜる */
export function shuffle<T>(rand: Rand, list: T[]): T[] {
  for (let i = list.length - 1; i > 0; i--) {
    const j = randInt(rand, i + 1);
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}
