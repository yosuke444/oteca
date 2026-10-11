/**
 * セーブデータの型と初期値（SPEC §12-2。形式版数5・v2.1-L）
 */

import cardsJson from '../data/cards.json';
import economy from '../data/economy.json';
import { STARTER_COINS, STARTER_DECK_NAME, starterDeckNos } from '../data/starterDeck';
import type { Lang } from '../i18n';
import { isUserId, normalizeUserId } from './userId';

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

/** デイリーミッションの種類（SPEC §7 S17・v2.1-M）。この並びの番号でバイト列に書く（並びを変えない。足す時は後ろへ） */
export const DAILY_MISSION_IDS = ['draw20', 'item10', 'ko5', 'friend1', 'onlineWin1', 'story1', 'gacha1'] as const;
export type DailyMissionId = (typeof DAILY_MISSION_IDS)[number];
export type DailyMission = { id: DailyMissionId; progress: number; claimed: boolean };
/** デイリーミッションの記録（v2.1-M） */
export type DailyState = {
  /** 12時区切りの日付（YYYYMMDD。12時より前は前日）。0＝まだ */
  cycleKey: number;
  missions: DailyMission[];
  /** 確定のミッション（ぜんぶ クリア）を受け取ったか */
  allClearClaimed: boolean;
};

/** ストーリーのステージごとの記録 */
export type StoryStage = { no: number; cleared: boolean; firstClear: boolean };

export type SaveData = {
  saveVersion: 1;
  /** 保存するたび +1 */
  saveCounter: number;
  /** 8文字まで */
  playerName: string;
  settings: Settings;
  /** ランダムな8バイト（16桁の16進数）。'' はまだ無い（起動時に作る）。部屋の中の再接続などに使う（相手の判別は userId） */
  playerId: string;
  /** ユーザーID（v2.0-J）。15桁の数字（先頭は0以外）。'' はまだ無い（起動時・移行時に1回だけ作る）。変わらない */
  userId: string;
  /** ユーザーID をサーバーに登録できたか（登録前に重複していた時だけ作り直す。登録後は変えない） */
  userIdRegistered: boolean;
  /** 受け取ったトロフィー（v2.0-J。番号 1〜9999 と受け取った時刻）。カードは collection には入れない */
  trophies: Trophy[];
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
  /** 最後にログボを受け取った時刻（ミリ秒。0＝まだ）。v2.1-L（形式版数4までは日付 lastDate） */
  loginBonus: { claimedAt: number };
  /** その日（YYYYMMDD）にフレンド・レートで報酬を受けた試合数 */
  dailyReward: { date: number; count: number };
  story: { stages: StoryStage[] };
  /** レート（初期値100） */
  rate: number;
  rateStats: WinLoss & { best: number };
  /** 直前のレート対戦の相手のユーザーID（'' ＝なし。v2.0-I までは playerId） */
  lastRateOpponentId: string;
  /** レート対戦中の印（v2.4 で試合ID と「始まったか」を足した。形式版数10） */
  pendingRateMatch: PendingRateMatch | null;
  /**
   * フレンド対戦中の印（v2.4。形式版数10）：対戦が始まった（準備が終わった）時に付け、対戦の画面を出る時に消す。
   * 残っていたら（ページを閉じた・通信が切れたまま閉じた）次に開いた時に負けとして数える
   */
  pendingFriendMatch: { opponentId: string } | null;
  /** 処理済みの交換ID（16桁の16進数）の直近20件 */
  trade: { doneIds: string[] };
  /**
   * ランキング（v2.0-I。SPEC §11-9）：token＝サーバーの合言葉（'' ＝まだ登録していない）、optIn＝ランキングに のる（初期値オン。v2.2 で「名前を載せる」から変更）、
   * unsent＝送れなかった結果の報告（「試合ID:勝った人の playerId か void」）、provisional＝レートが「かり」、
   * syncedAt＝正式なレートを最後に受け取った時刻（ミリ秒。0＝まだ）、playedAt＝最後にレート対戦の結果が出た時刻（0＝まだ）、
   * lastMatchId＝最後に「かり」で計算した試合の試合ID（v2.0-J。サーバーが数えたかを比べる。'' ＝なし）
   */
  ranking: Ranking;
  /** アップデートの おしらせ を見たか（古いセーブから移行した人だけ false） */
  updateNoticeSeen: boolean;
  /** step：途中まで進んだ時の再開位置（0＝はじめから。v2.1-P） */
  tutorial: { done: boolean; gachaInviteShown: boolean; step: number };
  /** デイリーミッション（v2.1-M） */
  daily: DailyState;
};

/**
 * レート対戦中の印。matchId：受付係の試合ID（'' ＝無い）。begun：準備が終わって対戦が始まったか（始まる前に切れた試合は勝ち負けを付けない。v2.4）
 */
export type PendingRateMatch = { opponentId: string; opponentRate: number; matchId: string; begun: boolean };

/** 受け取ったトロフィー（v2.0-J。形式版数9） */
export type Trophy = { number: number; receivedAt: number };

/** トロフィーの数の上限（バイト列で読む時の上限） */
export const TROPHIES_MAX = 100;
/** トロフィーの番号の上限（cards.json の trophy.numberMax） */
export const TROPHY_NUMBER_MAX: number = cardsJson.trophy.numberMax;
/** トロフィーのカードNo の始まり（cards.json の trophy.noBase） */
export const TROPHY_CARD_NO_BASE: number = cardsJson.trophy.noBase;

