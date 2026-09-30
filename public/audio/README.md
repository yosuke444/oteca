# 音のファイルの置き方（オテカ）

## BGM（企画者が用意する）

`public/audio/bgm/` に、下の名前で置いてください。形式は `.mp3`。同じ名前の `.ogg` もあれば一緒に使います。
ファイルが無い間は、その場面は無音で動きます（エラーにはなりません）。

| ファイル名 | 使う場面 | ループ |
|---|---|---|
| `bgm_title.mp3` | タイトル・メニュー | する |
| `bgm_deck.mp3` | デッキ編集・設定・ルール | する |
| `bgm_lobby.mp3` | ロビー待機 | する |
| `bgm_battle.mp3` | 対戦 | する |
| `bgm_battle_pinch.mp3` | どちらかが あと1体で勝つ状態になったら切り替え | する |

- 場面が変わると、0.8秒かけて前の曲から次の曲へ切り替わります（クロスフェード）。
- イントロ付きの曲や、mp3 の最後の無音を飛ばしたい時は、`src/audio/soundMap.ts` の `BGM` の表に
  `loopStart`（ループの始まり、秒）・`loopEnd`（ループの終わり、秒）を書きます。
  例：`bgm_battle: { scene: '対戦', loopStart: 4.2, loopEnd: 68.0 }`
- 曲ごとの音量差は、同じ表の `volume`（0〜1）でそろえます。
- 大ダメージ・きぜつの瞬間は、BGM が0.4秒だけ小さくなります（効果音を目立たせるため）。

## 効果音・ジングル（プログラムで合成）

効果音と勝ち／負けのジングルは、音源ファイルを使わず、鳴らすその場で合成しています。
音の調整は `src/audio/sfx/recipes.ts` の数値だけで行います。
試聴は `?debug=1` を付けて開き、メニューの「こうかおん テスト」から。

将来ファイルに差し替えたい時だけ、`public/audio/se/<キー>.mp3`（例：`se_click.mp3`）を置くと、合成音より優先して鳴ります。

キー一覧：se_click / se_hover / se_page / se_pen / se_stamp / se_dice_roll / se_dice_land / se_card_draw / se_card_place / se_tape / se_swap / se_hit_small / se_hit_big / se_heal / se_ko / se_item_kusuri / se_item_yaiba / se_item_drink / se_item_spodori / se_turn_start / se_error / se_match_found / se_stamp_chat / jingle_win / jingle_lose
