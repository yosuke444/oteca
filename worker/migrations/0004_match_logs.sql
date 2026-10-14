-- 実際の対戦のデータ（v2.7。カードのバランスを見るため）。人が分かる情報（名前・ユーザーID・部屋番号）は入れない。
-- 1試合1行（どちらか1人の端末だけが送る）。1日 MATCH_LOG_DAILY_MAX 行まで（D1 の書き込みの上限 1日10万回を超えないように）
CREATE TABLE IF NOT EXISTS match_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  -- 日本時間の日付（YYYYMMDD）と、記録した時刻
  day INTEGER NOT NULL,
  at INTEGER NOT NULL,
  -- rate（レート対戦）・friend（フレンド対戦）
  mode TEXT NOT NULL,
  -- 版の番号（ビルドID）とプロトコル版数
  build TEXT NOT NULL,
  protocol INTEGER NOT NULL,
  -- 両者のデッキ：[[カードNo, 枚数], …]（JSON）
  deck_a TEXT NOT NULL,
  deck_b TEXT NOT NULL,
  -- 勝ったデッキ：0＝deck_a、1＝deck_b、2＝勝ち負けなし（食い違い・無効）
  winner INTEGER NOT NULL,
  turns INTEGER NOT NULL,
  -- 終わり方：ko（気絶）・noBench（出せるおてあげが無い）・surrender（降参）・disconnect（通信切れ）
  reason TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS match_logs_at ON match_logs (at);

-- 1日に記録した数（上限を見るため。1行を書き直すだけ）
CREATE TABLE IF NOT EXISTS match_log_days (
  day INTEGER PRIMARY KEY,
  n INTEGER NOT NULL
);
