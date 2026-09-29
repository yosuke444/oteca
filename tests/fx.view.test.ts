import { describe, expect, it } from 'vitest';
import { CARD_DB } from '../src/data/cards';
import { starterDeckNos } from '../src/data/starterDeck';
import { type GameState, applyAction, createGame, getLegalActions, seedRng } from '../src/engine';
import { nextInt } from '../src/engine/rng';
import { applyEventToView } from '../src/fx/viewReducer';

/** 画面に見える部分だけ取り出す */
function visible(s: GameState) {
  const sides = (['p1', 'p2'] as const).map((p) => {
    const ps = s.players[p];
    return { deck: ps.deck.length, hand: [...ps.hand].sort(), active: ps.active, bench: ps.bench, discard: ps.discard, ko: ps.koCount, turn: ps.turnCount };
  });
  const hp = Object.values(s.cards).map((c) => [c.uid, c.hp, c.attackAdd, c.attackOverride]);
  return { sides, hp, current: s.currentPlayer, winner: s.winner };
}

describe('表示用の状態（viewReducer）', () => {
  it('イベントを1つずつ進めた表示は、操作のあとのエンジンの状態と一致する（ランダム30試合）', () => {
    for (let g = 0; g < 30; g++) {
      let { state } = createGame({ seed: `view-${g}`, decks: { p1: starterDeckNos(), p2: starterDeckNos() }, cardDb: CARD_DB });
      const pick = seedRng(`vpick-${g}`);
      for (let step = 0; step < 400 && state.phase !== 'over'; step++) {
        const legal = [...getLegalActions(state, 'p1'), ...getLegalActions(state, 'p2')];
        const r = applyAction(state, legal[nextInt(pick, legal.length)]);
        let view = state;
        for (const e of r.events) view = applyEventToView(view, e);
        // 準備中は裏向きの選択（setupChoice）が見えないので、表に返った後だけ比べる
        if (r.state.phase !== 'setup') expect(visible(view)).toEqual(visible(r.state));
        state = r.state;
      }
    }
  });
});
