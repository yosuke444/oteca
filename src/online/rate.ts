import { nextRate } from './rateMath';
import type { SaveData } from '../save/saveData';

/**
 * レート対戦の決まり（UPDATE_v2 §8-4・SPEC §7 S15）。画面にも通信にも関係しない、ふつうの処理だけ。
 */

export { expectedScore, nextRate } from './rateMath';
export { safeName } from './names';

/** レート対戦の結果：勝ち・負け・無効（ずれ・食い違い） */
export type RateOutcome = 'win' | 'lose' | 'void';

export type RateChange = { before: number; after: number; outcome: RateOutcome };

type RateSave = Pick<SaveData, 'rate' | 'rateStats' | 'lastRateOpponentId' | 'pendingRateMatch'>;

/** 試合が始まった：「レート対戦中」の印と、直前の相手を保存する（ページを閉じたら次に開いた時に負け） */
export function startRateMatch(draft: RateSave, opponentId: string, opponentRate: number): void {
  // 前の試合の印が残っていたら、先に負けとして計算する（印を残したまま次へ進むずるを防ぐ）
  resolvePendingRate(draft);
  draft.pendingRateMatch = { opponentId, opponentRate };
  draft.lastRateOpponentId = opponentId;
}

/**
 * 結果を書く（同じ保存で印も消す）。無効ならレートも勝敗も変えない。
 * opponentId を渡した時は、その相手との「レート対戦中」の印がある時だけ書く（別のタブで先に負けとして計算した後に、もう一度書かないように）
 */
export function applyRateResult(draft: RateSave, opponentRate: number, outcome: RateOutcome, opponentId?: string): RateChange | null {
  if (opponentId !== undefined && draft.pendingRateMatch?.opponentId !== opponentId) return null;
  const before = draft.rate;
  draft.pendingRateMatch = null;
  if (outcome === 'void') return { before, after: before, outcome };
  const win = outcome === 'win';
  draft.rate = nextRate(before, opponentRate, win);
  if (win) draft.rateStats.wins += 1;
  else draft.rateStats.losses += 1;
  draft.rateStats.best = Math.max(draft.rateStats.best, draft.rate);
  return { before, after: draft.rate, outcome };
}

/**
 * 起動した時：前のレート対戦が とちゅうで終わっていたら（ページを閉じた・読み込み直した）負けとして計算する。
 * @returns 計算した時はその結果（メニューで1回だけ知らせる）
 */
export function resolvePendingRate(draft: RateSave): RateChange | null {
  const p = draft.pendingRateMatch;
  if (!p) return null;
  return applyRateResult(draft, p.opponentRate, 'lose', p.opponentId);
}

/** 起動した時に とちゅうのレート対戦を負けにしたか（メニューで1回だけ知らせる） */
let pendingNotice: RateChange | null = null;

export function setPendingNotice(c: RateChange | null): void {
  pendingNotice = c;
}

/** メニューが読む（消すのは clearPendingNotice。StrictMode で2回読まれても同じものを返すように） */
export function peekPendingNotice(): RateChange | null {
  return pendingNotice;
}

export function clearPendingNotice(): void {
  pendingNotice = null;
}

/**
 * レート対戦の結果を決める（UPDATE_v2 §8-4「途中で終わった試合」。画面から呼ぶ）。
 * - disconnect（相手の通信が30秒もどらない・相手が部屋を出た）：残った側の勝ち。ただし自分がオフラインなら無効（自分で切って勝つのを防ぐ）
 * - 2人の結果がそろった：勝ち・負け。食い違った：無効
 * - 決着のあと結果がそろう前に相手が出ていった：自分の画面の勝敗（同じ操作を通しているので同じはず）
 * - まだ分からない：null
 * コインは、無効・切断の勝ちでは出さない（§5-3）
 */
export function rateOutcome(x: { reason: string; agree: boolean | null; win: boolean; oppGone: boolean; online: boolean }): { outcome: RateOutcome; coins: boolean } | null {
  if (x.reason === 'disconnect') return x.online ? { outcome: 'win', coins: false } : { outcome: 'void', coins: false };
  if (x.agree === true) return { outcome: x.win ? 'win' : 'lose', coins: true };
  if (x.agree === false) return { outcome: 'void', coins: false };
  if (x.oppGone) return { outcome: x.win ? 'win' : 'lose', coins: false };
  return null;
}
