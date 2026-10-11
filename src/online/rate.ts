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
/** 結果を書く時に使う形（古い形式の移行でも使うので、印は試合ID などが無くてもよい） */
type RateResultSave = Pick<SaveData, 'rate' | 'rateStats'> & { pendingRateMatch: { opponentId: string; opponentRate: number } | null };

/**
 * 組んだ相手と部屋で会えた：「レート対戦中」の印と、直前の相手を保存する。
 * 印は「まだ始まっていない」（準備中に切れたら勝ち負けを付けない）。準備が終わったら beginRateMatch で「始まった」にする（v2.4）
 * @param matchId 受付係の試合ID（無ければ ''。次に開いた時に負けを報告するのに使う）
 */
export function startRateMatch(draft: RateSave, opponentId: string, opponentRate: number, matchId = ''): void {
  // 前の試合の印が残っていたら、先に負けとして計算する（印を残したまま次へ進むずるを防ぐ）
  resolvePendingRate(draft);
  draft.pendingRateMatch = { opponentId, opponentRate, matchId, begun: false };
  draft.lastRateOpponentId = opponentId;
}

/** 準備が終わって対戦が始まった（この後にページを閉じたら、次に開いた時に負け。v2.4） */
export function beginRateMatch(draft: RateSave, opponentId: string): void {
  if (draft.pendingRateMatch?.opponentId === opponentId) draft.pendingRateMatch.begun = true;
}

/**
 * 結果を書く（同じ保存で印も消す）。無効ならレートも勝敗も変えない。
 * opponentId を渡した時は、その相手との「レート対戦中」の印がある時だけ書く（別のタブで先に負けとして計算した後に、もう一度書かないように）
 */
export function applyRateResult(draft: RateResultSave, opponentRate: number, outcome: RateOutcome, opponentId?: string): RateChange | null {
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
 * 起動した時：前のレート対戦が とちゅうで終わっていたら（ページを閉じた・読み込み直した・通信が切れたまま閉じた）負けとして計算する。
 * 準備が終わる前（始まる前）の試合は、勝ち負けを付けずに印だけ消す（v2.4）
 * @returns 負けとして計算した時はその結果（メニューで1回だけ知らせる）
 */
export function resolvePendingRate(draft: RateSave): RateChange | null {
  const p = draft.pendingRateMatch;
  if (!p) return null;
  if (!p.begun) {
    draft.pendingRateMatch = null;
    return null;
  }
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
 * - disconnect（相手の通信が30秒もどらない・相手が部屋を出た）：残った側の勝ち。ふだんの勝ちと同じコイン（両者2ターン以上の決まりは同じ。v2.4）。
 *   ただし自分がオフラインなら無効（自分で切って勝つのを防ぐ。オフラインの側は対戦の画面で負けにする）
 * - 2人の結果がそろった：勝ち・負け。食い違った：無効
 * - 決着のあと結果がそろう前に相手が出ていった：自分の画面の勝敗（同じ操作を通しているので同じはず）
 * - まだ分からない：null
 * コインは、無効の試合では出さない（§5-3）
 */
export function rateOutcome(x: { reason: string; agree: boolean | null; win: boolean; oppGone: boolean; online: boolean }): { outcome: RateOutcome; coins: boolean } | null {
  if (x.reason === 'disconnect') return x.online ? { outcome: 'win', coins: true } : { outcome: 'void', coins: false };
  if (x.agree === true) return { outcome: x.win ? 'win' : 'lose', coins: true };
  if (x.agree === false) return { outcome: 'void', coins: false };
  if (x.oppGone) return { outcome: x.win ? 'win' : 'lose', coins: false };
  return null;
}
