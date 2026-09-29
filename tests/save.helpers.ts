import { type SaveData, DECK_SLOTS, defaultDeckName } from '../src/save/saveData';

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

/** ランダムなセーブデータ（名前・デッキ・数値の大きさもばらばら） */
export function randomSave(seed: number): SaveData {
  const r = makeRandom(seed);
  const text = (min: number, max: number) => Array.from({ length: r.int(min, max) }, () => r.pick(CHARS)).join('');
  const bigOrSmall = () => (r.next() < 0.7 ? r.int(0, 200) : r.int(0, 2 ** 40));
  return {
    saveVersion: 1,
    saveCounter: bigOrSmall(),
    playerName: text(0, 8),
    settings: {
      bgm: r.int(0, 10),
      se: r.int(0, 10),
      fxSpeed: r.int(0, 2) as 0 | 1 | 2,
      reduceFx: r.next() < 0.5,
      hints: r.next() < 0.5,
    },
    decks: Array.from({ length: DECK_SLOTS }, (_, i) => ({
      name: r.next() < 0.5 ? defaultDeckName(i) : text(1, 8),
      cards: Array.from({ length: r.pick([0, 3, 15, 15]) }, () => r.pick([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 200, 9999])),
    })),
    selectedDeck: r.int(0, 4),
    stats: { wins: bigOrSmall(), losses: bigOrSmall() },
    coins: bigOrSmall(),
    collection: Array.from({ length: r.int(0, 5) }, () => ({ no: r.int(1, 300), qty: r.int(0, 99) })),
    unlockAll: r.next() < 0.5,
    story: { cleared: Array.from({ length: r.int(0, 5) }, () => r.int(1, 50)) },
  };
}
