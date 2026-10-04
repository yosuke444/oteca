/**
 * トロフィあげの数の見せ方（v2.2。SPEC §7 S15）：持っている数だけトロフィーの絵を並べる。
 * 5個までは絵で、6個目からは5個の絵の後に「+1」「+2」…と数で表す。0個なら何も出さない。
 */

/** 絵で出す数の上限 */
export const TROPHY_ICONS_MAX = 5;

/** 絵の数と、絵の後に数で出す分（0 なら数は出さない） */
export function trophyDisplay(count: number): { icons: number; more: number } {
  const n = Number.isSafeInteger(count) && count > 0 ? count : 0;
  return { icons: Math.min(n, TROPHY_ICONS_MAX), more: Math.max(0, n - TROPHY_ICONS_MAX) };
}

/** レート対戦の両者の記録（VS 画面と対戦中の名前の欄に出す。サーバーの記録） */
export type PlayerBadge = { rate: number; trophies: number };
