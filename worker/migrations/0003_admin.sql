-- v2.0-J：管理者メニュー（SPEC §7 S20・§11-9）
-- 最後にゲームを開いてサーバーにつながった時刻（検索の「最後に遊んだ日」。1日1回まで書く）
ALTER TABLE players ADD COLUMN last_seen INTEGER NOT NULL DEFAULT 0;

-- トロフィー（番号は全体で1つだけ）。delivered：相手のゲームが受け取ったら 1（郵便受けから出す）
CREATE TABLE IF NOT EXISTS trophies (
  number INTEGER PRIMARY KEY,
  user_id TEXT NOT NULL,
  created INTEGER NOT NULL,
  delivered INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS trophies_user ON trophies (user_id, delivered);

-- アカウント停止（until：この時刻まで。0 ＝ ずっと）
CREATE TABLE IF NOT EXISTS suspensions (
  user_id TEXT PRIMARY KEY,
  until INTEGER NOT NULL,
  reason TEXT NOT NULL,
  created INTEGER NOT NULL
);

-- 管理者の操作の記録（いつ・何を・誰に・中身）
CREATE TABLE IF NOT EXISTS admin_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at INTEGER NOT NULL,
  action TEXT NOT NULL,
  target TEXT NOT NULL,
  detail TEXT NOT NULL
);

-- 管理者のパスワード（管理キー）を まちがえた数（接続元ごと。5回で1時間入れない）
CREATE TABLE IF NOT EXISTS admin_fails (
  ip TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  locked_until INTEGER NOT NULL
);

-- 管理の合言葉（ログインした時に作る。ハッシュだけ。12時間で切れる）
CREATE TABLE IF NOT EXISTS admin_sessions (
  token_hash TEXT PRIMARY KEY,
  expires INTEGER NOT NULL
);
