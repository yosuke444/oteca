import { getLegalActions } from '../engine';
import type { Action, GameState, Side } from '../engine/types';
import { otegeValue, threat } from './estimate';

/**
 * 「カードを選ぶ」（捨てる・山札から選ぶ・交代先。SPEC §4-5 ⑤・§13-5。v2.0）の、CPU の選び方。
 * どれも効果データから見積もった「カードの価値」で選ぶ（カード名では判定しない）。
 */

/** 手札・山札のカード1枚の価値（高いほど手元に残したい） */
export function cardValue(s: GameState, side: Side, uid: string): number {
  const def = s.cardDefs[s.cards[uid].no];
  const ps = s.players[side];
  if (def.kind === 'otege') {
    // 場に出せるおてあげが少ないほど、おてあげの価値は上がる
    const otegeInHand = ps.hand.filter((u) => s.cardDefs[s.cards[u].no].kind === 'otege').length;
    const fieldSpace = s.rules[side].benchMax - ps.bench.length + (ps.active ? 0 : 1);
    const need = otegeInHand <= fieldSpace ? 60 : 0;
    return otegeValue(s, uid) * 0.5 + need;
  }
  // アイテム：回復量・加算・引く枚数をざっくり点に
  let v = 20;
  for (const e of def.effects) {
    if (e.type === 'heal') v += e.amount * 0.6;
    else if (e.type === 'addAttack') v += e.amount;
    else if (e.type === 'search') v += 35;
    else if (e.type === 'draw') v += 10 * e.count;
    else if (e.type === 'discard') v -= 8 * e.count;
  }
  return v;
}

/** 選ぶ待ちの時に、価値で選ぶ（どの強さでも使える「ふつう」の選び方） */
export function chooseAction(s: GameState, side: Side): Extract<Action, { type: 'CHOOSE' }> | null {
  const pc = s.pendingChoice;
  if (s.phase !== 'choose' || !pc || pc.player !== side) return null;
  const k = Math.min(pc.count, pc.options.length);
  const score = (uid: string): number => {
    if (pc.kind === 'switch') {
      // 交代先：倒されにくく、価値の高いおてあげ
      return (1 - threat(s, side, uid, 10)) * 100 + otegeValue(s, uid) * 0.1;
    }
    return cardValue(s, side, uid);
  };
  const ranked = [...pc.options].sort((a, b) => score(b) - score(a) || (a < b ? -1 : 1));
  // 捨てる時は価値の低いものから、選ぶ（山札から取る・交代先）時は高いものから
  const uids = pc.kind === 'discard' ? ranked.slice(-k) : ranked.slice(0, k);
  const action: Extract<Action, { type: 'CHOOSE' }> = { type: 'CHOOSE', player: side, uids };
  // 念のため、エンジンの合法手にある並びにそろえる（options の順）
  const legal = getLegalActions(s, side).find(
    (a) => a.type === 'CHOOSE' && a.uids.length === uids.length && a.uids.every((u) => uids.includes(u)),
  );
  return (legal as Extract<Action, { type: 'CHOOSE' }> | undefined) ?? action;
}
