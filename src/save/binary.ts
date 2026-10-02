import {
  CARD_NO_MAX,
  CPU_LEVEL_COUNT,
  DECK_CARDS_MAX,
  DECK_NAME_MAX,
  DECK_SLOTS,
  NAME_MAX,
  OWN_MAX,
  RANKING_TEXT_MAX,
  RANKING_UNSENT_MAX,
  SAVE_VERSION,
  TRADE_IDS_MAX,
  VOLUME_MAX,
  type SaveData,
  type SavedDeck,
  type Settings,
  type WinLoss,
  defaultDeckName,
} from './saveData';

/**
 * セーブデータ ⇔ バイト列（SPEC §12-3）
 * 数値は LEB128（小さい数は1バイト、大きい数は2バイト以上になる可変長整数）。
 * 形式を変える時は FORMAT_VERSION を上げ、migrate.ts に読み方と変換を足す（CLAUDE.md 守ること7）。
 */

/**
 * 形式版数（バイト列の先頭1バイト）。
 * 1＝v1.3 まで／2＝v1.4（末尾に cpuStats）／3＝v2.0-A（末尾に lang）／4＝v2.0-B（デッキ20個・所持カードなど。並びを作り直した）
 */
export const FORMAT_VERSION = 4;

/** 形式版数3の形（v2.0-A。デッキ5個、所持カードは使っていない枠） */
export type SaveDataV3 = {
  saveVersion: 1;
  saveCounter: number;
  playerName: string;
  settings: Settings;
  /** 5つ */
  decks: SavedDeck[];
  /** 0〜4 */
  selectedDeck: number;
  stats: WinLoss;
  cpuStats: WinLoss[];
  coins: number;
  collection: { no: number; qty: number }[];
  unlockAll: boolean;
  story: { cleared: number[] };
};
/** 形式版数2の形（settings.lang が無い） */
export type SaveDataV2 = Omit<SaveDataV3, 'settings'> & { settings: Omit<Settings, 'lang'> };
/** 形式版数1の形（cpuStats も無い） */
export type SaveDataV1 = Omit<SaveDataV2, 'cpuStats'>;

/** 形式版数1〜3のデッキの数 */
export const OLD_DECK_SLOTS = 5;

/** 読み込み時の上限（壊れたデータで固まらないように） */
const LIMITS = { deckCards: DECK_CARDS_MAX, collection: 10000, story: 10000, cardNo: CARD_NO_MAX };

/** 8バイトの ID（playerId・交換ID）の長さ */
const ID_BYTES = 8;

const utf8 = new TextEncoder();
const utf8Strict = new TextDecoder('utf-8', { fatal: true });

export class ByteWriter {
  private bytes: number[] = [];

  byte(v: number): void {
    this.bytes.push(v & 0xff);
  }

  /** 符号なし LEB128 */
  uint(v: number): void {
    if (!Number.isSafeInteger(v) || v < 0) throw new Error(`LEB128 で書けない数です: ${v}`);
    let n = v;
    do {
      let b = n % 128;
      n = Math.floor(n / 128);
      if (n > 0) b |= 0x80;
      this.bytes.push(b);
    } while (n > 0);
  }

  /** 長さ + UTF-8 */
  text(s: string): void {
    const b = utf8.encode(s);
    this.uint(b.length);
    for (const x of b) this.bytes.push(x);
  }

  /** 16桁の16進数 → 8バイト（'' は全部0） */
  id(hex: string): void {
    const h = hex === '' ? '0'.repeat(ID_BYTES * 2) : hex;
    if (!/^[0-9a-f]{16}$/.test(h)) throw new Error(`ID の形が不正です: ${hex}`);
    for (let i = 0; i < ID_BYTES; i++) this.bytes.push(parseInt(h.slice(i * 2, i * 2 + 2), 16));
  }

  toBytes(): Uint8Array {
    return new Uint8Array(this.bytes);
  }
}

export class ByteReader {
  private pos = 0;
  constructor(private readonly bytes: Uint8Array) {}

  byte(): number {
    if (this.pos >= this.bytes.length) throw new Error('データが途中で終わっています');
    return this.bytes[this.pos++];
  }

  uint(): number {
    let result = 0;
    let mul = 1;
    for (let i = 0; i < 8; i++) {
      const b = this.byte();
      result += (b & 0x7f) * mul;
      if ((b & 0x80) === 0) {
        if (!Number.isSafeInteger(result)) break;
        return result;
      }
      mul *= 128;
    }
    throw new Error('数値が大きすぎます');
  }

  /** 上限つきの数値 */
  uintMax(max: number): number {
    const v = this.uint();
    if (v > max) throw new Error(`値が範囲外です: ${v} > ${max}`);
    return v;
  }

  text(maxChars: number): string {
    const len = this.uintMax(maxChars * 4);
    const out: number[] = [];
    for (let i = 0; i < len; i++) out.push(this.byte());
    const s = utf8Strict.decode(new Uint8Array(out));
    if ([...s].length > maxChars) throw new Error('文字が長すぎます');
    return s;
  }

