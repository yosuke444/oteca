# oteca-api（レート対戦の受付係とランキングのサーバー）

Cloudflare の無料プランで動く Worker です（UPDATE_v2 §10・SPEC §11-9）。

- **受付係**（Durable Object `Matchmaker`。SQLite 保存・休止機能）：レート対戦の待ち行列、組んだ試合、2人の結果の報告。
- **ランキングのデータベース**（D1 `oteca-ranking`）：プレイヤー表（1人1行）と、上位100人の写し。
- **まとめ処理**（Cron。毎日 UTC 19:00 ＝ 日本時間 4:00 と、UTC 5:00 ＝ 日本時間 14:00 の1日2回）：前回より後の結果からレートと順位を計算する。重い計算なので受付係の中で動かす。
- 公開先：https://oteca-api.oteca-api.workers.dev

無料プランのまま上限を超えた時は、その日の残りの時間はエラーになるだけで、料金はかかりません。

## フォルダの中身

| ファイル | 中身 |
|---|---|
| `src/index.ts` | 入口（CORS・登録・報告・ランキング・管理用の道・Cron） |
| `src/matchmaker.ts` | 受付係（Durable Object） |
| `src/ranking.ts` | D1 を書く処理（まとめ処理・順位・上位100人の写し） |
| `src/logic/` | ふつうの計算（待ち行列・結果の突き合わせ・レートの計算）。ゲームの `npm test` でテストする |
| `migrations/` | D1 の表 |
| `wrangler.toml` | 設定（名前・Durable Object・D1・Cron） |
| `LOAD.md` | 負荷の見積もり（`npm run worker:load` で作り直す） |
| `.admin-key.txt` | **管理キー（秘密。git に入れない）** |

## 公開のしかた（もう公開済み。直した時だけ）

ターミナルで、`oteca` フォルダから1行ずつ打ちます。

1. `cd worker`
2. （初めての時だけ）`npm install`（wrangler 4.147.0 が入ります）
3. `npx wrangler deploy`
4. 最後に `https://oteca-api.oteca-api.workers.dev` と出れば成功です。
5. `cd ..` で元のフォルダに戻ります。

D1 の表を変えた時（`migrations/` に新しいファイルを足した時）は、3 の前に `npx wrangler d1 migrations apply oteca-ranking --remote` を打ちます。

## 管理キー

- 値は `worker/.admin-key.txt` にあります（64文字。この PC の中だけ。git には入りません）。
- サーバーには `wrangler secret` で設定してあります。変える時は、`worker` フォルダで `npx wrangler secret put ADMIN_KEY` を打ち、聞かれたら新しい値を貼り付けます（`.admin-key.txt` も同じ値に書き換える）。

## 不適切な名前を消す（「ななし」にする）

ターミナルの「Git Bash」で、`oteca` フォルダから打ちます。

1. 名前で探して、その人の `id` を調べます（`みどり` の所を、消したい名前の一部に変える）。

   ```
   curl -X POST -H "x-admin-key: $(cat worker/.admin-key.txt)" -H "content-type: application/json" -d '{"name":"みどり"}' https://oteca-api.oteca-api.workers.dev/admin/lookup
   ```

2. 出てきた `"id":"…"`（16文字）を使って消します。

   ```
   curl -X POST -H "x-admin-key: $(cat worker/.admin-key.txt)" -H "content-type: application/json" -d '{"playerId":"ここに id"}' https://oteca-api.oteca-api.workers.dev/admin/hide-name
   ```

   `{"ok":true,"changed":1}` と出れば成功です。ランキングの一覧からもすぐ消えます（ただし、ゲームの画面は次の更新（4:00 か 14:00）まで前の一覧を覚えているので、そこではその時刻に消えます）。

3. 元に戻す時は、`"playerId"` の後に `,"hidden":false` を足して同じように打ちます。

## まとめ処理を手で動かす（確かめる時用）

```
curl -X POST -H "x-admin-key: $(cat worker/.admin-key.txt)" https://oteca-api.oteca-api.workers.dev/admin/run-batch
```

`{"ok":true,"results":…,"counted":…}` と出ます（results＝読んだ試合、counted＝レートに数えた試合、skipped＝同じ2人の4試合目から）。
ゲームを開き直すと「かり」が消えて、正式なレートになります。ランキングの画面は、端末が前の一覧を覚えているので、ブラウザの開発者ツールで localStorage の `oteca.rankingCache` を消すか、次の更新（4:00 か 14:00）を待ちます。

## そのほかの管理用の道（すべて管理キーが要る）

| 道 | 中身 |
|---|---|
| `POST /admin/stats` | 受付係の様子（報告待ちの試合・記録した結果・待っている人）とプレイヤーの人数 |
| `POST /admin/delete-players` | `{"playerIds":[…]}` のプレイヤーを消す（テストの後片づけ） |
| `POST /admin/clear-games` | `{"playerIds":[…]}` の人の試合（報告待ち・まだ処理していない結果）を消す（テストの後片づけ） |
| `POST /admin/seed` | 試合結果を直接入れる（負荷の見積もり用。公開した所では使わない） |

## 手元で動かす・テスト

| コマンド（`oteca` フォルダで） | 中身 |
|---|---|
| `npm run test:worker` | 計算のテスト ＋ 手元の Worker（wrangler dev）で登録・受付係・報告・まとめ処理・ランキング・CORS・管理キーを確かめる |
| `npm run worker:load` | 負荷の見積もり（`worker/LOAD.md` を作り直す） |
| `cd worker` → `npm run dev` | 手元の Worker（http://localhost:8787）。ゲームを `?api=local` 付きで開くと、こちらにつなぐ |

ゲームの URL に付けられるもの（開発用）：`?api=local`（手元の Worker）、`?api=off`（サーバーを使わない）、`?lobby=off`（受付係だけ使わない＝予備の待合所）。

型の確かめ（`npx tsc -p worker`）の前に、`cd worker` → `npx wrangler types` で `worker-configuration.d.ts` を作ってください（自動で作られるファイルなので git には入れていません）。
