import type { Action, GameState, Side } from '../engine/types';
import { type CpuLevel, STRONGEST_SEARCH, decide } from './brains';
import { seededRand } from './random';

/**
 * 画面から CPU に考えさせる窓口（SPEC §13-5）。
 * さいきょうは計算が重いので Web Worker（別の糸）で考える（画面が固まらないように）。
 * Worker が使えない・落ちた・返事が遅すぎる時は、その場で（少なめに）考えて、試合が止まらないようにする。
 */

type Reply = { id: number; action: Action | null };
type Waiting = { resolve: (a: Action | null) => void; fallback: () => Action | null; timer: ReturnType<typeof setTimeout> };

/** Worker の返事をこれ以上は待たない（ms）。ふつうは 1.4秒以内に返る */
const WORKER_TIMEOUT_MS = 4000;

let worker: Worker | null | undefined;
let seq = 0;
const waiting = new Map<number, Waiting>();

/** 待っている考えを全部終わらせる（useFallback：その場で考える／しない＝null） */
function settleAll(useFallback: boolean): void {
  for (const [id, w] of waiting) {
    clearTimeout(w.timer);
    waiting.delete(id);
    w.resolve(useFallback ? w.fallback() : null);
  }
}

function dropWorker(): void {
  worker?.terminate();
  worker = null;
}

function getWorker(): Worker | null {
  if (worker !== undefined) return worker;
  try {
    worker = typeof Worker === 'undefined' ? null : new Worker(new URL('./cpuWorker.ts', import.meta.url), { type: 'module' });
    worker?.addEventListener('message', (e: MessageEvent<Reply>) => {
      const w = waiting.get(e.data.id);
      if (!w) return;
      clearTimeout(w.timer);
      waiting.delete(e.data.id);
      w.resolve(e.data.action);
    });
    worker?.addEventListener('error', () => {
      // 読み込みに失敗した・途中で落ちた：もう使わず、待っている分はその場で考える
      dropWorker();
      settleAll(true);
    });
  } catch {
    worker = null;
  }
  return worker;
}

/** さいきょう（Worker が使える時）は Promise、それ以外はその場で答えを返す */
export function think(level: CpuLevel, state: GameState, side: Side, noSwap = false): Promise<Action | null> | Action | null {
  const seed = Math.floor(Math.random() * 2 ** 32);
  const w = level === 'strongest' ? getWorker() : null;
  if (!w) return decide(level, state, side, seededRand(seed), { ...STRONGEST_SEARCH, noSwap });
  // その場で考える時は少なめ（画面を長く止めないように）
  const fallback = () => decide(level, state, side, seededRand(seed), { maxRollouts: 150, timeMs: 400, noSwap });
  return new Promise((resolve) => {
    const id = ++seq;
    const timer = setTimeout(() => {
      if (!waiting.has(id)) return;
      waiting.delete(id);
      // 返事が来ない：Worker を止めて次に作り直し、今回はその場で考える
      dropWorker();
      worker = undefined;
      resolve(fallback());
    }, WORKER_TIMEOUT_MS);
    waiting.set(id, { resolve, fallback, timer });
    w.postMessage({ id, level, state, side, seed, noSwap });
  });
}

/**
 * 考えている途中のものを止める（対戦画面を出た・もういっかい）。
 * Worker の計算は途中で止められないので、Worker ごと止めて、次に使う時に作り直す（前の計算の後ろに並ばないように）
 */
export function cancelThinking(): void {
  if (waiting.size === 0) return;
  settleAll(false);
  dropWorker();
  worker = undefined;
}
