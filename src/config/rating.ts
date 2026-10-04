/**
 * レートの計算の数値（UPDATE_v2 §8-4・SPEC §7 S15）。イロレーティングの一種。
 * 期待勝率 E = 1 / (1 + 10 ^ ((相手 − 自分) / SCALE))、新しいレート = 自分 + K × (結果 − E)
 */
export const RATING = {
  /** 初期レート */
  initial: 100,
  /** 1試合で動く大きさ */
  k: 20,
  /** レートの差の目安（この差で期待勝率が約 91%） */
  scale: 200,
  /** これより下にはしない */
  min: 0,
} as const;

/**
 * ランキングの決まり（v2.0-I。UPDATE_v2 §10・SPEC §11-9）。ゲームと Worker（worker/）の両方で使う
 */
export const RANKING = {
  /** まとめ処理の時刻（日本時間の時。v2.0-J で1日2回、v2.2 で 14 → 16。worker/wrangler.toml の crons も UTC で合わせる）。「1日3試合」の1日は日本時間の 0:00〜24:00 */
  batchHoursJst: [4, 16],
  /** 片方だけの報告（相手の切断）を記録するまでの分 */
  singleReportMinutes: 10,
  /** 同じ2人が1日に数えられる試合の数 */
  pairDailyLimit: 3,
  /** 予備の待合所の試合を、1人が1日に数えられる数 */
  fallbackDailyLimit: 10,
  /** これだけの日数レートが変わっていない人は、表示から外す */
  hideAfterDays: 7,
  /** 一覧に載せる人数 */
  top: 100,
} as const;
