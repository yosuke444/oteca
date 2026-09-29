/** 手描きのサイコロの面（演出用の SVG） */

const PIPS: Record<number, [number, number][]> = {
  1: [[50, 50]],
  2: [[28, 28], [72, 72]],
  3: [[26, 26], [50, 50], [74, 74]],
  4: [[28, 28], [72, 28], [28, 72], [72, 72]],
  5: [[26, 26], [74, 26], [50, 50], [26, 74], [74, 74]],
  6: [[28, 24], [72, 24], [28, 50], [72, 50], [28, 76], [72, 76]],
};

/** face は 1〜6、または '?'（同じ目で振り直す時の顔） */
export function dieSvg(face: number | '?'): string {
  const body = `<path d="M14 6 Q50 2 86 7 Q95 9 94 18 Q97 50 93 84 Q91 94 82 94 Q50 97 17 93 Q6 92 6 82 Q3 50 7 16 Q8 7 14 6 Z" fill="var(--paper)" stroke="var(--ink)" stroke-width="4" stroke-linejoin="round"/>`;
  if (face === '?') {
    return `<svg viewBox="0 0 100 100">${body}<text x="50" y="72" text-anchor="middle" font-size="64" font-family="var(--font-hand)" fill="var(--pen-red)">?</text></svg>`;
  }
  const pips = (PIPS[face] ?? PIPS[1])
    .map(([x, y]) => `<circle cx="${x + (Math.random() - 0.5) * 2}" cy="${y + (Math.random() - 0.5) * 2}" r="${face === 1 ? 11 : 8.5}" fill="${face === 1 ? 'var(--pen-red)' : 'var(--ink)'}"/>`)
    .join('');
  return `<svg viewBox="0 0 100 100">${body}${pips}</svg>`;
}
