import { describe, expect, it } from 'vitest';
import { CPU_LEVELS, STRONGEST_SEARCH, decide } from '../src/cpu/brains';
import { seededRand } from '../src/cpu/random';
import { selfPlay } from '../src/cpu/selfPlay';
import { CARD_DB } from '../src/data/cards';
import { DEFAULT_RULES, applyAction, createGame, validateDeck } from '../src/engine';
import { autoFill } from '../src/scenes/DeckEdit/deckOps';
import { FAST, decks, midGameStates, tamper } from './cpu.helpers';

/** 重いテスト（npm run test:slow）：CPU 同士の大量対戦・さいきょうの試算（SPEC §16-1b） */

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

describe('C05 全カード（48種）を使ったランダムなデッキで、4つの強さすべてが止まらずに決着する（各100試合。カードを選ぶ操作を含む）', () => {
  /** 全カードからデッキのルールを守って15枚（所持数は気にしない） */
  const randomDeck = (seed: number) => autoFill([], CARD_DB, DEFAULT_RULES, () => Infinity, seededRand(seed));
  const used = new Set<number>();
  const chooses: Record<string, number> = { discard: 0, search: 0, switch: 0 };
  for (const level of CPU_LEVELS) {
    it(level, () => {
      for (let i = 0; i < 100; i++) {
        const d = { p1: randomDeck(i * 2 + 1), p2: randomDeck(i * 2 + 2) };
        expect(validateDeck(d.p1, CARD_DB)).toEqual([]);
        for (const no of [...d.p1, ...d.p2]) used.add(no);
        const r = selfPlay({ levels: { p1: level, p2: level }, decks: d, cardDb: CARD_DB, seed: `c05-${level}-${i}`, first: i % 2 ? 'p1' : 'p2', rand: seededRand(i + 7), search: FAST });
        expect(r.state.phase, `${level} ${i} 試合め`).toBe('over');
        expect(r.winner).not.toBeNull();
        // 選んだ操作の種類を数える（同じ試合をもう一度、選ぶ待ちの種類を見ながら進める）
        let s = createGame({ seed: `c05-${level}-${i}`, decks: d, cardDb: CARD_DB, forcedDice: i % 2 ? [6, 1] : [1, 6] }).state;
        for (const a of r.actions) {
          if (a.type === 'CHOOSE' && s.pendingChoice) chooses[s.pendingChoice.kind] += 1;
          const step = applyAction(s, a);
          expect(step.rejected, `${level} ${i} 試合めの再生`).toBeUndefined();
          s = step.state;
        }
      }
    }, 300000);
  }
  it('どのカードも使われ、捨てる・山札から選ぶ・交代先を選ぶ が起きた', () => {
    expect(used.size).toBe(48);
    expect(chooses.discard).toBeGreaterThan(0);
    expect(chooses.search).toBeGreaterThan(0);
    expect(chooses.switch).toBeGreaterThan(0);
  });
});

describe('C02 CPU は相手の手札・山札の順番・この先のサイコロを見ない（さいきょう）', () => {
  const states = midGameStates();
  it('strongest：見えない情報を変えても、同じ手を選ぶ', () => {
    const opts = { maxRollouts: 40, timeMs: 1e9 };
    for (const [i, { state, side }] of states.entries()) {
      const base = decide('strongest', state, side, seededRand(7 + i), opts);
      for (let k = 0; k < 3; k++) {
        const other = decide('strongest', tamper(state, side, k), side, seededRand(7 + i), opts);
        expect(other, `場面 ${i}・書きかえ ${k}`).toEqual(base);
      }
    }
  }, 120000);
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
