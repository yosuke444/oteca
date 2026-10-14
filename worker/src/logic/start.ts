/**
 * レート対戦が「始まった」「つながらなかった」の記録（v2.7）。ふつうの処理だけ（テストしやすいように）。
 * 受付係が2人を組んだ後、端末が対戦を始められたら started、組んでから15秒たっても始まらなければ failed を知らせる。
 * つながらなかった2人は、もう一度さがす時に retryOf（その試合ID）を付け、待機の列の先頭に入る
 */

export type StartState = 'started' | 'failed';

/** 記録を残す日数 */
export const START_KEEP_DAYS = 30;
/** つながらなかった後、先頭に入れてもらえるのは組んでからこの時間まで */
export const RETRY_FRONT_MS = 2 * 60 * 1000;

/** 端末からの知らせの形を確かめる */
export function cleanStartReport(x: unknown): { matchId: string; state: StartState } | null {
  if (!x || typeof x !== 'object') return null;
  const o = x as Record<string, unknown>;
  if (typeof o.matchId !== 'string' || !/^[0-9a-f]{16}$/.test(o.matchId)) return null;
  if (o.state !== 'started' && o.state !== 'failed') return null;
  return { matchId: o.matchId, state: o.state };
}

/** 前の記録と新しい知らせ → 記録する状態（どちらかが始まったと言えば started。started を failed で上書きしない） */
export function mergeStart(prev: StartState | null, next: StartState): StartState {
  return prev === 'started' || next === 'started' ? 'started' : 'failed';
}

/**
 * もう一度さがす人を、待機の列の先頭に入れるか：その試合の2人のどちらかで、まだ始まっておらず、組んでから2分以内
 */
export function retryFront(game: { a: string; b: string; created: number } | null, state: StartState | null, playerId: string, now: number): boolean {
  if (!game) return false;
  if (game.a !== playerId && game.b !== playerId) return false;
  if (state === 'started') return false;
  return now - game.created <= RETRY_FRONT_MS;
}
