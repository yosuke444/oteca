import { lastBatchAt, nextBatchAt } from '../../../src/online/batchTime';

/**
 * ランキングの更新の時刻（v2.7。SPEC §11-9）。ふつうの処理だけ（テストしやすいように）。
 * Cloudflare の Cron は、予定の時刻から数十秒〜10分ほど遅れて動くことがある（記録：最大 8分52秒）。
 * 受付係（Durable Object）の目覚まし（alarm）でも予定の時刻ちょうどに動かし、先に動いた方が更新する（後の方は何もしない）
 */

/** 1回の更新で計算する試合の数（多ければ何回かに分けて、続きは1秒後の目覚ましで） */
export const BATCH_CHUNK = 2000;
/** 続きを計算するまでの待ち */
export const BATCH_CONTINUE_MS = 1000;

/**
 * 予定の更新（Cron・目覚まし）で計算するか：その回の更新がまだ済んでいない、または前の続きが残っている時だけ。
 * 2回動いても、2回目は何もしない（結果が同じ）
 */
export function shouldRunScheduled(updatedAt: number, now: number, more: boolean): boolean {
  return more || updatedAt < lastBatchAt(now);
}

/**
 * ランキングを返す時の「次の更新」：
 * - その回の更新が済んでいれば、次の予定の時刻（updating: false）
 * - 予定の時刻を過ぎたのに まだ済んでいなければ、その予定の時刻（過ぎている）と updating: true。
 *   端末は時間を延ばして見せずに「こうしん ちゅう…」と出し、30秒ごとに聞き直す
 */
export function rankingTiming(updatedAt: number, now: number): { nextAt: number; updating: boolean } {
  const slot = lastBatchAt(now);
  if (updatedAt > 0 && updatedAt < slot) return { nextAt: slot, updating: true };
  return { nextAt: nextBatchAt(now), updating: false };
}
