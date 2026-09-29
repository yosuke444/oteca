/**
 * 種付き疑似乱数（xoshiro128**）。SPEC §11-3・§11-4
 * 内部状態は GameState.rng に入れて持ち運ぶ（状態の一部としてハッシュにも含まれる）。
 * Math.random() はエンジンで使わない。
 */

export type RngState = [number, number, number, number];

/** 文字列の種 → 128bit の初期状態（cyrb128） */
export function seedRng(seed: string): RngState {
  let h1 = 1779033703;
  let h2 = 3144134277;
  let h3 = 1013904242;
  let h4 = 2773480762;
  for (let i = 0; i < seed.length; i++) {
    const k = seed.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  h1 ^= h2 ^ h3 ^ h4;
  h2 ^= h1;
  h3 ^= h1;
  h4 ^= h1;
  const st: RngState = [h1 >>> 0, h2 >>> 0, h3 >>> 0, h4 >>> 0];
  // 全部0だと乱数が止まるので避ける
  if ((st[0] | st[1] | st[2] | st[3]) === 0) st[0] = 1;
  return st;
}

/** 次の 32bit 符号なし整数（st を書き換える） */
export function nextU32(st: RngState): number {
  const result = Math.imul(rotl(Math.imul(st[1], 5), 7), 9) >>> 0;
  const t = st[1] << 9;
  st[2] ^= st[0];
  st[3] ^= st[1];
  st[1] ^= st[2];
  st[0] ^= st[3];
  st[2] ^= t;
  st[3] = rotl(st[3], 11);
  for (let i = 0; i < 4; i++) st[i] >>>= 0;
  return result;
}

/** 0 以上 n 未満の整数（偏りなし） */
export function nextInt(st: RngState, n: number): number {
  const limit = Math.floor(0x100000000 / n) * n;
  let x = nextU32(st);
  while (x >= limit) x = nextU32(st);
  return x % n;
}

/** 配列をその場で切る（Fisher–Yates） */
export function shuffleInPlace<T>(st: RngState, arr: T[]): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = nextInt(st, i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

function rotl(x: number, k: number): number {
  return (x << k) | (x >>> (32 - k));
}
