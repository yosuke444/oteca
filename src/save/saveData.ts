/**
 * セーブデータの型と初期値（SPEC §12-2。形式版数4・v2.0-B）
 */

import economy from '../data/economy.json';
import { STARTER_COINS, STARTER_DECK_NAME, starterDeckNos } from '../data/starterDeck';
import type { Lang } from '../i18n';

export type Settings = {
  /** BGM音量 0〜10 */
  bgm: number;
  /** 効果音音量 0〜10 */
  se: number;
  /** 演出スピード 0=ふつう 1=はやい 2=さいそく */
  fxSpeed: 0 | 1 | 2;
  /** 演出をへらす */
  reduceFx: boolean;
  /**
   * 使わない値（ヒント1行は v1.3 で削除）。セーブデータの形式を変えないため（引き継ぎコードが読めなくならないように）残す。
   * 読み書きはするが、どこにも使わない
   */
  hints: boolean;
  /** ことば：にほんご（hira。初期値）／日本語（kanji）。形式版数3（v2.0-A）で追加 */
  lang: Lang;
};

export type SavedDeck = { name: string; cards: number[] };

export type WinLoss = { wins: number; losses: number };

/** ストーリーのステージごとの記録 */
export type StoryStage = { no: number; cleared: boolean; firstClear: boolean };

export type SaveData = {
  saveVersion: 1;
  /** 保存するたび +1 */
  saveCounter: number;
  /** 8文字まで */
  playerName: string;
  settings: Settings;
  /** ランダムな8バイト（16桁の16進数）。'' はまだ無い（起動時に作る） */
  playerId: string;
  /** 必ず20個。cards はカードNoの配列 */
  decks: SavedDeck[];
  /** いまのデッキ 0〜19 */
  selectedDeck: number;
  /** 所持数（No → 枚数 1〜999）。デッキに入れても減らない（在庫はデッキごと。SPEC §4-2） */
  collection: Record<number, number>;
  /** 全カード無制限（開発用。ふつうは false） */
  unlockAll: boolean;
  /** おてあげコイン 0〜99,999 */
  coins: number;
  /** フレンド対戦の勝敗 */
  stats: WinLoss;
  /** CPU対戦の勝敗（強さごと。[よわい, ふつう, つよい, さいきょう]。SPEC §12-2・v1.4） */
  cpuStats: WinLoss[];
  // ↓ 後の項目（UPDATE_v2 D〜I）で使う枠。使い始めるまでは初期値のまま
  /** 最後にログボを受け取った日（YYYYMMDD。0＝まだ） */
  loginBonus: { lastDate: number };
  /** その日（YYYYMMDD）にフレンド・レートで報酬を受けた試合数 */
  dailyReward: { date: number; count: number };
  story: { stages: StoryStage[] };
  /** レート（初期値100） */
  rate: number;
  rateStats: WinLoss & { best: number };
  /** 直前のレート対戦の相手の playerId（'' ＝なし） */
  lastRateOpponentId: string;
  /** レート対戦中の印 */
  pendingRateMatch: { opponentId: string; opponentRate: number } | null;
  /** 処理済みの交換ID（16桁の16進数）の直近20件 */
  trade: { doneIds: string[] };
  /** ランキングの合言葉・参加するか・未送信の報告（中身は UPDATE_v2 I で決める） */
  ranking: { token: string; optIn: boolean; unsent: string[] };
  /** アップデートの おしらせ を見たか（古いセーブから移行した人だけ false） */
  updateNoticeSeen: boolean;
  tutorial: { done: boolean; gachaInviteShown: boolean };
};

