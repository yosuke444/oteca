-- v2.7：贈り物（トロフィあげ以外。大会パックなど。SPEC §7 S20・§11-9）
-- kind：src/data/gifts.json の種類の id。count：いくつ。delivered：相手のゲームが受け取ったら 1（郵便受けから出す）
CREATE TABLE IF NOT EXISTS gifts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  count INTEGER NOT NULL,
  created INTEGER NOT NULL,
  delivered INTEGER NOT NULL DEFAULT 0,
  delivered_at INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS gifts_user ON gifts (user_id, delivered);
