import rough from 'roughjs';
import type { Options } from 'roughjs/bin/core';

/**
 * rough.js の図形を React で描ける「パスの配列」に変換する。
 * 色には CSS変数（'var(--ink)' など）をそのまま渡せる（style として描くため）。
 */

const generator = rough.generator();

export type RoughPath = { d: string; stroke: string; strokeWidth: number; fill: string };

/** SPEC §6-5 の既定値：線 2〜3px、roughness 1.2〜1.8、bowing 1 */
export const ROUGH_DEFAULTS: Options = {
  stroke: 'var(--ink)',
  strokeWidth: 2.4,
  roughness: 1.5,
  bowing: 1,
  fillStyle: 'hachure',
  hachureGap: 7,
  fillWeight: 1.4,
};

function toList(drawable: ReturnType<typeof generator.path>): RoughPath[] {
  return generator.toPaths(drawable).map((p) => ({
    d: p.d,
    stroke: p.stroke,
    strokeWidth: p.strokeWidth,
    fill: p.fill ?? 'none',
  }));
}

/** 角丸四角のSVGパス文字列 */
export function roundRectD(x: number, y: number, w: number, h: number, r: number): string {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  return [
    `M${x + rr} ${y}`,
    `H${x + w - rr}`,
    `Q${x + w} ${y} ${x + w} ${y + rr}`,
    `V${y + h - rr}`,
    `Q${x + w} ${y + h} ${x + w - rr} ${y + h}`,
    `H${x + rr}`,
    `Q${x} ${y + h} ${x} ${y + h - rr}`,
    `V${y + rr}`,
    `Q${x} ${y} ${x + rr} ${y}`,
    'Z',
  ].join(' ');
}

export function roughPath(d: string, options: Options): RoughPath[] {
  return toList(generator.path(d, { ...ROUGH_DEFAULTS, ...options }));
}

export function roughLine(x1: number, y1: number, x2: number, y2: number, options: Options): RoughPath[] {
  return toList(generator.line(x1, y1, x2, y2, { ...ROUGH_DEFAULTS, ...options }));
}

export function roughEllipse(cx: number, cy: number, w: number, h: number, options: Options): RoughPath[] {
  return toList(generator.ellipse(cx, cy, w, h, { ...ROUGH_DEFAULTS, ...options }));
}
