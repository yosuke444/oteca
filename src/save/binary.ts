import { hexToUserId, isUserId, userIdToHex } from './userId';
import {
  CARD_NO_MAX,
  CPU_LEVEL_COUNT,
  DAILY_MISSIONS_MAX,
  DAILY_MISSION_IDS,
  DECK_CARDS_MAX,
  DECK_NAME_MAX,
  DECK_SLOTS,
  NAME_MAX,
  OWN_MAX,
  RANKING_TEXT_MAX,
  RANKING_UNSENT_MAX,
  SAVE_VERSION,
  TRADE_IDS_MAX,
  TROPHIES_MAX,
  TROPHY_NUMBER_MAX,
  TUTORIAL_STEP_MAX,
  VOLUME_MAX,
  type Ranking,
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
 * 1＝v1.3 まで／2＝v1.4（末尾に cpuStats）／3＝v2.0-A（末尾に lang）／4＝v2.0-B（デッキ20個・所持カードなど。並びを作り直した）／
 * 5＝v2.1-L（ログボは受け取った時刻 claimedAt、末尾に tutorial.step と daily）／
 * 6＝v2.1-N（並びは5と同じ。ストーリーのステージ番号を新しいマップの番号に付け替えた印）／
 * 7＝v2.0-I（印に ranking.provisional、末尾に ranking.syncedAt と ranking.playedAt）／
 * 8＝v2.0-J（印に userIdRegistered、末尾に userId と ranking.lastMatchId。直前の相手・レート対戦中の相手はユーザーID）／
 * 9＝v2.0-J（末尾にトロフィーの一覧）／
 * 10＝v2.4（末尾に レート対戦中の印の試合ID と「始まったか」、フレンド対戦中の印）
 */
export const FORMAT_VERSION = 10;

/** 形式版数9の形（レート対戦中の印に試合ID・始まったか が無い。フレンド対戦中の印が無い） */
export type SaveDataV9 = Omit<SaveData, 'pendingRateMatch' | 'pendingFriendMatch'> & { pendingRateMatch: { opponentId: string; opponentRate: number } | null };

/** 形式版数8の形（トロフィーが無い） */
export type SaveDataV8 = Omit<SaveDataV9, 'trophies'>;

/** 形式版数7のランキングの項目（lastMatchId が無い） */
export type RankingV7 = Omit<Ranking, 'lastMatchId'>;

/** 形式版数7の形（v2.0-I。ユーザーID が無い。直前の相手などは playerId） */
export type SaveDataV7 = Omit<SaveDataV8, 'userId' | 'userIdRegistered' | 'ranking'> & { ranking: RankingV7 };

/** 形式版数6までのランキングの項目（token・optIn・unsent だけ） */
export type RankingV6 = { token: string; optIn: boolean; unsent: string[] };

/** 形式版数5・6の形（v2.1-L〜N。ランキングの「かり」と受け取った時刻が無い） */
export type SaveDataV6 = Omit<SaveDataV7, 'ranking'> & { ranking: RankingV6 };

/** 形式版数4の形（v2.0-B。ログボは日付、tutorial.step・daily が無い） */
export type SaveDataV4 = Omit<SaveDataV6, 'loginBonus' | 'tutorial' | 'daily'> & {
  loginBonus: { lastDate: number };
  tutorial: { done: boolean; gachaInviteShown: boolean };
};

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
const FLAG = { unlockAll: 1, updateNoticeSeen: 2, tutorialDone: 4, gachaInviteShown: 8, rankingOptIn: 16, rankingProvisional: 32, userIdRegistered: 64 } as const;

/** 最新の形式（形式版数10）でバイト列にする */
export function encodeSave(data: SaveData): Uint8Array {
  return encodeBody(data, FORMAT_VERSION as 10);
}

/**
 * 形式版数4〜7の並び（SPEC §12-3）。version 4〜6 はテストで「古い形式の固定のバイト列」を作るためだけに使う。
 * 5 は 4 と同じ並びで、ログボが時刻になり、末尾に tutorial.step と daily が付く。6 は 5 と同じ並び（ステージ番号の付け替えの印）。
 * 7 は 6 と同じ並びで、印に ranking.provisional、末尾に ranking.syncedAt と ranking.playedAt が付く
 */
export function encodeBody(data: SaveData | SaveDataV9 | SaveDataV8 | SaveDataV7 | SaveDataV6 | SaveDataV4, version: 4 | 5 | 6 | 7 | 8 | 9 | 10): Uint8Array {
  /** 形式版数8から、相手の ID はユーザーID（数を16進数にして8バイトの場所に入れる） */
  const oppId = (id: string) => (version >= 8 ? userIdToHex(id) : id);
  const w = new ByteWriter();
  w.byte(version);
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
      (data.ranking.optIn ? FLAG.rankingOptIn : 0) |
      (version >= 7 && (data as SaveData).ranking.provisional ? FLAG.rankingProvisional : 0) |
      (version >= 8 && (data as SaveData).userIdRegistered ? FLAG.userIdRegistered : 0),
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
  w.uint(version >= 5 ? (data as SaveDataV6).loginBonus.claimedAt : (data as SaveDataV4).loginBonus.lastDate);
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
  w.id(oppId(data.lastRateOpponentId));
  if (data.pendingRateMatch) {
    w.byte(1);
    w.id(oppId(data.pendingRateMatch.opponentId));
    w.uint(data.pendingRateMatch.opponentRate);
  } else {
    w.byte(0);
  }
  w.uint(data.trade.doneIds.length);
  for (const id of data.trade.doneIds) w.id(id);
  w.text(data.ranking.token);
  w.uint(data.ranking.unsent.length);
  for (const u of data.ranking.unsent) w.text(u);
  if (version >= 5) {
    const d = data as SaveDataV6;
    // 読む時と同じ範囲（超えていたら、読めないセーブを書かないようにエラー）
    if (d.tutorial.step > TUTORIAL_STEP_MAX) throw new Error(`tutorial.step が範囲外です: ${d.tutorial.step}`);
    if (d.daily.missions.length > DAILY_MISSIONS_MAX) throw new Error('デイリーミッションが多すぎます');
    if (new Set(d.daily.missions.map((m) => m.id)).size !== d.daily.missions.length) throw new Error('同じデイリーミッションが2つあります');
    w.uint(d.tutorial.step);
    w.uint(d.daily.cycleKey);
    w.uint(d.daily.missions.length);
    for (const m of d.daily.missions) {
      const k = DAILY_MISSION_IDS.indexOf(m.id);
      if (k < 0) throw new Error(`デイリーミッションの種類が不正です: ${m.id}`);
      w.byte(k);
      w.uint(m.progress);
      w.byte(m.claimed ? 1 : 0);
    }
    w.byte(d.daily.allClearClaimed ? 1 : 0);
  }
  if (version >= 7) {
    w.uint((data as SaveData).ranking.syncedAt);
    w.uint((data as SaveData).ranking.playedAt);
  }
  if (version >= 8) {
    const d = data as SaveData;
    w.uint(isUserId(d.userId) ? Number(d.userId) : 0);
    w.id(d.ranking.lastMatchId);
  }
  if (version >= 9) {
    const list = (data as SaveData).trophies;
    if (list.length > TROPHIES_MAX) throw new Error('トロフィーが多すぎます');
    w.uint(list.length);
    for (const t of list) {
      if (!Number.isInteger(t.number) || t.number < 1 || t.number > TROPHY_NUMBER_MAX) throw new Error(`トロフィーの番号が範囲外です: ${t.number}`);
      w.uint(t.number);
      w.uint(t.receivedAt);
    }
  }
  if (version >= 10) {
    const d = data as SaveData;
    // レート対戦中の印があれば、その試合ID と「始まったか」
    if (d.pendingRateMatch) {
      w.id(d.pendingRateMatch.matchId);
      w.byte(d.pendingRateMatch.begun ? 1 : 0);
    }
    if (d.pendingFriendMatch) {
      w.byte(1);
      w.id(userIdToHex(d.pendingFriendMatch.opponentId));
    } else {
      w.byte(0);
    }
  }
  return w.toBytes();
}

/** 形式版数10の本体を読む（形式版数9 の並び ＋ 末尾の レート対戦中の印の続き・フレンド対戦中の印） */
export function readSaveV10(r: ByteReader): SaveData {
  const v9 = readSaveV9(r);
  const p = v9.pendingRateMatch;
  let pendingRateMatch: SaveData['pendingRateMatch'] = null;
  if (p) {
    const matchId = r.id();
    const begun = r.byte();
    if (begun > 1) throw new Error('レート対戦中の印の値が不正です');
    pendingRateMatch = { ...p, matchId, begun: begun === 1 };
  }
  const hasFriend = r.byte();
  if (hasFriend > 1) throw new Error('フレンド対戦中の印の値が不正です');
  const pendingFriendMatch = hasFriend === 1 ? { opponentId: hexToUserId(r.id()) } : null;
  return { ...v9, pendingRateMatch, pendingFriendMatch };
}

/** 形式版数9の本体を読む（形式版数8 の並び ＋ 末尾のトロフィーの一覧） */
export function readSaveV9(r: ByteReader): SaveDataV9 {
  const v8 = readSaveV8(r);
  const n = r.uintMax(TROPHIES_MAX);
  const trophies = Array.from({ length: n }, () => {
    const number = r.uint();
    if (number < 1 || number > TROPHY_NUMBER_MAX) throw new Error('トロフィーの番号が範囲外です');
    return { number, receivedAt: r.uint() };
  });
  return { ...v8, trophies };
}

/** 形式版数8の本体を読む（形式版数7 の並び ＋ 印の userIdRegistered ＋ 末尾の userId・ranking.lastMatchId。相手の ID はユーザーID） */
export function readSaveV8(r: ByteReader): SaveDataV8 {
  const { data, flags } = readV7Body(r, 127);
  const n = r.uint();
  const userId = n === 0 ? '' : String(n);
  if (userId && !isUserId(userId)) throw new Error('ユーザーID の値が不正です');
  const lastMatchId = r.id();
  const pending = data.pendingRateMatch;
  return {
    ...data,
    userId,
    userIdRegistered: (flags & FLAG.userIdRegistered) !== 0,
    lastRateOpponentId: hexToUserId(data.lastRateOpponentId),
    pendingRateMatch: pending ? { ...pending, opponentId: hexToUserId(pending.opponentId) } : null,
    ranking: { ...data.ranking, lastMatchId },
  };
}

/** 形式版数7の本体を読む（形式版数6 の並び ＋ 印の ranking.provisional ＋ 末尾の ranking.syncedAt・playedAt） */
export function readSaveV7(r: ByteReader): SaveDataV7 {
  return readV7Body(r, 63).data;
}

function readV7Body(r: ByteReader, flagMax: number): { data: SaveDataV7; flags: number } {
  const { data, flags } = readV5Body(r, flagMax);
  const syncedAt = r.uint();
  const playedAt = r.uint();
  return { data: { ...data, ranking: { ...data.ranking, provisional: (flags & FLAG.rankingProvisional) !== 0, syncedAt, playedAt } }, flags };
}

/** 形式版数5（と6）の本体を読む（先頭の形式版数1バイトは読み終わっている前提） */
export function readSaveV5(r: ByteReader): SaveDataV6 {
  return readV5Body(r, 31).data;
}

function readV5Body(r: ByteReader, flagMax: number): { data: SaveDataV6; flags: number } {
  const { data: v4, flags } = readV4Body(r, flagMax);
  const step = r.uintMax(TUTORIAL_STEP_MAX);
  const cycleKey = r.uint();
  const seen = new Set<number>();
  const missions = Array.from({ length: r.uintMax(DAILY_MISSIONS_MAX) }, () => {
    const k = r.byte();
    if (k >= DAILY_MISSION_IDS.length || seen.has(k)) throw new Error('デイリーミッションの種類が不正です');
    seen.add(k);
    const progress = r.uint();
    const claimed = r.byte();
    if (claimed > 1) throw new Error('デイリーミッションの印が不正です');
    return { id: DAILY_MISSION_IDS[k], progress, claimed: claimed === 1 };
  });
  const allClear = r.byte();
  if (allClear > 1) throw new Error('デイリーミッションの印が不正です');
  const { loginBonus, tutorial, ...rest } = v4;
  const data: SaveDataV6 = {
    ...rest,
    // 形式版数5では、この場所に受け取った時刻が入っている
    loginBonus: { claimedAt: loginBonus.lastDate },
    tutorial: { ...tutorial, step },
    daily: { cycleKey, missions, allClearClaimed: allClear === 1 },
  };
  return { data, flags };
}

/** 形式版数4の本体を読む（先頭の形式版数1バイトは読み終わっている前提。形式版数5〜7もここまでは同じ並び） */
export function readSaveV4(r: ByteReader): SaveDataV4 {
  return readV4Body(r, 31).data;
}

/** @param flagMax 印の1バイトの上限（形式版数7 で ranking.provisional（32）が増えた） */
function readV4Body(r: ByteReader, flagMax: number): { data: SaveDataV4; flags: number } {
  const saveVersion = r.uint();
  if (saveVersion !== SAVE_VERSION) throw new Error(`saveVersion ${saveVersion} は読めません`);
  const saveCounter = r.uint();
  const playerName = r.text(NAME_MAX);
  const settings = readSettings(r);
  const lang = r.byte();
  if (lang > 1) throw new Error('ことば の値が不正です');
  const flags = r.byte();
  if (flags > flagMax) throw new Error('印の値が不正です');
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
  const data: SaveDataV4 = {
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
  return { data, flags };
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
