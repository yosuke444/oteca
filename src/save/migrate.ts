import { STARTER_COINS, starterCollection } from '../data/starterDeck';
import {
  ByteReader,
  FORMAT_VERSION,
  type SaveDataV1,
  type SaveDataV2,
  type SaveDataV3,
  type SaveDataV4,
  readSaveV1,
  readSaveV2,
  readSaveV3,
  readSaveV4,
  readSaveV5,
} from './binary';
import { COINS_MAX, DECK_SLOTS, OWN_MAX, type SaveData, defaultDeckName, emptyCpuStats, emptyDaily, laterFieldsDefault } from './saveData';

/**
 * 形式版数を見て、古い形式なら最新の SaveData へ変換する（SPEC §12-3）
 *
 * 形式を変える時の手順（CLAUDE.md 守ること7）：
 *  1. binary.ts の FORMAT_VERSION を上げ、encodeSave を新しい形式にする
 *  2. 新しい形式の読み方（readSaveV4 など）を READERS に足す
 *  3. 1つ前の形式から変換する関数を UPGRADES に足す
 *  4. テスト V05 に、古い形式のバイト列を読めることの確認を足す
 */

/** 形式版数ごとの読み方。読んだ結果は「その版の形」 */
const READERS: Record<number, (r: ByteReader) => unknown> = {
  1: readSaveV1,
  2: readSaveV2,
  3: readSaveV3,
  4: readSaveV4,
  5: readSaveV5,
};

/** 版 n の形 → 版 n+1 の形 への変換 */
const UPGRADES: Record<number, (old: unknown) => unknown> = {
  /** 1 → 2（v1.4）：CPU対戦の勝敗を足す（全部0） */
  1: (old) => ({ ...(old as SaveDataV1), cpuStats: emptyCpuStats() }) satisfies SaveDataV2,
  /** 2 → 3（v2.0-A）：ことばを足す（にほんご） */
  2: (old) => {
    const d = old as SaveDataV2;
    return { ...d, settings: { ...d.settings, lang: 'hira' } } satisfies SaveDataV3;
  },
  /** 3 → 4（v2.0-B）：カードの所持・デッキ20個など（SPEC §12-3b） */
  3: (old) => upgradeToV4(old as SaveDataV3),
  /** 4 → 5（v2.1-L）：ログボの日付を、その日の0時の時刻に（SPEC §12-3c）。tutorial.step と daily を足す */
  4: (old) => upgradeToV5(old as SaveDataV4),
};

/** YYYYMMDD → その日の0時（端末の時刻）のミリ秒。0 や壊れた日付は 0 */
export function dayStartMs(key: number): number {
  if (!Number.isInteger(key) || key <= 0) return 0;
  const y = Math.floor(key / 10000);
  const m = Math.floor(key / 100) % 100;
  const d = key % 100;
  if (m < 1 || m > 12 || d < 1 || d > 31) return 0;
  const date = new Date(y, m - 1, d);
  // 2月31日などは次の月に繰り越されるので、元の年・月・日と同じか確かめる
  if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) return 0;
  const t = date.getTime();
  return Number.isSafeInteger(t) && t > 0 ? t : 0;
}

/** 形式版数4 → 5（UPDATE_v2_1 §2-2・§7） */
export function upgradeToV5(d: SaveDataV4): SaveData {
  const { loginBonus, tutorial, ...rest } = d;
  return {
    ...rest,
    // 受け取っていた日の0時に受け取った扱い（今日受け取っていた人は、次の0時にまた受け取れる。v2.0 と同じ）
    loginBonus: { claimedAt: dayStartMs(loginBonus.lastDate) },
    tutorial: { ...tutorial, step: 0 },
    daily: emptyDaily(),
  };
}

/**
 * 今までのプレイヤーの移行（SPEC §12-3b・UPDATE_v2 §3-1）。
 * 初期カード15枚とコイン200枚を配り、各カードの所持数を
 * 「初期カードの枚数」「保存デッキのうち一番多く入れているデッキの枚数」「今までの collection の枚数」の最大にする。
 * 在庫はデッキごとなので、これで保存していたデッキはすべて使えるままになる。
 */
export function upgradeToV4(d: SaveDataV3): SaveDataV4 {
  const collection: Record<number, number> = { ...starterCollection() };
  const raise = (no: number, qty: number) => {
    if (!Number.isInteger(no) || no <= 0) return;
    collection[no] = Math.min(OWN_MAX, Math.max(collection[no] ?? 0, qty));
  };
  for (const deck of d.decks) {
    const counts = new Map<number, number>();
    for (const no of deck.cards) counts.set(no, (counts.get(no) ?? 0) + 1);
    for (const [no, qty] of counts) raise(no, qty);
  }
  for (const c of d.collection) raise(c.no, c.qty);
  return {
    saveVersion: d.saveVersion,
    saveCounter: d.saveCounter,
    playerName: d.playerName,
    settings: d.settings,
    // デッキは名前・中身・並び順もそのまま。足りない分（6〜20個目）を空で足す
    decks: Array.from({ length: DECK_SLOTS }, (_, i) => {
      const deck = d.decks[i];
      return deck ? { name: deck.name, cards: [...deck.cards] } : { name: defaultDeckName(i), cards: [] };
    }),
    selectedDeck: d.selectedDeck,
    collection,
    unlockAll: false,
    coins: Math.min(COINS_MAX, d.coins + STARTER_COINS),
    stats: d.stats,
    cpuStats: d.cpuStats,
    story: { stages: [...new Set(d.story.cleared)].sort((a, b) => a - b).map((no) => ({ no, cleared: true, firstClear: true })) },
    updateNoticeSeen: false,
    ...laterFieldsV4(),
  };
}

/** 形式版数4の時の「後の項目」の初期値（3 → 4 の変換用） */
function laterFieldsV4(): Pick<SaveDataV4, 'playerId' | 'loginBonus' | 'dailyReward' | 'rate' | 'rateStats' | 'lastRateOpponentId' | 'pendingRateMatch' | 'trade' | 'ranking' | 'tutorial'> {
  const { daily: _daily, loginBonus: _lb, tutorial: _t, ...rest } = laterFieldsDefault();
  return { ...rest, loginBonus: { lastDate: 0 }, tutorial: { done: false, gachaInviteShown: false } };
}

/** バイト列 → 最新の SaveData。読めなければエラー */
export function decodeSave(bytes: Uint8Array): SaveData {
  const r = new ByteReader(bytes);
  const version = r.byte();
  const read = READERS[version];
  if (!read) throw new Error(`形式版数 ${version} は読めません`);
  let data = read(r);
  if (!r.done) throw new Error('データの後ろに余分なバイトがあります');
  data = migrate(version, data);
  return data as SaveData;
}

/** 版 from の形のデータを、最新の形まで順に変換する */
export function migrate(from: number, data: unknown): unknown {
  let v = from;
  let d = data;
  while (v < FORMAT_VERSION) {
    const up = UPGRADES[v];
    if (!up) throw new Error(`形式版数 ${v} からの変換がありません`);
    d = up(d);
    v += 1;
  }
  return d;
}
