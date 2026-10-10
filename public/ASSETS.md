# 素材（画像・音楽）の置き場所とファイル名

ここに書いた場所・名前でファイルを置くと、自動で差し替わります。置いていない間は仮表示（音楽は無音）で動きます。
白い背景の画像は、乗算で方眼のノートになじませます。
絵は、元の画像を `assets-original/cards/`・`assets-original/story/`・`assets-original/packs/`・`assets-original/images/` に置き、`node scripts/prepare-art.mjs` で作り直してから使います（元の画像は公開しません）。
作り直し：まわりの余白と写りこんだ枠を切り落とし、縦横の比率を変えずに下の大きさの中に収めます（余った所は白。1枚 300KB 以下）。

| 種類 | 大きさ |
|---|---|
| おてあげのカード | 800×600 |
| アイテムのカード | 512×512 |
| ボス | 800×800 |
| パック | 600×900 |
| コイン・プレゼント・デイリーのアイコン | 256×256 |

トロフィあげ（v2.0-J）は、まだ仮の絵（手描きのトロフィー）のままです。絵を置いても読み込みません（届いた絵は `art_hold/` に置いておきます）。

## カード（`public/cards/`）

イラストだけの画像。無い時は「？」と名前の手描き枠。

| No | 名前 | 形 | ファイル名 |
|---|---|---|---|
| 1 | おてあげ | おてあげ（横4：縦3） | oteage.png |
| 2 | みつめ | おてあげ（横4：縦3） | mitsume.png |
| 3 | おてさげ | おてあげ（横4：縦3） | otesage.png |
| 4 | よつあし | おてあげ（横4：縦3） | yotsuashi.png |
| 5 | さんぼん | おてあげ（横4：縦3） | sanbon.png |
| 6 | むつあし | おてあげ（横4：縦3） | mutsuashi.png |
| 7 | レボリューション | おてあげ（横4：縦3） | revolution.png |
| 8 | かみ | おてあげ（横4：縦3） | kami.png |
| 9 | くすり | アイテム（正方形） | kusuri.png |
| 10 | ひみつのやいば | アイテム（正方形） | himitsu_yaiba.png |
| 11 | きみょうなドリンク | アイテム（正方形） | kimyou_drink.png |
| 12 | スポドリ | アイテム（正方形） | supodori.png |
| 13 | はさみ | おてあげ（横4：縦3） | hasami.png |
| 14 | よんほん | おてあげ（横4：縦3） | yonhon.png |
| 15 | やつあし | おてあげ（横4：縦3） | yatsuashi.png |
| 16 | しかく | おてあげ（横4：縦3） | shikaku.png |
| 17 | ばくはつ | おてあげ（横4：縦3） | bakuhatsu.png |
| 18 | ゆきだるま | おてあげ（横4：縦3） | yukidaruma.png |
| 19 | つのばさみ | おてあげ（横4：縦3） | tsunobasami.png |
| 20 | みつしかく | おてあげ（横4：縦3） | mitsushikaku.png |
| 21 | みつだるま | おてあげ（横4：縦3） | mitsudaruma.png |
| 22 | からあげ | おてあげ（横4：縦3） | karaage.png |
| 23 | とりあし | おてあげ（横4：縦3） | toriashi.png |
| 24 | はたあげ | おてあげ（横4：縦3） | hataage.png |
| 25 | かわいあげ | おてあげ（横4：縦3） | kawaiage.png |
| 26 | ぱわー | おてあげ（横4：縦3） | power.png |
| 27 | ばけあげ | おてあげ（横4：縦3） | bakeage.png |
| 28 | しょべるかー | おてあげ（横4：縦3） | shovelcar.png |
| 29 | ばくだん | おてあげ（横4：縦3） | bakudan.png |
| 30 | おおとろ | おてあげ（横4：縦3） | ootoro.png |
| 31 | ぶんぶんぶん | おてあげ（横4：縦3） | bunbunbun.png |
| 32 | たからばこ | おてあげ（横4：縦3） | takarabako.png |
| 33 | めでゅーさ | おてあげ（横4：縦3） | medusa.png |
| 34 | ぱからぱから | おてあげ（横4：縦3） | pakarapakara.png |
| 35 | 777ほん | おてあげ（横4：縦3） | hon777.png |
| 36 | ぴえろ | おてあげ（横4：縦3） | piero.png |
| 37 | さらしあげ | おてあげ（横4：縦3） | sarashiage.png |
| 38 | もやす | おてあげ（横4：縦3） | moyasu.png |
| 39 | どくさげ | おてあげ（横4：縦3） | dokusage.png |
| 40 | ともだち | おてあげ（横4：縦3） | tomodachi.png |
| 41 | ほそあげ | おてあげ（横4：縦3） | hosoage.png |
| 42 | すりむ | おてあげ（横4：縦3） | surimu.png |
| 43 | おてあげニンゲン | おてあげ（横4：縦3） | oteage_ningen.png |
| 44 | おてあげザムライ | おてあげ（横4：縦3） | oteage_zamurai.png |
| 45 | おてあげドラゴン | おてあげ（横4：縦3） | oteage_dragon.png |
| 46 | おてあげウサギ | おてあげ（横4：縦3） | oteage_usagi.png |
| 47 | ひきかえカード | アイテム（正方形） | hikikae.png |
| 48 | やばいつぼ | アイテム（正方形） | yabaitsubo.png |

