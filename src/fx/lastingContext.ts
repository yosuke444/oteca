import type { GameEvent, Lasting } from '../engine/types';

/** 持続効果（LastingFired）の結果として続くイベント */
const FOLLOW = new Set<GameEvent['type']>(['Damaged', 'Healed', 'Drew', 'Fainted', 'NeedPromote', 'Promoted', 'GameOver']);

/**
 * events[i] が持続効果の発動の結果なら、その持続効果（v2.5）。
 * 持続効果のダメージ・回復は、攻撃の動き（相手の突進）ではなく、持続効果の動きで見せるために使う。
 */
export function lastingInEffect(events: GameEvent[], i: number): Lasting | null {
  for (let j = i; j >= 0; j--) {
    const e = events[j];
    if (e.type === 'LastingFired') return e.lasting;
    if (!FOLLOW.has(e.type)) return null;
  }
  return null;
}
