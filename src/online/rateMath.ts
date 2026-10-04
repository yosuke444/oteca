import { RATING } from '../config/rating';

/**
 * レートの式（UPDATE_v2 §8-4）。画面・セーブにも通信にも関係しない、式だけ。
 * ゲーム（かりのレート）と Worker（正式なレート。worker/）の両方で使う。
 */

/** 期待勝率 */
export function expectedScore(mine: number, theirs: number): number {
  return 1 / (1 + Math.pow(10, (theirs - mine) / RATING.scale));
}

/** 新しいレート（小数は四捨五入、0 未満にしない） */
export function nextRate(mine: number, theirs: number, win: boolean): number {
  const v = mine + RATING.k * ((win ? 1 : 0) - expectedScore(mine, theirs));
  return Math.max(RATING.min, Math.round(v));
}
