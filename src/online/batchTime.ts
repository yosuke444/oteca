import { RANKING } from '../config/rating';

/**
 * まとめ処理（レートとランキングの更新）の時刻（v2.0-J。毎日 日本時間 4:00 と 16:00 の1日2回）。
 * ゲームと Worker（worker/）の両方で使う。ふつうの計算だけ。
 */

/** 日本時間 = UTC + 9時間 */
const JST_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

/** 日本時間の日付（YYYYMMDD）。予備の待合所の試合の「1日10試合」の1日はこれ（日本時間 0:00〜24:00） */
export function jstDay(ms: number): number {
  const d = new Date(ms + JST_MS);
  return d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate();
}

/** その日（日本時間）の0時の時刻 */
function jstMidnight(ms: number): number {
  return Math.floor((ms + JST_MS) / DAY_MS) * DAY_MS - JST_MS;
}

/** 次のまとめ処理の時刻（4:00 と 16:00 の近い方。ちょうどその時刻なら次） */
export function nextBatchAt(now: number): number {
  const base = jstMidnight(now);
  for (const day of [0, 1]) {
    for (const h of [...RANKING.batchHoursJst].sort((a, b) => a - b)) {
      const t = base + day * DAY_MS + h * HOUR_MS;
      if (t > now) return t;
    }
  }
  return base + 2 * DAY_MS;
}

/** 前のまとめ処理の時刻（その時刻ちょうどなら、その時刻） */
export function lastBatchAt(now: number): number {
  const base = jstMidnight(now);
  for (const day of [0, -1]) {
    for (const h of [...RANKING.batchHoursJst].sort((a, b) => b - a)) {
      const t = base + day * DAY_MS + h * HOUR_MS;
      if (t <= now) return t;
    }
  }
  return base - DAY_MS;
}