/** ランキングの項目（v2.0-I。形式版数7） */
export type Ranking = { token: string; optIn: boolean; unsent: string[]; provisional: boolean; syncedAt: number; playedAt: number; lastMatchId: string };

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
/** その日のデイリーミッションの数の上限（バイト列で読む時の上限。SPEC §12-3） */
export const DAILY_MISSIONS_MAX = DAILY_MISSION_IDS.length;
/** チュートリアルの再開位置の上限 */
export const TUTORIAL_STEP_MAX = 255;
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
    // トロフィーのカード（v2.0-J。カードNo 50000＋番号）は collection に入れない（trophies で持つ）
    if (Number.isInteger(no) && no > 0 && no < TROPHY_CARD_NO_BASE && no <= CARD_NO_MAX && qty > 0) out[no] = qty;
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
    userId: normalizeUserId(data.userId),
    userIdRegistered: !!data.userIdRegistered && isUserId(data.userId),
    trophies: normalizeTrophies(data.trophies),
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
    loginBonus: { claimedAt: clampInt(data.loginBonus?.claimedAt) },
    dailyReward: { date: clampInt(data.dailyReward?.date), count: clampInt(data.dailyReward?.count) },
    story: { stages: [...stages.values()].sort((a, b) => a.no - b.no) },
    rate: clampInt(data.rate),
    rateStats: { ...winLoss(data.rateStats), best: clampInt(data.rateStats?.best) },
    lastRateOpponentId: normalizeUserId(data.lastRateOpponentId),
    pendingRateMatch:
      pending && normalizeUserId(pending.opponentId)
        ? { opponentId: normalizeUserId(pending.opponentId), opponentRate: clampInt(pending.opponentRate), matchId: normalizeId(pending.matchId), begun: pending.begun !== false }
        : null,
    pendingFriendMatch: data.pendingFriendMatch ? { opponentId: normalizeUserId(data.pendingFriendMatch.opponentId) } : null,
    trade: { doneIds: (data.trade?.doneIds ?? []).map(normalizeId).filter((id) => id !== '').slice(-TRADE_IDS_MAX) },
    ranking: {
      token: clampText(data.ranking?.token ?? '', RANKING_TEXT_MAX),
      optIn: data.ranking?.optIn ?? true,
      unsent: (data.ranking?.unsent ?? []).map((u) => clampText(u, RANKING_TEXT_MAX)).slice(-RANKING_UNSENT_MAX),
      provisional: !!data.ranking?.provisional,
      syncedAt: clampInt(data.ranking?.syncedAt),
      playedAt: clampInt(data.ranking?.playedAt),
      lastMatchId: normalizeId(data.ranking?.lastMatchId),
    },
    tutorial: { done: !!data.tutorial?.done, gachaInviteShown: !!data.tutorial?.gachaInviteShown, step: clampInt(data.tutorial?.step, TUTORIAL_STEP_MAX) },
    daily: normalizeDaily(data.daily),
  };
}

/** トロフィーの一覧を整える（番号 1〜9999、同じ番号は1つ、番号の順、100まで） */
export function normalizeTrophies(list: Trophy[] | undefined): Trophy[] {
  const m = new Map<number, Trophy>();
  for (const t of list ?? []) {
    if (!Number.isInteger(t?.number) || t.number < 1 || t.number > TROPHY_NUMBER_MAX || m.has(t.number)) continue;
    m.set(t.number, { number: t.number, receivedAt: clampInt(t.receivedAt) });
  }
  return [...m.values()].sort((a, b) => a.number - b.number).slice(0, TROPHIES_MAX);
}

/** デイリーミッションの記録を整える（知らない種類・同じ種類の2つ目は消す。7つまで。その日に出すのは3つ） */
export function normalizeDaily(d: Partial<DailyState> | undefined): DailyState {
  const seen = new Set<string>();
  const missions: DailyMission[] = [];
  for (const m of d?.missions ?? []) {
    if (!DAILY_MISSION_IDS.includes(m?.id) || seen.has(m.id) || missions.length >= DAILY_MISSIONS_MAX) continue;
    seen.add(m.id);
    missions.push({ id: m.id, progress: clampInt(m.progress), claimed: !!m.claimed });
  }
  return { cycleKey: clampInt(d?.cycleKey), missions, allClearClaimed: !!d?.allClearClaimed };
}

/** デイリーミッションの空の記録（次にメニューを開いた時に、その日のミッションを選ぶ） */
export function emptyDaily(): DailyState {
  return { cycleKey: 0, missions: [], allClearClaimed: false };
}

/** 後の項目（D〜I）の枠の初期値。新しいセーブと、古いセーブからの移行で共通 */
export function laterFieldsDefault(): Pick<
  SaveData,
  'playerId' | 'userId' | 'userIdRegistered' | 'trophies' | 'loginBonus' | 'dailyReward' | 'rate' | 'rateStats' | 'lastRateOpponentId' | 'pendingRateMatch' | 'pendingFriendMatch' | 'trade' | 'ranking' | 'tutorial' | 'daily'
> {
  return {
    playerId: '',
    userId: '',
    userIdRegistered: false,
    trophies: [],
    loginBonus: { claimedAt: 0 },
    dailyReward: { date: 0, count: 0 },
    rate: RATE_START,
    rateStats: { wins: 0, losses: 0, best: RATE_START },
    lastRateOpponentId: '',
    pendingRateMatch: null,
    pendingFriendMatch: null,
    trade: { doneIds: [] },
    // 「ランキングに のる」は初期値オン（v2.0-I・v2.2）
    ranking: { token: '', optIn: true, unsent: [], provisional: false, syncedAt: 0, playedAt: 0, lastMatchId: '' },
    tutorial: { done: false, gachaInviteShown: false, step: 0 },
    daily: emptyDaily(),
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
