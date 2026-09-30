# 音のファイルの置き方（オテカ）

## BGM（企画者が用意する）

ファイルが無い間は、その場面は無音で動きます（エラーにはなりません）。形式は `.mp3`。同じ名前の `.ogg` もあれば一緒に使います。

### タイトル・デッキ編集・ロビーの曲（ループ再生）

`public/audio/bgm/` に、下の名前で置いてください。

| ファイル名 | 使う場面 | ループ |
|---|---|---|
| `bgm_title.mp3` | タイトル・メニュー | する |
| `bgm_deck.mp3` | デッキ編集・設定・ルール | する |
| `bgm_lobby.mp3` | ロビー待機 | する |

- イントロ付きの曲や、mp3 の最後の無音を飛ばしたい時は、`src/audio/soundMap.ts` の `BGM` の表に
  `loopStart`（ループの始まり、秒）・`loopEnd`（ループの終わり、秒）を書きます。
  例：`bgm_title: { scene: 'タイトル・メニュー', volume: 1, loopStart: 4.2, loopEnd: 40.0 }`

### 戦闘曲（対戦画面。何曲でも）

`public/audio/bgm/battle/` に、`battle_01.mp3`、`battle_02.mp3` … の名前で置いてください。

```
public/audio/bgm/battle/
├─ battle_01.mp3
├─ battle_02.mp3
│   …
└─ battle_13.mp3
```

- **曲を足す時は、`battle_14.mp3` のように次の番号で置くだけ** です。曲の数は自動で数えます。
  - 開発サーバー（`npm run dev`）：置くとページが自動で読み込み直されます。
  - 公開用ビルド（`npm run build`）：ビルドした時にフォルダにある曲が入ります。曲を足したらビルドし直してください。
- 流れ方：
  - 試合が始まるとランダムに1曲流れ、最後まで終わったら次の曲へ移ります（1曲のループはしません）。
  - シャッフル方式：全曲が一巡するまで同じ曲は流れません。一巡の切れ目でも同じ曲は続きません。
  - 再戦やページの読み込み直しの後も、直前に流れた曲とは違う曲から始まります。
  - 全曲を最初には読み込みません。流す曲だけ読み込み、次の曲は今の曲の残りが60秒になった時に先読みします。
  - 決着した時や対戦画面を出た時は、0.8秒で小さくなって止まります（そのあとジングル）。
- `bgm_battle.mp3`（1曲だけの戦闘曲）と `bgm_battle_pinch.mp3`（ピンチの曲）は、もう使いません。

### 音の大きさ

- 曲ごとの音量差は、`src/audio/soundMap.ts` の音量（`BGM` の `volume`、戦闘曲は `BATTLE_VOLUME`。0〜1）でそろえています。元のファイルは変えません。
- 新しく足した戦闘曲は、`BATTLE_VOLUME` に書くまで音量 1 で流れます。曲を足したら Claude Code に
  「新しい曲の音量をそろえて」と頼んでください（`node scripts/measure-bgm.mjs` で測って書き足します）。
- 効果音が BGM に埋もれないよう、BGM 全体を `BGM_LEVEL`（同じファイル）で小さくしています。
- 場面が変わると、0.8秒かけて前の曲から次の曲へ切り替わります（クロスフェード）。
- 大ダメージ・きぜつの瞬間は、BGM が0.4秒だけ小さくなります（効果音を目立たせるため）。

### 耳で確かめる

`?debug=1` を付けて開き、メニューの「こうかおん テスト」→ 下の「BGM」の行。
「せんとう（○きょく）」で戦闘曲、「きょくの おわりへ（のこり5びょう）」で曲の切りかわりを確かめられます。

## 効果音・ジングル（プログラムで合成）

効果音と勝ち／負けのジングルは、音源ファイルを使わず、鳴らすその場で合成しています。
音の調整は `src/audio/sfx/recipes.ts` の数値だけで行います。
試聴は `?debug=1` を付けて開き、メニューの「こうかおん テスト」から。

将来ファイルに差し替えたい時だけ、`public/audio/se/<キー>.mp3`（例：`se_click.mp3`）を置くと、合成音より優先して鳴ります。

キー一覧：se_click / se_hover / se_page / se_pen / se_stamp / se_dice_roll / se_dice_land / se_card_draw / se_card_place / se_tape / se_swap / se_hit_small / se_hit_big / se_heal / se_ko / se_item_kusuri / se_item_yaiba / se_item_drink / se_item_spodori / se_turn_start / se_error / se_match_found / se_stamp_chat / jingle_win / jingle_lose
