-- ランキングのデータベース（D1。UPDATE_v2 §10・SPEC §11-9）
-- プレイヤー表：1人1行。token はハッシュだけ保存する
CREATE TABLE IF NOT EXISTS players (
  id TEXT PRIMARY KEY,              -- セーブの playerId（16桁の16進数）
  token_hash TEXT NOT NULL,         -- token の SHA-256（16進数）
  rate INTEGER NOT NULL DEFAULT 100,
  wins INTEGER NOT NULL DEFAULT 0,
  losses INTEGER NOT NULL DEFAULT 0,
  best INTEGER NOT NULL DEFAULT 100,
  name TEXT NOT NULL DEFAULT '',
  opt_in INTEGER NOT NULL DEFAULT 1,   -- 1＝名前を載せる
  name_banned INTEGER NOT NULL DEFAULT 0, -- 1＝管理キーで名前を消した（「ななし」）
  last_played INTEGER NOT NULL DEFAULT 0, -- 最後に数えた試合のあった まとめ処理の時刻（ミリ秒）
  rank INTEGER,                     -- 順位（表示から外れた人は NULL）
  created INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS players_rank ON players (rank);

-- まとめ処理で作るもの（上位100人の写し・最後の更新の時刻）
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
