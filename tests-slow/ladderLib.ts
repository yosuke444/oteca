import { mkdirSync, writeFileSync } from 'node:fs';
import { expect } from 'vitest';
import { type CpuLevel, STRONGEST_SEARCH } from '../src/cpu/brains';
import { seededRand } from '../src/cpu/random';
import { selfPlay } from '../src/cpu/selfPlay';
import { CARD_DB } from '../src/data/cards';
import { starterDeckNos } from '../src/data/starterDeck';
import type { Side } from '../src/engine/types';

/**
 * 強さの順番の確認（SPEC §16 C04）。隣の強さ同士を、同じデッキ（初期デッキ）で対戦させる。
 * 同じ種で「上の強さが先攻」「下の強さが先攻」の2試合を1組にして、先攻後攻の有利不利を打ち消す。
 * さいきょうの考える量は、画面と同じ STRONGEST_SEARCH の回数（時間ではなく回数で決まるので、PC の速さで変わらない）。
 */
export function ladder(upper: CpuLevel, lower: CpuLevel, from: number, to: number) {
  const decks = { p1: starterDeckNos(), p2: starterDeckNos() };
  let upperWins = 0;
  let upperFirstWins = 0;
  let upperSecondWins = 0;
  let games = 0;
  let steps = 0;
  const t0 = Date.now();
  for (let k = from; k < to; k++) {
    for (const upperFirst of [true, false]) {
      // 上の強さは p1。先攻は先攻決めのサイコロで決める
      const first: Side = upperFirst ? 'p1' : 'p2';
      const r = selfPlay({
        levels: { p1: upper, p2: lower },
        decks,
        cardDb: CARD_DB,
        seed: `ladder-${upper}-${lower}-${k}`,
        first,
        rand: seededRand(k * 2 + (upperFirst ? 1 : 2)),
        search: { maxRollouts: STRONGEST_SEARCH.maxRollouts, timeMs: 1e9 },
      });
      expect(r.state.phase).toBe('over');
      games += 1;
      steps += r.steps;
      if (r.winner === 'p1') {
        upperWins += 1;
        if (upperFirst) upperFirstWins += 1;
        else upperSecondWins += 1;
      }
    }
  }
  const result = { upper, lower, from, to, games, upperWins, upperFirstWins, upperSecondWins, avgSteps: steps / games, seconds: (Date.now() - t0) / 1000 };
  mkdirSync('tests-slow/results', { recursive: true });
  writeFileSync(`tests-slow/results/${upper}-${lower}-${from}.json`, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
  return result;
}
