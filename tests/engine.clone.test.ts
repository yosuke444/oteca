import { describe, expect, it } from 'vitest';
import { CARD_DB } from '../src/data/cards';
import { starterDeckNos } from '../src/data/starterDeck';
import { applyAction, createGame, getLegalActions, seedRng, stableStringify } from '../src/engine';
import { nextInt } from '../src/engine/rng';

/**
 * applyAction は渡した状態を書き換えない（純粋。状態のコピー cloneState が、書き換える入れ物をすべてコピーしているか）。
 * カードの定義・ルールは前後の状態で共有しているが、書き換えられていないことも確かめる。
 */
describe('状態のコピー（cloneState）', () => {
  it('ランダムな30試合で、操作のたびに元の状態が変わっていない', () => {
    for (let g = 0; g < 30; g++) {
      let { state } = createGame({ seed: `clone-${g}`, decks: { p1: starterDeckNos(), p2: starterDeckNos() }, cardDb: CARD_DB });
      const defs = stableStringify(state.cardDefs);
      const pick = seedRng(`clone-pick-${g}`);
      for (let step = 0; step < 400 && state.phase !== 'over'; step++) {
        const legal = [...getLegalActions(state, 'p1'), ...getLegalActions(state, 'p2')];
        const before = stableStringify(state);
        const r = applyAction(state, legal[nextInt(pick, legal.length)]);
        expect(stableStringify(state)).toBe(before);
        expect(stableStringify(r.state.cardDefs)).toBe(defs);
        state = r.state;
      }
    }
  });
});
