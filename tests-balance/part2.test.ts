import { it } from 'vitest';
import { OTEGE, duelRate, writeRaw } from './lib';

/** 2. 1対1の総当たり：全おてあげの組み合わせ（同じおてあげどうしも）を、先攻・後攻を入れかえて1000試合ずつ */
export const DUEL_GAMES = 1000;

it('2. 1対1の総当たり', () => {
  const nos = OTEGE.map((c) => c.no);
  const rate: Record<number, Record<number, number>> = {};
  const draws: Record<number, Record<number, number>> = {};
  for (const a of nos) {
    rate[a] = {};
    draws[a] = {};
  }
  for (let i = 0; i < nos.length; i++) {
    for (let j = i; j < nos.length; j++) {
      const r = duelRate(nos[i], nos[j], DUEL_GAMES);
      rate[nos[i]][nos[j]] = r.rate;
      rate[nos[j]][nos[i]] = 1 - r.rate;
      draws[nos[i]][nos[j]] = r.draws;
      draws[nos[j]][nos[i]] = r.draws;
    }
  }
  writeRaw('part2', { games: DUEL_GAMES, nos, rate, draws });
}, 60 * 60 * 1000);