export const SAVE_VERSION = 1;
export const DECK_SLOTS = 20;
export const NAME_MAX = 8;
export const DECK_NAME_MAX = 8;
export const VOLUME_MAX = 10;
export const DEFAULT_PLAYER_NAME = 'プレイヤー';
/** CPU の強さの数（cpuStats の長さ） */
export const CPU_LEVEL_COUNT = 4;
/** カードNo の上限（バイト列で読める範囲。binary.ts と同じ） */
export const CARD_NO_MAX = 65535;
/** 1つのデッキに保存できる枚数の上限（バイト列で読める範囲。binary.ts と同じ） */
export const DECK_CARDS_MAX = 60;
/** 1枚あたりの所持数の上限 */
export const OWN_MAX = 999;
/** コインの上限 */
export const COINS_MAX = economy.coinsMax;
/** レートの初期値 */
export const RATE_START = 100;
/** 覚えておく交換IDの数 */
export const TRADE_IDS_MAX = 20;
/** 未送信のランキング報告を覚えておく数 */
export const RANKING_UNSENT_MAX = 20;
/** ランキングの合言葉・報告1件の文字数の上限 */
export const RANKING_TEXT_MAX = 256;
/** playerId・交換ID の形（8バイト = 16桁の16進数） */
export const ID_PATTERN = /^[0-9a-f]{16}$/;

export function emptyCpuStats(): WinLoss[] {
  return Array.from({ length: CPU_LEVEL_COUNT }, () => ({ wins: 0, losses: 0 }));
}

/** スロット番号（0〜19）の既定のデッキ名 */
export function defaultDeckName(index: number): string {
  return `デッキ${index + 1}`;
}

/** 文字数（絵文字なども1文字と数える）で切り詰める */
export function clampText(text: string, max: number): string {
  return [...text].slice(0, max).join('');
}

/** 0以上 max 以下の整数に丸める（壊れた値は 0） */
function clampInt(v: number | undefined, max = Number.MAX_SAFE_INTEGER): number {
  return Number.isFinite(v) ? Math.max(0, Math.min(max, Math.round(v as number))) : 0;
}

/** 16桁の16進数でなければ ''（まだ無い／なし） */
function normalizeId(id: string | undefined): string {
  const s = (id ?? '').toLowerCase();
  return ID_PATTERN.test(s) && s !== '0000000000000000' ? s : '';
}

/** 所持数を整える（0枚・壊れた値は消す。No は正の整数） */
export function normalizeCollection(c: Record<number, number>): Record<number, number> {
  const out: Record<number, number> = {};
  for (const [k, v] of Object.entries(c ?? {})) {
    const no = Number(k);
    const qty = clampInt(v, OWN_MAX);
    if (Number.isInteger(no) && no > 0 && no <= CARD_NO_MAX && qty > 0) out[no] = qty;
  }
  return out;
}