## パック（`public/packs/`）

縦長 600×900 がおすすめ。無い時は、手描きの袋にパック名（元祖＝青、真＝赤、よせあつめ＝緑）。

| パック | ファイル名 |
|---|---|
| 元祖パック | pack_ganso.png |
| 真・パック | pack_shin.png |
| よせあつめパック | pack_yoseatsume.png |

## ボス（`public/story/`。ストーリーモード）

正方形 800×800 がおすすめ。無い時は、赤い手描き枠にボスの名前。

| ボス | ファイル名 |
|---|---|
| おてあげニンゲン | boss_ningen.png |
| おてあげザムライ | boss_zamurai.png |
| おてあげドラゴン | boss_dragon.png |
| おてあげウサギ | boss_usagi.png |

## その他の絵（`public/images/`）

| 絵 | ファイル名 | 無い時 |
|---|---|---|
| おてあげ（タイトル・メニュー・なまえ・チュートリアルの「おてあげせんせい」など） | otege_up.png | 何も出さない（まわりの並びはそのまま） |
| おてあげコイン | coin.png | 白旗の手描きコイン |
| プレゼントボックス | present.png | 手描きの箱 |
| デイリーミッション（メニューのアイコン） | daily.png | 手描きのチェックリスト |
| 受け取った後の空いた箱（v2.1-L） | present_open.png | 手描きの、ふたが開いて空っぽの箱 |

## 音楽（`public/audio/bgm/`）

効果音とジングルはプログラムで作るので、ファイルは要りません。音楽はループします。曲が無い場面は無音です。
曲を足したら `node scripts/measure-bgm.mjs` で音の大きさを測り、`src/audio/soundMap.ts` に書きます。

| 場面 | ファイル名 |
|---|---|
| タイトル・メニュー・なまえ | bgm_title.mp3 |
| デッキ編集・せってい・ルールせつめい・パックガチャ・カードトレード | bgm_deck.mp3 |
| ロビー・CPUたいせん の準備・ストーリーのステージ選択 | bgm_lobby.mp3 |
| 対戦・チュートリアル | battle/battle_01.mp3、battle/battle_02.mp3 …（数は自動。順番はシャッフル） |
| ボス戦（後で。4体共通） | bgm_boss.mp3 |
| ボス戦（後で。ボス別。置いた時だけ共通の曲の代わり） | bgm_boss_ningen.mp3、bgm_boss_zamurai.mp3、bgm_boss_dragon.mp3、bgm_boss_usagi.mp3 |