  /** 8バイト → 16桁の16進数（全部0なら ''） */
  id(): string {
    let hex = '';
    for (let i = 0; i < ID_BYTES; i++) hex += this.byte().toString(16).padStart(2, '0');
    return /^0+$/.test(hex) ? '' : hex;
  }

  get done(): boolean {
    return this.pos === this.bytes.length;
  }
}

/** 印のビット（形式版数4） */
const FLAG = { unlockAll: 1, updateNoticeSeen: 2, tutorialDone: 4, gachaInviteShown: 8, rankingOptIn: 16 } as const;

/** 最新の形式（形式版数4）でバイト列にする */
export function encodeSave(data: SaveData): Uint8Array {
  const w = new ByteWriter();
  w.byte(FORMAT_VERSION);
  w.uint(data.saveVersion);
  w.uint(data.saveCounter);
  w.text(data.playerName);
  const s = data.settings;
  w.byte((s.bgm << 4) | s.se);
  w.byte((s.fxSpeed << 2) | (s.reduceFx ? 2 : 0) | (s.hints ? 1 : 0));
  w.byte(s.lang === 'kanji' ? 1 : 0);
  w.byte(
    (data.unlockAll ? FLAG.unlockAll : 0) |
      (data.updateNoticeSeen ? FLAG.updateNoticeSeen : 0) |
      (data.tutorial.done ? FLAG.tutorialDone : 0) |
      (data.tutorial.gachaInviteShown ? FLAG.gachaInviteShown : 0) |
      (data.ranking.optIn ? FLAG.rankingOptIn : 0),
  );
  w.id(data.playerId);
  w.uint(data.selectedDeck);
  if (data.decks.length !== DECK_SLOTS) throw new Error(`デッキは ${DECK_SLOTS} 個です`);
  data.decks.forEach((deck, i) => {
    // 既定名なら長さ0（コードを短くするため）
    w.text(deck.name === defaultDeckName(i) ? '' : deck.name);
    w.uint(deck.cards.length);
    for (const no of deck.cards) w.uint(no);
  });
  // 所持数：No 1〜いちばん大きい No の順に枚数を並べる（持っていない No は 0）
  const nos = Object.keys(data.collection).map(Number);
  const maxNo = nos.length ? Math.max(...nos) : 0;
  w.uint(maxNo);
  for (let no = 1; no <= maxNo; no++) w.uint(data.collection[no] ?? 0);
  w.uint(data.coins);
  w.uint(data.stats.wins);
  w.uint(data.stats.losses);
  for (let i = 0; i < CPU_LEVEL_COUNT; i++) {
    w.uint(data.cpuStats[i]?.wins ?? 0);
    w.uint(data.cpuStats[i]?.losses ?? 0);
  }
  w.uint(data.loginBonus.lastDate);
  w.uint(data.dailyReward.date);
  w.uint(data.dailyReward.count);
  w.uint(data.story.stages.length);
  for (const st of data.story.stages) {
    w.uint(st.no);
    w.byte((st.cleared ? 1 : 0) | (st.firstClear ? 2 : 0));
  }
  w.uint(data.rate);
  w.uint(data.rateStats.wins);
  w.uint(data.rateStats.losses);
  w.uint(data.rateStats.best);
  w.id(data.lastRateOpponentId);
  if (data.pendingRateMatch) {
    w.byte(1);
    w.id(data.pendingRateMatch.opponentId);
    w.uint(data.pendingRateMatch.opponentRate);
  } else {
    w.byte(0);
  }
  w.uint(data.trade.doneIds.length);
  for (const id of data.trade.doneIds) w.id(id);
  w.text(data.ranking.token);
  w.uint(data.ranking.unsent.length);
  for (const u of data.ranking.unsent) w.text(u);
  return w.toBytes();
}

