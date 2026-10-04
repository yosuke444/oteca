-- v2.0-J：ユーザーID（SPEC §11-9）
-- players.id には、これからはユーザーID（15桁の数字）を入れる（今までの playerId の行は、本人が登録した時にユーザーID に付け替える）
-- 最後に数えた試合の試合ID（端末が「自分の最後の試合が数えられたか」を比べる）
ALTER TABLE players ADD COLUMN last_match TEXT NOT NULL DEFAULT '';
