import { describe, expect, it } from 'vitest';
import { CPU_LEVELS, type CpuLevel, decide } from '../src/cpu/brains';
import { seededRand } from '../src/cpu/random';
import { CpuController } from '../src/controllers/cpu';
import { Match } from '../src/controllers/match';
import { CARD_DB } from '../src/data/cards';
import { type GameState, applyAction } from '../src/engine';
import { arrange, deckOf, startMain } from './helpers';
import { decks, midGameStates, tamper } from './cpu.helpers';

/**
 * CPU対戦（SPEC §13-5・§16-1b）の軽いテスト。
 * CPU 同士の大量対戦（C01・C05）・さいきょうの試算（C02・C03）は重いので cpu.levels.slow.test.ts（npm run test:slow）。
 * 強さの順番（C04）はさらに時間がかかるので npm run ladder で別に動かす
 */


describe('C02b 山札から選ぶ時（ひきかえカード）も、山札の順番を見ない', () => {
  it('選べるカード（自分の山札）の並びを変えても、どの強さも同じカードを選ぶ', () => {
    let s = startMain({ decks: { p1: deckOf([['oteage', 5], ['mitsume', 3], ['kami', 1], ['kusuri', 3], ['hikikae', 3]]), p2: deckOf([['mutsuashi', 15]]) } });
    s = arrange(s, 'p1', { active: 'oteage', hand: ['hikikae'] });
    s = applyAction(s, { type: 'USE_ITEM', player: 'p1', uid: s.players.p1.hand[0] }).state;
    expect(s.phase).toBe('choose');
    const nos = (st: GameState, uids: string[]) => uids.map((u) => st.cards[u].no).sort((a, b) => a - b);
    for (const level of CPU_LEVELS) {
      const opts = level === 'strongest' ? { maxRollouts: 30, timeMs: 1e9 } : {};
      const a = decide(level, s, 'p1', seededRand(3), opts);
      expect(a?.type).toBe('CHOOSE');
      const t = structuredClone(s);
      t.players.p1.deck.reverse();
      t.pendingChoice!.options.reverse();
      t.rng = [9, 8, 7, 6];
      const b = decide(level, t, 'p1', seededRand(3), opts);
      // 同じ種類のカードは見分けられないので、カードNo で比べる
      expect(b && b.type === 'CHOOSE' ? nos(t, b.uids) : null, level).toEqual(a && a.type === 'CHOOSE' ? nos(s, a.uids) : null);
    }
  });
});

describe('C02 CPU は相手の手札・山札の順番・この先のサイコロを見ない', () => {
  const states = midGameStates();
  it('試合の途中の場面がそろっている', () => expect(states.length).toBeGreaterThanOrEqual(10));
  for (const level of CPU_LEVELS.filter((l) => l !== 'strongest')) {
    it(`${level}：見えない情報を変えても、同じ手を選ぶ`, () => {
      const opts = {};
      for (const [i, { state, side }] of states.entries()) {
        const base = decide(level, state, side, seededRand(7 + i), opts);
        for (let k = 0; k < 3; k++) {
          const other = decide(level, tamper(state, side, k), side, seededRand(7 + i), opts);
          expect(other, `場面 ${i}・書きかえ ${k}`).toEqual(base);
        }
      }
    }, 120000);
  }
});

describe('CPU のスタンプ（SPEC §7 S10）', () => {
  it('出来事があると送るが、6秒以上あけて送る（送りすぎない）。決着の時は送らない', () => {
    let clock = 0;
    const sent: { id: number; at: number }[] = [];
    const pending: (() => void)[] = [];
    const sched = (fn: () => void) => {
      pending.push(fn);
      return null;
    };
    const hooks = (level: CpuLevel) => ({
      level,
      random: () => 0, // 確率は いつも当たり
      now: () => clock,
      later: (fn: () => void) => fn(), // 遅らせずにすぐ出す
      onStamp: (id: number) => sent.push({ id, at: clock }),
    });
    const match = new Match({ seed: 'stamp', decks, cardDb: CARD_DB }, { p1: new CpuController('p1', sched, hooks('strong')), p2: new CpuController('p2', sched, hooks('strong')) });
    match.notifyIdle();
    let steps = 0;
    while (pending.length > 0 && steps < 3000) {
      pending.shift()!();
      clock += 700; // 1手 0.7秒 として進める
      match.notifyIdle();
      steps += 1;
    }
    expect(match.state.phase).toBe('over');
    expect(sent.length).toBeGreaterThan(0);
    // 最初のターンの「よろしく！」
    expect(sent[0].id).toBe(0);
    // 両方の CPU の分が混ざっているので、出来事の数より少ない（6秒あける）ことと、決着のスタンプ（4・5）が無いこと
    expect(sent.every((x) => x.id !== 4 && x.id !== 5)).toBe(true);
    expect(sent.length).toBeLessThan(steps);
    match.dispose();
  });

  it('1人の CPU は、6秒より短い間隔では送らない', () => {
    let clock = 0;
    const sent: number[] = [];
    const pending: (() => void)[] = [];
    const sched = (fn: () => void) => {
      pending.push(fn);
      return null;
    };
    const cpu = new CpuController('p2', sched, { level: 'strong', random: () => 0, now: () => clock, later: (fn) => fn(), onStamp: () => sent.push(clock) });
    const match = new Match({ seed: 'stamp2', decks, cardDb: CARD_DB }, { p1: new CpuController('p1', sched), p2: cpu });
    match.notifyIdle();
    for (let steps = 0; pending.length > 0 && steps < 3000; steps++) {
      pending.shift()!();
      clock += 300;
      match.notifyIdle();
    }
    expect(sent.length).toBeGreaterThan(1);
    for (let i = 1; i < sent.length; i++) expect(sent[i] - sent[i - 1]).toBeGreaterThanOrEqual(6000);
    match.dispose();
  });
});