/** 形式版数4の本体を読む（先頭の形式版数1バイトは読み終わっている前提） */
export function readSaveV4(r: ByteReader): SaveData {
  const saveVersion = r.uint();
  if (saveVersion !== SAVE_VERSION) throw new Error(`saveVersion ${saveVersion} は読めません`);
  const saveCounter = r.uint();
  const playerName = r.text(NAME_MAX);
  const settings = readSettings(r);
  const lang = r.byte();
  if (lang > 1) throw new Error('ことば の値が不正です');
  const flags = r.byte();
  if (flags > 31) throw new Error('印の値が不正です');
  const playerId = r.id();
  const selectedDeck = r.uintMax(DECK_SLOTS - 1);
  const decks = readDecks(r, DECK_SLOTS);
  const maxNo = r.uintMax(LIMITS.cardNo);
  const collection: Record<number, number> = {};
  for (let no = 1; no <= maxNo; no++) {
    const qty = r.uintMax(OWN_MAX);
    if (qty > 0) collection[no] = qty;
  }
  const coins = r.uint();
  const stats = { wins: r.uint(), losses: r.uint() };
  const cpuStats = Array.from({ length: CPU_LEVEL_COUNT }, () => ({ wins: r.uint(), losses: r.uint() }));
  const loginBonus = { lastDate: r.uint() };
  const dailyReward = { date: r.uint(), count: r.uint() };
  const stages = Array.from({ length: r.uintMax(LIMITS.story) }, () => {
    const no = r.uint();
    const f = r.byte();
    if (f > 3) throw new Error('ストーリーの印が不正です');
    return { no, cleared: (f & 1) !== 0, firstClear: (f & 2) !== 0 };
  });
  const rate = r.uint();
  const rateStats = { wins: r.uint(), losses: r.uint(), best: r.uint() };
  const lastRateOpponentId = r.id();
  const hasPending = r.byte();
  if (hasPending > 1) throw new Error('レート対戦中の印が不正です');
  const pendingRateMatch = hasPending === 1 ? { opponentId: r.id(), opponentRate: r.uint() } : null;
  const doneIds = Array.from({ length: r.uintMax(TRADE_IDS_MAX) }, () => r.id());
  const token = r.text(RANKING_TEXT_MAX);
  const unsent = Array.from({ length: r.uintMax(RANKING_UNSENT_MAX) }, () => r.text(RANKING_TEXT_MAX));
  return {
    saveVersion: SAVE_VERSION,
    saveCounter,
    playerName,
    settings: { ...settings, lang: lang === 1 ? 'kanji' : 'hira' },
    playerId,
    decks,
    selectedDeck,
    collection,
    unlockAll: (flags & FLAG.unlockAll) !== 0,
    coins,
    stats,
    cpuStats,
    loginBonus,
    dailyReward,
    story: { stages },
    rate,
    rateStats,
    lastRateOpponentId,
    pendingRateMatch,
    trade: { doneIds },
    ranking: { token, optIn: (flags & FLAG.rankingOptIn) !== 0, unsent },
    updateNoticeSeen: (flags & FLAG.updateNoticeSeen) !== 0,
    tutorial: { done: (flags & FLAG.tutorialDone) !== 0, gachaInviteShown: (flags & FLAG.gachaInviteShown) !== 0 },
  };
}

/** 音量・演出の2バイト（形式版数1〜4で共通） */
function readSettings(r: ByteReader): Omit<Settings, 'lang'> {
  const vol = r.byte();
  const flags = r.byte();
  const bgm = vol >> 4;
  const se = vol & 0x0f;
  const fxSpeed = flags >> 2;
  if (bgm > VOLUME_MAX || se > VOLUME_MAX || fxSpeed > 2) throw new Error('設定の値が範囲外です');
  return { bgm, se, fxSpeed: fxSpeed as 0 | 1 | 2, reduceFx: (flags & 2) !== 0, hints: (flags & 1) !== 0 };
}

/** デッキ count 個（名前 / 枚数 / カードNo×枚数。形式版数1〜4で共通） */
function readDecks(r: ByteReader, count: number): SavedDeck[] {
  return Array.from({ length: count }, (_, i) => {
    const name = r.text(DECK_NAME_MAX) || defaultDeckName(i);
    const n = r.uintMax(LIMITS.deckCards);
    const cards = Array.from({ length: n }, () => r.uintMax(LIMITS.cardNo));
    return { name, cards };
  });
}

/** 形式版数3の本体を読む（形式版数2の本体 ＋ ことば） */
export function readSaveV3(r: ByteReader): SaveDataV3 {
  const v2 = readSaveV2(r);
  const lang = r.byte();
  if (lang > 1) throw new Error('ことば の値が不正です');
  return { ...v2, settings: { ...v2.settings, lang: lang === 1 ? 'kanji' : 'hira' } };
}

/** 形式版数2の本体を読む（形式版数1の本体 ＋ cpuStats） */
export function readSaveV2(r: ByteReader): SaveDataV2 {
  const v1 = readSaveV1(r);
  const cpuStats = Array.from({ length: CPU_LEVEL_COUNT }, () => ({ wins: r.uint(), losses: r.uint() }));
  return { ...v1, cpuStats };
}

/** 形式版数1の本体を読む（先頭の形式版数1バイトは読み終わっている前提） */
export function readSaveV1(r: ByteReader): SaveDataV1 {
  const saveVersion = r.uint();
  if (saveVersion !== SAVE_VERSION) throw new Error(`saveVersion ${saveVersion} は読めません`);
  const saveCounter = r.uint();
  const playerName = r.text(NAME_MAX);
  const settings = readSettings(r);
  const selectedDeck = r.uintMax(OLD_DECK_SLOTS - 1);
  const decks = readDecks(r, OLD_DECK_SLOTS);
  const wins = r.uint();
  const losses = r.uint();
  const coins = r.uint();
  const unlock = r.byte();
  if (unlock > 1) throw new Error('unlockAll の値が不正です');
  const collection = Array.from({ length: r.uintMax(LIMITS.collection) }, () => ({
    no: r.uintMax(LIMITS.cardNo),
    qty: r.uint(),
  }));
  const cleared = Array.from({ length: r.uintMax(LIMITS.story) }, () => r.uint());
  return {
    saveVersion: SAVE_VERSION,
    saveCounter,
    playerName,
    settings,
    decks,
    selectedDeck,
    stats: { wins, losses },
    coins,
    collection,
    unlockAll: unlock === 1,
    story: { cleared },
  };
}
