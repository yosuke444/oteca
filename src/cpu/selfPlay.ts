import { applyAction, createGame } from '../engine';
import type { CardDb, GameState, Side } from '../engine/types';
import { type CpuLevel, type SearchOptions, decide } from './brains';
import { type Rand } from './random';

/**
 * CPU 同士の対戦（テスト・強さの順番の確認用。SPEC §16 C01・C04）。画面も通信も使わない。
 */
export type SelfPlayResult = { winner: Side | null; steps: number; state: GameState };

export function selfPlay(opts: {
  levels: Record<Side, CpuLevel>;
  decks: Record<Side, number[]>;
  cardDb: CardDb;
  seed: string;
  /** 先攻（先攻決めのサイコロをこの人が勝つように決める） */
  first: Side;
  rand: Rand;
  search?: SearchOptions;
  maxSteps?: number;
}): SelfPlayResult {
  let { state } = createGame({
    seed: opts.seed,
    decks: opts.decks,
    cardDb: opts.cardDb,
    forcedDice: opts.first === 'p1' ? [6, 1] : [1, 6],
  });
  const max = opts.maxSteps ?? 2000;
  let steps = 0;
  /** 最後に交代した自分ターン数（2ターン続けて交代しないため） */
  const lastSwap: Record<Side, number> = { p1: -9, p2: -9 };
  for (; steps < max && state.phase !== 'over'; steps++) {
    const who: Side | undefined =
      state.phase === 'setup'
        ? (['p1', 'p2'] as Side[]).find((p) => state.players[p].setupChoice === null)
        : state.phase === 'promote'
          ? state.pendingPromote[0]
          : state.currentPlayer;
    if (!who) throw new Error(`だれも操作できない（${state.phase}）`);
    const noSwap = lastSwap[who] === state.players[who].turnCount - 1;
    const action = decide(opts.levels[who], state, who, opts.rand, { ...opts.search, noSwap });
    if (action?.type === 'SWAP') lastSwap[who] = state.players[who].turnCount;
    if (!action) throw new Error(`${who}（${opts.levels[who]}）が手を選べない`);
    const r = applyAction(state, action);
    if (r.rejected) throw new Error(`${who}（${opts.levels[who]}）の手が弾かれた：${JSON.stringify(action)} ${r.rejected}`);
    state = r.state;
  }
  return { winner: state.winner, steps, state };
}
