import { STARTER_COINS, starterCollection } from '../data/starterDeck';
import {
  ByteReader,
  FORMAT_VERSION,
  type SaveDataV1,
  type SaveDataV2,
  type SaveDataV3,
  type SaveDataV4,
  type SaveDataV6,
  type SaveDataV7,
  readSaveV1,
  readSaveV2,
  readSaveV3,
  readSaveV4,
  readSaveV5,
  readSaveV7,
  readSaveV8,
  readSaveV9,
  readSaveV10,
  type SaveDataV8,
  type SaveDataV9,
} from './binary';
import { applyRateResult } from '../online/rate';
import { newUserId } from './userId';
import { COINS_MAX, DECK_SLOTS, OWN_MAX, RATE_START, type SaveData, type StoryStage, defaultDeckName, emptyCpuStats, emptyDaily, laterFieldsDefault } from './saveData';

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
  // 形式版数6 は 5 と同じ並び
  6: readSaveV5,
  7: readSaveV7,
  8: readSaveV8,
  9: readSaveV9,
  10: readSaveV10,
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
  /** 5 → 6（v2.1-N）：ストーリーのステージ番号を、新しいマップの番号へ（敵の名前を手がかりに。SPEC §12-3d） */
  5: (old) => upgradeToV6(old as SaveDataV6),
  /** 6 → 7（v2.0-I）：ランキングの「かり」と、正式なレートを受け取った時刻を足す（SPEC §12-3e） */
  6: (old) => upgradeToV7(old as SaveDataV6),
  /** 7 → 8（v2.0-J）：ユーザーID を作る。相手の判別をユーザーID に変えた（SPEC §12-3f） */
  7: (old) => upgradeToV8(old as SaveDataV7),
  /** 8 → 9（v2.0-J）：トロフィーの一覧（空）を足す（SPEC §12-3g） */
  8: (old) => ({ ...(old as SaveDataV8), trophies: [] }) satisfies SaveDataV9,
  /**
   * 9 → 10（v2.4）：レート対戦中の印に試合ID（無し）と「始まった」を足す（今までどおり次に開いた時に負け）。フレンド対戦中の印（無し）を足す
   */
  9: (old) => {
    const d = old as SaveDataV9;
    const p = d.pendingRateMatch;
    return { ...d, pendingRateMatch: p ? { ...p, matchId: '', begun: true } : null, pendingFriendMatch: null } satisfies SaveData;
  },
};

/**
 * 形式版数7 → 8（v2.0-J）：
 * - ユーザーID を1回だけ作る（まだサーバーに登録していない）
 * - 直前の相手（前の playerId）は消す
 * - レート対戦の途中で閉じた印が残っていたら、ここで負けとして計算する（今まで通り「次に開いた時に負け」）
 * - 送れなかった報告は前の playerId で書いてあるので消す
 * @param randomBytes 乱数（テストで差し替える）
 */
export function upgradeToV8(d: SaveDataV7, randomBytes?: (n: number) => Uint8Array): SaveDataV8 {
  const draft = structuredClone(d);
  if (draft.pendingRateMatch) applyRateResult(draft, draft.pendingRateMatch.opponentRate, 'lose');
  return {
    ...draft,
    userId: newUserId(randomBytes),
    userIdRegistered: false,
    lastRateOpponentId: '',
    pendingRateMatch: null,
    ranking: { ...draft.ranking, unsent: [], lastMatchId: '' },
  };
}

/**
 * 形式版数6 → 7（UPDATE_v2 §10）：
 * - provisional：レートが初期値と違えば立てる（サーバーにまだ無い、端末で計算したレートなので「かり」）
 * - syncedAt・playedAt：0（まだ受け取っていない・まだ数えていない）
 * - optIn：今まで使っていなかった値なので、初期値のオンにする
 */
export function upgradeToV7(d: SaveDataV6): SaveDataV7 {
  return { ...d, ranking: { ...d.ranking, optIn: true, provisional: d.rate !== RATE_START, syncedAt: 0, playedAt: 0 } };
}

/**
 * v2.0（形式版数5まで）のステージ番号と敵の名前（UPDATE_v2 §7-3。変えない。移行のための記録。
 * 新しい番号の敵の名前と同じことをテスト N04 で確かめる）
 */
export const OLD_STAGE_NAMES: Record<number, string> = {
  1: 'らくがき こぞう',
  2: 'けしかす',
  3: 'おてあげニンゲン',
  4: 'おしゃべり ペン',
  5: 'まいごの ふせん',
  6: 'よふかし ノート',
  7: 'おてあげウサギ',
  8: 'えんぴつ けずり',
  9: 'あかペン せんせい',
  10: 'はんこ やさん',
  11: 'おてあげザムライ',
  12: 'ぶあつい じしょ',
  13: 'こおりの のり',
  14: 'てつの ふでばこ',
  15: 'おてあげドラゴン',
};

/**
 * 古いステージ番号 → v2.1-N の新しい番号（UPDATE_v2_1 §4-2 の表を、敵の名前で突き合わせたもの）。
 * 移行は固定にする（あとで story.json の名前や番号を変えても、5 → 6 の結果が変わらないように）
 */
export const NEW_STAGE_NO: Record<number, number> = { 1: 1, 2: 2, 3: 3, 4: 4, 5: 7, 6: 8, 7: 11, 8: 6, 9: 10, 10: 13, 11: 14, 12: 5, 13: 9, 14: 12, 15: 15 };

/** 古いステージ番号 → 新しい番号（知らない番号は undefined） */
export function newStageNo(oldNo: number): number | undefined {
  return NEW_STAGE_NO[oldNo];
}

/**
 * 形式版数5 → 6（UPDATE_v2_1 §4-6）：クリア済み・初クリア報酬済みの印を、新しいステージ番号へ移す。
 * 移した結果、前のステージが未クリアなのにクリア済みのステージができても、クリア済みのまま（行けるかは関係ない）。
 * 知らない番号は消す
 */
export function upgradeToV6(d: SaveDataV6): SaveDataV6 {
  const stages = new Map<number, StoryStage>();
  for (const s of d.story.stages) {
    const no = newStageNo(s.no);
    if (no === undefined) continue;
    const prev = stages.get(no);
    stages.set(no, { no, cleared: s.cleared || !!prev?.cleared, firstClear: s.firstClear || !!prev?.firstClear });
  }
  return { ...d, story: { stages: [...stages.values()].sort((a, b) => a.no - b.no) } };
}

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
export function upgradeToV5(d: SaveDataV4): SaveDataV6 {
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
  const { daily: _daily, loginBonus: _lb, tutorial: _t, ranking: _r, ...rest } = laterFieldsDefault();
  // 形式版数4 の時の初期値（「ランキングに のる」はオフ。形式版数7 への移行でオンにする）
  return { ...rest, ranking: { token: '', optIn: false, unsent: [] }, loginBonus: { lastDate: 0 }, tutorial: { done: false, gachaInviteShown: false } };
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
