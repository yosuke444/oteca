import battleList from 'virtual:battle-bgm';

/**
 * 音の対応表（SPEC §10-2、§10-3）
 * BGM は企画者が public/audio/bgm/ に置く（ファイル名はここのキー。.mp3、同じ名前の .ogg もあれば併用）。
 * 戦闘曲は public/audio/bgm/battle/ に battle_01.mp3 … を置く（数は自動で数える。曲を足す時は置くだけ）。
 * 効果音はプログラムで合成する（src/audio/sfx/recipes.ts）。
 * public/audio/se/<キー>.mp3 を置くと、合成音より優先して鳴る（今は使わない）。
 */

/** ループで流す曲（タイトル・デッキ編集・ロビー） */
export type LoopBgmKey = 'bgm_title' | 'bgm_deck' | 'bgm_lobby';
/** 'battle' ＝ 戦闘曲（battle フォルダの曲をシャッフルで1曲ずつ流す） */
export type BgmKey = LoopBgmKey | 'battle';

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

/**
 * 全部の BGM にかける大きさ（0〜1）。届いた曲は大きく作られているので、効果音が埋もれないように下げる。
 * 設定の初期値（7）で BGM が約 -21 LUFS、ダメージ音（-13〜-18）が BGM より大きく聞こえるくらい。
 */
export const BGM_LEVEL = 0.45;

/**
 * volume：曲ごとの音量差をそろえる値。いちばん小さい曲（bgm_title、-10.7 LUFS）に合わせてある。
 * 測り方：npm run dev を動かしたまま node scripts/measure-bgm.mjs（曲を差し替えたら測り直す）
 */
export const BGM: Record<LoopBgmKey, BgmInfo> = {
  bgm_title: { scene: 'タイトル・メニュー', volume: 1 }, // -10.7 LUFS
  bgm_deck: { scene: 'デッキ編集・設定・ルール', volume: 0.76 }, // -8.3
  bgm_lobby: { scene: 'ロビー待機', volume: 0.87 }, // -9.5
};

/** BGM を置く場所 */
export const BGM_DIR = 'audio/bgm/';

// ---------------------------------------------------------------- 戦闘曲（§10-2「戦闘曲の流し方」）

/** 戦闘曲を置く場所 */
export const BATTLE_DIR = 'audio/bgm/battle/';
/** 戦闘曲の一覧（public/audio/bgm/battle/ の .mp3。名前の順） */
export const battleTracks: readonly { id: string; files: string[] }[] = battleList;
/**
 * 戦闘曲ごとの大きさ（0〜1）。曲どうしの音量差をそろえる（元のファイルは変えない。BGM の volume と同じ基準）。
 * 書いていない曲（新しく足した曲）は 1。測り方：npm run dev を動かしたまま node scripts/measure-bgm.mjs
 */
export const BATTLE_VOLUME: Record<string, number> = {
  battle_01: 0.84, // -9.2 LUFS
  battle_02: 0.84, // -9.2
  battle_03: 0.81, // -8.9
  battle_04: 0.91, // -9.9
  battle_05: 0.87, // -9.5
  battle_06: 0.84, // -9.2
  battle_07: 0.83, // -9.1
  battle_08: 0.88, // -9.6
  battle_09: 0.81, // -8.9
  battle_10: 0.92, // -10.0
  battle_11: 0.9, // -9.8
  battle_12: 0.75, // -8.2
  battle_13: 0.74, // -8.1
};
/** 曲の残りがこの秒数になったら、次の曲を先読みする（全曲を最初に読み込まない） */
export const BATTLE_PRELOAD_SECONDS = 60;
/** 直前に流れた戦闘曲を覚えておく localStorage のキー（再戦・読み込み直しの後に同じ曲から始めない） */
export const LAST_BATTLE_KEY = 'oteca.lastBattleBgm';
/** 効果音をファイルで差し替える時の場所 */
export const SE_DIR = 'audio/se/';

/** BGM の切り替えにかける時間（秒）（§10-2 クロスフェード） */
export const BGM_CROSSFADE = 0.8;

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
