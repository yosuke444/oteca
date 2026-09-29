/**
 * セーブデータの型と初期値（SPEC §12-2）
 */

export type Settings = {
  /** BGM音量 0〜10 */
  bgm: number;
  /** 効果音音量 0〜10 */
  se: number;
  /** 演出スピード 0=ふつう 1=はやい 2=さいそく */
  fxSpeed: 0 | 1 | 2;
  /** 演出をへらす */
  reduceFx: boolean;
  /** ヒントを出す */
  hints: boolean;
};

export type SavedDeck = { name: string; cards: number[] };

export type SaveData = {
  saveVersion: 1;
  /** 保存するたび +1 */
  saveCounter: number;
  /** 8文字まで */
  playerName: string;
  settings: Settings;
  /** 必ず5つ。cards はカードNoの配列 */
  decks: SavedDeck[];
  /** 0〜4 */
  selectedDeck: number;
  stats: { wins: number; losses: number };
  // ↓ 後で実装する機能用の枠（今回は初期値のまま）
  /** おてあげコイン */
  coins: number;
  /** 所持カード（今回は空。unlockAll で全解放） */
  collection: { no: number; qty: number }[];
  /** 今回は true */
  unlockAll: boolean;
  /** クリア済みステージ番号 */
  story: { cleared: number[] };
};

export const SAVE_VERSION = 1;
export const DECK_SLOTS = 5;
export const NAME_MAX = 8;
export const DECK_NAME_MAX = 8;
export const VOLUME_MAX = 10;
export const DEFAULT_PLAYER_NAME = 'プレイヤー';

/** スロット番号（0〜4）の既定のデッキ名 */
export function defaultDeckName(index: number): string {
  return `デッキ${index + 1}`;
}

/** 文字数（絵文字なども1文字と数える）で切り詰める */
export function clampText(text: string, max: number): string {
  return [...text].slice(0, max).join('');
}

/** 画面から来た値を、保存できる形に整える（文字数・範囲・空の名前） */
export function normalizeSave(data: SaveData): SaveData {
  const clampInt = (v: number, max: number) => Math.max(0, Math.min(max, Math.round(v)));
  const name = clampText(data.playerName.trim(), NAME_MAX);
  return {
    ...data,
    playerName: name || DEFAULT_PLAYER_NAME,
    settings: {
      ...data.settings,
      bgm: clampInt(data.settings.bgm, VOLUME_MAX),
      se: clampInt(data.settings.se, VOLUME_MAX),
    },
    decks: Array.from({ length: DECK_SLOTS }, (_, i) => {
      const deck = data.decks[i] ?? { name: '', cards: [] };
      const deckName = clampText(deck.name.trim(), DECK_NAME_MAX);
      return { name: deckName || defaultDeckName(i), cards: [...deck.cards] };
    }),
    selectedDeck: clampInt(data.selectedDeck, DECK_SLOTS - 1),
  };
}

/**
 * 初期のセーブデータ。
 * @param starterDeck スロット1に入れる初期デッキ（SPEC §5-4）
 * @param reduceFx OS の「視差効果を減らす」がONなら true（SPEC §9-4）
 */
export function createDefaultSave(starterDeck: number[], reduceFx = false): SaveData {
  return {
    saveVersion: SAVE_VERSION,
    saveCounter: 0,
    playerName: DEFAULT_PLAYER_NAME,
    settings: { bgm: 7, se: 7, fxSpeed: 0, reduceFx, hints: true },
    decks: Array.from({ length: DECK_SLOTS }, (_, i) => ({
      name: defaultDeckName(i),
      cards: i === 0 ? [...starterDeck] : [],
    })),
    selectedDeck: 0,
    stats: { wins: 0, losses: 0 },
    coins: 0,
    collection: [],
    unlockAll: true,
    story: { cleared: [] },
  };
}
