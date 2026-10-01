import type { GameState, Side } from '../engine/types';
import { type CpuLevel, STRONGEST_SEARCH, decide } from './brains';
import { seededRand } from './random';

/** CPU の考えを別の糸（Web Worker）で計算する（SPEC §13-5 さいきょう）。画面は固まらない */
type Request = { id: number; level: CpuLevel; state: GameState; side: Side; seed: number; noSwap: boolean };

const ctx = self as unknown as { onmessage: ((e: MessageEvent<Request>) => void) | null; postMessage: (msg: unknown) => void };

ctx.onmessage = (e) => {
  const { id, level, state, side, seed, noSwap } = e.data;
  let action = null;
  try {
    action = decide(level, state, side, seededRand(seed), { ...STRONGEST_SEARCH, noSwap, now: () => performance.now() });
  } catch {
    action = null;
  }
  ctx.postMessage({ id, action });
};
