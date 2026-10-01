import { describe, expect, it } from 'vitest';
import { CPU_LEVELS, type CpuLevel, STRONGEST_SEARCH, decide } from '../src/cpu/brains';
import { seededRand } from '../src/cpu/random';
import { selfPlay } from '../src/cpu/selfPlay';
import { CpuController } from '../src/controllers/cpu';
import { Match } from '../src/controllers/match';
import { CARD_DB, CARD_LIST } from '../src/data/cards';
import { starterDeckNos } from '../src/data/starterDeck';
import { type GameState, type Side, applyAction, createGame } from '../src/engine';

/** CPU対戦（SPEC §13-5・§16-1b）。強さの順番（C04）は時間がかかるので npm run ladder で別に動かす */

const decks = { p1: starterDeckNos(), p2: starterDeckNos() };
/** テストを速くするため、さいきょうの試算は少なめ（止まらないことの確認だけ。本物の回数の確認は npm run ladder） */
const FAST = { maxRollouts: 6, timeMs: 1e9 };

describe('C01 4つの強さすべてで、CPU 同士が止まらずに決着まで対戦できる（各100試合）', () => {
  for (const level of CPU_LEVELS) {
    it(level, () => {
      for (let i = 0; i < 100; i++) {
        const r = selfPlay({ levels: { p1: level, p2: level }, decks, cardDb: CARD_DB, seed: `c01-${level}-${i}`, first: i % 2 ? 'p1' : 'p2', rand: seededRand(i + 1), search: FAST });
        expect(r.state.phase, `${level} ${i} 試合め`).toBe('over');
        expect(r.winner).not.toBeNull();
      }
    }, 120000);
  }
});

/** 試合の途中の状態をいくつか集める（つよい同士で進めて、手番の人が操作する場面） */
function midGameStates(): { state: GameState; side: Side }[] {
  const out: { state: GameState; side: Side }[] = [];
  // 準備中の場面（相手が裏向きでバトル場を選んだ後に、こちらが選ぶ）も入れる
  for (let g = 0; g < 4; g++) {
    let { state } = createGame({ seed: `c02-setup-${g}`, decks, cardDb: CARD_DB, forcedDice: [6, 1] });
    state = applyAction(state, decide('strong', state, 'p2', seededRand(g))!).state;
    out.push({ state, side: 'p1' });
  }
  for (let g = 0; g < 6; g++) {
    let { state } = createGame({ seed: `c02-${g}`, decks, cardDb: CARD_DB, forcedDice: [6, 1] });
    const rand = seededRand(g + 100);
    for (let step = 0; step < 60 && state.phase !== 'over'; step++) {
      const who: Side = state.phase === 'setup' ? (state.players.p1.setupChoice === null ? 'p1' : 'p2') : state.phase === 'promote' ? state.pendingPromote[0] : state.currentPlayer;
      if (state.phase === 'main' && step % 7 === 3) out.push({ state, side: who });
      state = applyAction(state, decide('strong', state, who, rand)!).state;
    }
  }
  return out;
}

/** 見えない情報だけを変える：相手の手札・山札の中身と順番、自分の山札の順番、この先のサイコロ */
function tamper(s: GameState, side: Side, k: number): GameState {
  const t = structuredClone(s);
  const opp: Side = side === 'p1' ? 'p2' : 'p1';
  const nos = CARD_LIST.map((c) => c.no);
  for (const uid of [...t.players[opp].hand, ...t.players[opp].deck]) {
    let no = nos[(nos.indexOf(t.cards[uid].no) + k + 3) % nos.length];
    // 裏向きで選んだバトル場は おてあげのまま（ルール上ありうる形にする）
    if (uid === t.players[opp].setupChoice && CARD_DB[no].kind !== 'otege') no = t.cards[uid].no === nos[0] ? nos[1] : nos[0];
    const def = CARD_DB[no];
    t.cardDefs[no] = def;
    const hp = def.kind === 'otege' ? def.hp : 0;
    t.cards[uid] = { ...t.cards[uid], no, hp, maxHp: hp };
  }
  t.players[opp].deck.reverse();
  t.players[opp].hand.reverse();
  t.players[side].deck.reverse();
  t.rng = [k + 1, k + 2, k + 3, k + 4];
  t.forcedDice = [((k * 5) % 6) + 1];
  return t;
}

describe('C02 CPU は相手の手札・山札の順番・この先のサイコロを見ない', () => {
  const states = midGameStates();
  it('試合の途中の場面がそろっている', () => expect(states.length).toBeGreaterThanOrEqual(10));
  for (const level of CPU_LEVELS) {
    it(`${level}：見えない情報を変えても、同じ手を選ぶ`, () => {
      const opts = level === 'strongest' ? { maxRollouts: 40, timeMs: 1e9 } : {};
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

describe('C03 さいきょうの1回の判断は1.5秒以内', () => {
  it('試合の途中の場面で、本物の考える量（STRONGEST_SEARCH）', () => {
    const states = midGameStates().slice(0, 6);
    for (const { state, side } of states) {
      const t = performance.now();
      const a = decide('strongest', state, side, seededRand(1), { ...STRONGEST_SEARCH, now: () => performance.now() });
      const ms = performance.now() - t;
      expect(a).not.toBeNull();
      expect(ms).toBeLessThan(1500);
    }
  }, 60000);
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
