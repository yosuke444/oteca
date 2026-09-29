/**
 * 音の対応表（SPEC §10-2、§10-3）
 * BGM は企画者が public/audio/bgm/ に置く（ファイル名はここのキー。.mp3、同じ名前の .ogg もあれば併用）。
 * 効果音はプログラムで合成する（src/audio/sfx/recipes.ts）。
 * public/audio/se/<キー>.mp3 を置くと、合成音より優先して鳴る（今は使わない）。
 */

export type BgmKey = 'bgm_title' | 'bgm_deck' | 'bgm_lobby' | 'bgm_battle' | 'bgm_battle_pinch';

export type BgmInfo = {
  /** 使う場面（説明） */
  scene: string;
  /** ループの始まり（秒）。イントロ付きの曲はイントロの長さ。省略時は 0 */
  loopStart?: number;
  /** ループの終わり（秒）。mp3 の最後の無音を飛ばす時に。省略時は曲の最後 */
  loopEnd?: number;
  /** 大きさ（0〜1）。曲ごとの音量差をそろえる */
  volume?: number;
};

export const BGM: Record<BgmKey, BgmInfo> = {
  bgm_title: { scene: 'タイトル・メニュー' },
  bgm_deck: { scene: 'デッキ編集・設定・ルール' },
  bgm_lobby: { scene: 'ロビー待機' },
  bgm_battle: { scene: '対戦' },
  bgm_battle_pinch: { scene: 'どちらかがあと1体で勝つ状態になったら切り替え' },
};

/** BGM を置く場所 */
export const BGM_DIR = 'audio/bgm/';
/** 効果音をファイルで差し替える時の場所 */
export const SE_DIR = 'audio/se/';

/** BGM の切り替えにかける時間（秒）（§10-2 クロスフェード） */
export const BGM_CROSSFADE = 0.8;
/** 大ダメージ・きぜつの時に BGM を下げる時間（秒）と、下げた時の大きさ（§10-3） */
export const DUCK = { seconds: 0.4, level: 0.6 };

/** 効果音・ジングルのキー（§10-3 の表の順） */
export const SE_KEYS = [
  'se_click',
  'se_hover',
  'se_page',
  'se_pen',
  'se_stamp',
  'se_dice_roll',
  'se_dice_land',
  'se_card_draw',
  'se_card_place',
  'se_tape',
  'se_swap',
  'se_hit_small',
  'se_hit_big',
  'se_heal',
  'se_ko',
  'se_item_kusuri',
  'se_item_yaiba',
  'se_item_drink',
  'se_item_spodori',
  'se_turn_start',
  'se_error',
  'se_match_found',
  'se_stamp_chat',
  'jingle_win',
  'jingle_lose',
] as const;

export type SeKey = (typeof SE_KEYS)[number];

/** 試聴ページでの説明（§10-3 の表の「場面」） */
export const SE_LABEL: Record<SeKey, string> = {
  se_click: 'ボタンを おした',
  se_hover: 'ボタンに のせた',
  se_page: 'がめん きりかえ',
  se_pen: 'ペンで かく',
  se_stamp: 'はんこ',
  se_dice_roll: 'サイコロが ころがる',
  se_dice_land: 'サイコロが とまる',
  se_card_draw: 'カードを ひく',
  se_card_place: 'カードを おく',
  se_tape: 'テープを はる',
  se_swap: 'こうたい',
  se_hit_small: 'ダメージ（50いか）',
  se_hit_big: 'ダメージ（60いじょう）',
  se_heal: 'かいふく',
  se_ko: 'きぜつ',
  se_item_kusuri: 'かいふく アイテム',
  se_item_yaiba: 'こうげき アイテム',
  se_item_drink: 'ふしぎ アイテム',
  se_item_spodori: 'だいかいふく アイテム',
  se_turn_start: 'ターン かいし',
  se_error: 'できない そうさ',
  se_match_found: 'あいてが みつかった',
  se_stamp_chat: 'スタンプ',
  jingle_win: 'かち（ジングル）',
  jingle_lose: 'まけ（ジングル）',
};