/** 画面から来た値を、保存できる形に整える（文字数・範囲・空の名前） */
export function normalizeSave(data: SaveData): SaveData {
  const name = clampText(data.playerName.trim(), NAME_MAX);
  const winLoss = (w: Partial<WinLoss> | undefined) => ({ wins: clampInt(w?.wins), losses: clampInt(w?.losses) });
  const stages = new Map<number, StoryStage>();
  for (const s of data.story?.stages ?? []) {
    if (Number.isInteger(s.no) && s.no >= 0) stages.set(s.no, { no: s.no, cleared: !!s.cleared, firstClear: !!s.firstClear });
  }
  const pending = data.pendingRateMatch;
  return {
    ...data,
    playerName: name || DEFAULT_PLAYER_NAME,
    settings: {
      ...data.settings,
      bgm: clampInt(data.settings.bgm, VOLUME_MAX),
      fxSpeed: clampInt(data.settings.fxSpeed, 2) as 0 | 1 | 2,
      se: clampInt(data.settings.se, VOLUME_MAX),
      lang: data.settings.lang === 'kanji' ? 'kanji' : 'hira',
    },
    playerId: normalizeId(data.playerId),
    decks: Array.from({ length: DECK_SLOTS }, (_, i) => {
      const deck = data.decks[i] ?? { name: '', cards: [] };
      const deckName = clampText(deck.name.trim(), DECK_NAME_MAX);
      // 読み込める範囲（カードNo 1〜65535・60枚まで）に収める。収めないと、次の起動で読めずに初期化されてしまう
      const cards = deck.cards.filter((no) => Number.isInteger(no) && no > 0 && no <= CARD_NO_MAX).slice(0, DECK_CARDS_MAX);
      return { name: deckName || defaultDeckName(i), cards };
    }),
    selectedDeck: clampInt(data.selectedDeck, DECK_SLOTS - 1),
    collection: normalizeCollection(data.collection),
    coins: clampInt(data.coins, COINS_MAX),
    stats: winLoss(data.stats),
    cpuStats: Array.from({ length: CPU_LEVEL_COUNT }, (_, i) => winLoss(data.cpuStats?.[i])),
    loginBonus: { lastDate: clampInt(data.loginBonus?.lastDate) },
    dailyReward: { date: clampInt(data.dailyReward?.date), count: clampInt(data.dailyReward?.count) },
    story: { stages: [...stages.values()].sort((a, b) => a.no - b.no) },
    rate: clampInt(data.rate),
    rateStats: { ...winLoss(data.rateStats), best: clampInt(data.rateStats?.best) },
    lastRateOpponentId: normalizeId(data.lastRateOpponentId),
    pendingRateMatch:
      pending && normalizeId(pending.opponentId) ? { opponentId: normalizeId(pending.opponentId), opponentRate: clampInt(pending.opponentRate) } : null,
    trade: { doneIds: (data.trade?.doneIds ?? []).map(normalizeId).filter((id) => id !== '').slice(-TRADE_IDS_MAX) },
    ranking: {
      token: clampText(data.ranking?.token ?? '', RANKING_TEXT_MAX),
      optIn: !!data.ranking?.optIn,
      unsent: (data.ranking?.unsent ?? []).map((u) => clampText(u, RANKING_TEXT_MAX)).slice(-RANKING_UNSENT_MAX),
    },
  };
}

/** 後の項目（D〜I）の枠の初期値。新しいセーブと、古いセーブからの移行で共通 */
export function laterFieldsDefault(): Pick<
  SaveData,
  'playerId' | 'loginBonus' | 'dailyReward' | 'rate' | 'rateStats' | 'lastRateOpponentId' | 'pendingRateMatch' | 'trade' | 'ranking' | 'tutorial'
> {
  return {
    playerId: '',
    loginBonus: { lastDate: 0 },
    dailyReward: { date: 0, count: 0 },
    rate: RATE_START,
    rateStats: { wins: 0, losses: 0, best: RATE_START },
    lastRateOpponentId: '',
    pendingRateMatch: null,
    trade: { doneIds: [] },
    ranking: { token: '', optIn: false, unsent: [] },
    tutorial: { done: false, gachaInviteShown: false },
  };
}

/**
 * 初期のセーブデータ（SPEC §5-4）。
 * 初期カード15枚（所持数）・コイン200枚、スロット1に初期デッキ「はじめてのデッキ」（初期カードそのもの）。
 * @param reduceFx OS の「視差効果を減らす」がONなら true（SPEC §9-4）
 */
export function createDefaultSave(reduceFx = false): SaveData {
  const starter = { deck: starterDeckNos(), deckName: STARTER_DECK_NAME, coins: STARTER_COINS };
  const collection: Record<number, number> = {};
  for (const no of starter.deck) collection[no] = (collection[no] ?? 0) + 1;
  return {
    saveVersion: SAVE_VERSION,
    saveCounter: 0,
    playerName: DEFAULT_PLAYER_NAME,
    settings: { bgm: 7, se: 7, fxSpeed: 0, reduceFx, hints: true, lang: 'hira' },
    decks: Array.from({ length: DECK_SLOTS }, (_, i) => ({
      name: i === 0 ? starter.deckName : defaultDeckName(i),
      cards: i === 0 ? [...starter.deck] : [],
    })),
    selectedDeck: 0,
    collection,
    unlockAll: false,
    coins: starter.coins,
    stats: { wins: 0, losses: 0 },
    cpuStats: emptyCpuStats(),
    story: { stages: [] },
    updateNoticeSeen: true,
    ...laterFieldsDefault(),
  };
}
