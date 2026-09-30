import { describe, expect, it } from 'vitest';
import { BattlePlaylist, shuffleRound } from '../src/audio/battlePlaylist';

/** テスト用の種付き乱数（毎回同じ順番になる） */
function seeded(seed: number) {
  // mulberry32
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 2 ** 32;
  };
}

/** 次の曲を count 回とる */
function take(p: BattlePlaylist, count: number) {
  return Array.from({ length: count }, () => p.next());
}

describe('戦闘曲のシャッフル（SPEC §10-2）', () => {
  it('B01 一巡するまで同じ曲は流さない（13曲・50巡）', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const p = new BattlePlaylist(13, seeded(seed));
      for (let round = 0; round < 50; round++) {
        const r = take(p, 13);
        expect(new Set(r).size).toBe(13);
        expect([...r].sort((a, b) => a! - b!)).toEqual([...Array(13).keys()]);
      }
    }
  });

  it('B02 一巡の切れ目でも同じ曲が続かない（2〜13曲）', () => {
    for (let n = 2; n <= 13; n++) {
      for (let seed = 1; seed <= 30; seed++) {
        const r = take(new BattlePlaylist(n, seeded(seed * 97 + n)), n * 40);
        for (let i = 1; i < r.length; i++) expect(r[i]).not.toBe(r[i - 1]);
      }
    }
  });

  it('B03 2曲なら交互に流れる', () => {
    const r = take(new BattlePlaylist(2, seeded(5)), 10);
    for (let i = 2; i < r.length; i++) expect(r[i]).toBe(r[i - 2]);
    expect(r[0]).not.toBe(r[1]);
  });

  it('B04 前回流れた曲（読み込み直し・再戦の前）から始めない', () => {
    for (let n = 2; n <= 13; n++) {
      for (let last = 0; last < n; last++) {
        for (let seed = 1; seed <= 10; seed++) {
          expect(new BattlePlaylist(n, seeded(seed * 31 + last), last).next()).not.toBe(last);
        }
      }
    }
  });

  it('B05 1曲だけなら、その曲をくり返す（止まらない）', () => {
    expect(take(new BattlePlaylist(1, seeded(1)), 5)).toEqual([0, 0, 0, 0, 0]);
    expect(take(new BattlePlaylist(1, seeded(1), 0), 3)).toEqual([0, 0, 0]);
  });

  it('B06 0曲なら null（無音。止まらない）', () => {
    expect(take(new BattlePlaylist(0, seeded(1)), 3)).toEqual([null, null, null]);
    expect(shuffleRound(0, null, seeded(1))).toEqual([]);
  });

  it('B07 前回の曲が範囲外（曲を減らした後など）でも動く', () => {
    const r = take(new BattlePlaylist(3, seeded(2), 12), 3);
    expect(new Set(r).size).toBe(3);
  });

  it('B08 最初の曲はかたよらない（どの曲からも始まる）', () => {
    const first = new Set<number | null>();
    for (let seed = 1; seed <= 200; seed++) first.add(new BattlePlaylist(13, seeded(seed)).next());
    expect(first.size).toBe(13);
  });

  it('B09 乱数が 0 や 1 に近い値でも範囲外にならない', () => {
    for (const v of [0, 0.999999999]) {
      const r = take(new BattlePlaylist(4, () => v, 0), 12);
      for (const i of r) expect(i).toBeGreaterThanOrEqual(0), expect(i).toBeLessThan(4);
      for (let i = 1; i < r.length; i++) expect(r[i]).not.toBe(r[i - 1]);
    }
  });
});
