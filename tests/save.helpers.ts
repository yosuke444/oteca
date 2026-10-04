import { type SaveData, DECK_SLOTS, createDefaultSave, defaultDeckName } from '../src/save/saveData';

/** テスト用の種付き乱数（mulberry32） */
export function makeRandom(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (min: number, max: number) => min + Math.floor(next() * (max - min + 1));
  const pick = <T>(list: readonly T[]) => list[int(0, list.length - 1)];
  return { next, int, pick };
}

const CHARS = [...'あいうえおかきくけこオテカABCxyz019ー・！？😀🎲漢字'];

const HEX = [...'0123456789abcdef'];

/** ランダムなセーブデータ（名前・デッキ・数値の大きさもばらばら。保存して読み直すと同じになる値だけ） */
export function randomSave(seed: number): SaveData {
  const r = makeRandom(seed);
  const text = (min: number, max: number) => Array.from({ length: r.int(min, max) }, () => r.pick(CHARS)).join('');
  const bigOrSmall = () => (r.next() < 0.7 ? r.int(0, 200) : r.int(0, 2 ** 40));
  const id = () => (r.next() < 0.3 ? '' : Array.from({ length: 16 }, () => r.pick(HEX)).join('').replace(/^0{16}$/, '1'.padStart(16, '0')));
  const collection: Record<number, number> = {};
  for (let i = r.int(0, 30); i > 0; i--) collection[r.pick([r.int(1, 48), r.int(1, 300)])] = r.int(1, 999);
  return {
    saveVersion: 1,
    saveCounter: bigOrSmall(),
    playerName: text(0, 8),
    settings: {
      bgm: r.int(0, 10),
      se: r.int(0, 10),
      fxSpeed: r.int(0, 2) as 0 | 1 | 2,
      lang: r.int(0, 1) === 1 ? 'kanji' : 'hira',
      reduceFx: r.next() < 0.5,
      hints: r.next() < 0.5,
    },
    playerId: id(),
    decks: Array.from({ length: DECK_SLOTS }, (_, i) => ({
      name: r.next() < 0.5 ? defaultDeckName(i) : text(1, 8),
      cards: Array.from({ length: r.pick([0, 3, 15, 15]) }, () => r.pick([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 48, 200, 9999])),
    })),
    selectedDeck: r.int(0, DECK_SLOTS - 1),
    collection,
    unlockAll: r.next() < 0.5,
    coins: r.int(0, 99999),
    stats: { wins: bigOrSmall(), losses: bigOrSmall() },
    cpuStats: Array.from({ length: 4 }, () => ({ wins: bigOrSmall(), losses: bigOrSmall() })),
    loginBonus: { claimedAt: r.pick([0, 1791000000000, r.int(0, 2 ** 45)]) },
    dailyReward: { date: r.pick([0, 20261002]), count: r.int(0, 30) },
    story: { stages: Array.from({ length: r.int(0, 5) }, (_, i) => ({ no: i * 3 + r.int(0, 2), cleared: r.next() < 0.7, firstClear: r.next() < 0.5 })) },
    rate: bigOrSmall(),
    rateStats: { wins: bigOrSmall(), losses: bigOrSmall(), best: bigOrSmall() },
    lastRateOpponentId: id(),
    pendingRateMatch: r.next() < 0.5 ? null : { opponentId: id() || 'abcdefabcdefabcd', opponentRate: bigOrSmall() },
    trade: { doneIds: Array.from({ length: r.int(0, 20) }, () => id() || '00000000000000ff') },
    ranking: { token: text(0, 40), optIn: r.next() < 0.5, unsent: Array.from({ length: r.int(0, 3) }, () => text(1, 30)), provisional: r.next() < 0.5, syncedAt: r.int(0, 2 ** 42), playedAt: r.int(0, 2 ** 42) },
    updateNoticeSeen: r.next() < 0.5,
    tutorial: { done: r.next() < 0.5, gachaInviteShown: r.next() < 0.5, step: r.pick([0, 16, r.int(0, 255)]) },
    daily: {
      cycleKey: r.pick([0, 20261002, r.int(0, 99999999)]),
      missions: r.pick([[], [{ id: 'draw20', progress: r.int(0, 40), claimed: r.next() < 0.5 }, { id: 'gacha1', progress: 1, claimed: true }, { id: 'ko5', progress: r.int(0, 9), claimed: false }]]),
      allClearClaimed: r.next() < 0.5,
    },
  };
}

/** 全48種（No 1〜48）を各10枚持ち、20スロットすべて15枚（UPDATE_v2 §3-4 の2つ目） */
export function fullCollectionSave(withNames: boolean): SaveData {
  const data = createDefaultSave();
  const r = makeRandom(48);
  data.collection = Object.fromEntries(Array.from({ length: 48 }, (_, i) => [i + 1, 10]));
  // 名前に使う文字（ひらがな・カタカナ。UTF-8 で1文字3バイト）
  const kana = [...'あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめもやゆよらりるれろわをんアイウエオカキクケコデッキ'];
  data.decks = Array.from({ length: DECK_SLOTS }, (_, i) => ({
    name: withNames ? Array.from({ length: 8 }, () => r.pick(kana)).join('') : `デッキ${i + 1}`,
    // 各デッキ：48種からばらばらに15枚（1種10枚まで）
    cards: (() => {
      const deck: number[] = [];
      while (deck.length < 15) {
        const no = r.int(1, 48);
        if (deck.filter((n) => n === no).length < 10) deck.push(no);
      }
      return deck.sort((a, b) => a - b);
    })(),
  }));
  return data;
}


/** 引き継ぎコードの桁数を測る3パターン（UPDATE_v2 §3-4。テスト V13 と scripts/measure-code.mjs で共通） */
export function codeLengthPatterns(playerId: string): [label: string, data: SaveData][] {
  return [
    ['しょきじょうたい', { ...createDefaultSave(), playerId }],
    ['48しゅ×10まい・20スロット×15まい', { ...fullCollectionSave(false), playerId }],
    ['うえ＋8もじの デッキめい', { ...fullCollectionSave(true), playerId }],
  ];
}
