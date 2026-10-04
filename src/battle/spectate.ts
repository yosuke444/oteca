import type { Side } from '../engine/types';
import type { BattleMode } from './setup';

/**
 * 観戦（v2.0-J。SPEC §11-10）の見せ方の決まり。画面にも通信にも関係しない、ふつうの処理だけ。
 */

/** その人の手札を裏向きで出すか（相手の手札は いつも裏。観戦では両者とも裏で、枚数だけ） */
export function isHandHidden(mode: BattleMode, side: Side, me: Side): boolean {
  return mode === 'spectate' || side !== me;
}

/** 観戦の時の下側（先攻 p1） */
export const SPECTATE_BOTTOM: Side = 'p1';
