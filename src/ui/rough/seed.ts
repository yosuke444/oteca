import type { CSSProperties } from 'react';

/**
 * 要素ごとに固定の「乱数の種」と「傾き」を作る。
 * 同じキーからは必ず同じ値が出るので、再描画しても線の形・傾きが変わらない（SPEC §6-4, §6-5）。
 */

/** 文字列 → 1〜2^31-1 の整数（FNV-1a） */
export function seedFrom(key: string | number): number {
  const s = String(key);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return ((h >>> 0) % 0x7ffffffe) + 1;
}

/** キー → -max〜+max 度の傾き（既定 ±1.5°） */
export function tiltFrom(key: string | number, max = 1.5): number {
  const r = (seedFrom(`tilt:${key}`) % 10000) / 10000; // 0〜1
  return Math.round((r * 2 - 1) * max * 100) / 100;
}

/** style に渡す傾き（.tilt クラスと組み合わせて使う） */
export function tiltStyle(key: string | number, max = 1.5): CSSProperties {
  return { ['--tilt' as string]: `${tiltFrom(key, max)}deg` };
}
