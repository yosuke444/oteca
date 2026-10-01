import { getLegalActions } from '../engine';
import type { Action, GameState, Side } from '../engine/types';

/**
 * かんたんCPU（SPEC §7 S99）
 * 1. ベンチが空いていれば出す
 * 2. HPが半分以下で、回復アイテムがあれば使う
 * 3. それ以外はそのまま攻撃（ターン終わり）
 * 交代・やいば・ドリンクは使わない。後でストーリーモードの敵AIの土台にする。
 */
export function decideCpuAction(state: GameState, side: Side): Action | null {
  const legal = getLegalActions(state, side);
  if (legal.length === 0) return null;
  const hpOf = (uid: string) => state.cards[uid].hp;
  const maxHpOf = (uid: string) => {
    const d = state.cardDefs[state.cards[uid].no];
    return d.kind === 'otege' ? d.hp : 0;
  };
  const best = <A extends Action>(list: A[], score: (a: A) => number): A => list.reduce((a, b) => (score(b) > score(a) ? b : a));

  // 準備：HPが一番大きいおてあげをバトル場へ
  const setup = legal.filter((a): a is Extract<Action, { type: 'SETUP_ACTIVE' }> => a.type === 'SETUP_ACTIVE');
  if (setup.length > 0) return best(setup, (a) => maxHpOf(a.uid));

  // くりだし：今のHPが一番大きいおてあげ
  const promote = legal.filter((a): a is Extract<Action, { type: 'PROMOTE' }> => a.type === 'PROMOTE');
  if (promote.length > 0) return best(promote, (a) => hpOf(a.benchUid));

  // 1. ベンチが空いていれば出す（HPが大きい順）
  const bench = legal.filter((a): a is Extract<Action, { type: 'PLACE_BENCH' }> => a.type === 'PLACE_BENCH');
  if (bench.length > 0) return best(bench, (a) => maxHpOf(a.uid));

  // 2. HPが半分以下で、回復アイテムがあれば使う（バトル場を先に）
  const ps = state.players[side];
  const heals = legal.filter((a): a is Extract<Action, { type: 'USE_ITEM' }> => {
    if (a.type !== 'USE_ITEM') return false;
    const item = state.cardDefs[state.cards[a.uid].no];
    const c = state.cards[a.targetUid];
    return item.kind === 'item' && item.effects.some((e) => e.type === 'heal') && c.hp * 2 <= c.maxHp;
  });
  if (heals.length > 0) {
    const onActive = heals.filter((a) => a.targetUid === ps.active);
    const pool = onActive.length > 0 ? onActive : heals;
    // 一番HPが減っているおてあげに、一番よく回復するアイテム
    return best(pool, (a) => {
      const c = state.cards[a.targetUid];
      const item = state.cardDefs[state.cards[a.uid].no];
      const amount = item.kind === 'item' ? item.effects.reduce((s, e) => s + (e.type === 'heal' ? e.amount : 0), 0) : 0;
      return (c.maxHp - c.hp) * 1000 + Math.min(amount, c.maxHp - c.hp);
    });
  }

  // 3. そのまま攻撃
  return legal.find((a) => a.type === 'END_TURN') ?? null;
}
