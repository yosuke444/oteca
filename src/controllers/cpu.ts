import { getLegalActions } from '../engine';
import type { Action, GameState, Side } from '../engine/types';
import type { Match } from './match';
import type { Controller } from './types';

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

/** 考える時間（ふつう速度, ms） */
export const CPU_THINK_MS = 350;

/**
 * CPU を Controller として差し込む（SPEC §13-3）
 * 画面の演出が終わったら（onIdle）、自分の番なら少し考えてから操作する。
 */
export class CpuController implements Controller {
  readonly kind = 'cpu' as const;
  private match: Match | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;

  /**
   * @param schedule 考える時間のあとに fn を呼ぶ（テストではすぐ呼ぶものを渡す）
   */
  constructor(
    readonly side: Side,
    private readonly schedule: (fn: () => void) => ReturnType<typeof setTimeout> | null = (fn) => setTimeout(fn, CPU_THINK_MS),
  ) {}

  attach(match: Match): void {
    this.match = match;
  }

  onIdle(state: GameState): void {
    if (this.timer !== null || !this.match) return;
    if (!decideCpuAction(state, this.side)) return;
    this.timer = this.schedule(() => {
      this.timer = null;
      const match = this.match;
      // 考えている間に別の操作が入って、まだ演出中なら送らない（次の onIdle でもう一度考える）
      if (!match || !match.idle) return;
      // 考えている間に状態が変わっているかもしれないので、今の状態で決め直す
      const action = decideCpuAction(match.state, this.side);
      if (action) match.submit(action);
    });
  }

  dispose(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.match = null;
  }
}
