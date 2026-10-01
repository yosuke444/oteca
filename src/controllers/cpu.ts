import { getLegalActions, validateAction } from '../engine';
import type { Action, GameState, Side } from '../engine/types';
import type { CpuLevel } from '../cpu/brains';
import { decideCpuAction } from '../cpu/normal';
import { cancelThinking, think as defaultThink } from '../cpu/thinker';
import type { Match, MatchStep } from './match';
import type { Controller } from './types';

/** かんたんCPU（デバッグ対戦・CPU対戦「ふつう」）。中身は src/cpu/normal.ts */
export { decideCpuAction } from '../cpu/normal';

/** 考える時間（ふつう速度, ms）。実際に考えた時間がこれより長ければ、待たずにすぐ操作する */
export const CPU_THINK_MS = 350;

/** スタンプの番号（scenes/Battle/Stamps.tsx の STAMPS の順） */
export const CPU_STAMP = { hello: 0, nice: 1, oops: 2, notYet: 3, thanks: 4, giveUp: 5 } as const;
/** CPU がスタンプを送る間隔の下限（ms）。人と同じ3秒より長めにして、送りすぎない */
export const CPU_STAMP_GAP_MS = 6000;
/** 出来事からスタンプを出すまで（ふつう速度, ms） */
export const CPU_STAMP_DELAY_MS = 1200;

export type CpuHooks = {
  /** 強さ（省略時は ふつう＝かんたんCPU） */
  level?: CpuLevel;
  /** 考え始めた・考え終わった（「かんがえちゅう…」の表示） */
  onThinking?: (thinking: boolean) => void;
  /** スタンプを送る（CPU対戦。SPEC §7 S10） */
  onStamp?: (id: number) => void;
  /** 考え方（テストで差し替える）。さいきょうは Web Worker で計算するので Promise を返す */
  think?: (level: CpuLevel, state: GameState, side: Side, noSwap: boolean) => Promise<Action | null> | Action | null;
  /** スタンプの確率に使う乱数 */
  random?: () => number;
  /** 時計 */
  now?: () => number;
  /** スタンプを少し遅らせて出す（テストではすぐ呼ぶものを渡す）。演出スピードで割る */
  later?: (fn: () => void, ms: number) => void;
};

/**
 * CPU を Controller として差し込む（SPEC §13-3・§13-5）
 * 画面の演出が終わったら（onIdle）、自分が操作できる時に考えて操作する。
 */
export class CpuController implements Controller {
  readonly kind = 'cpu' as const;
  private match: Match | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private thinking = false;
  private unsubscribe: (() => void) | null = null;
  private lastStamp = -Infinity;
  private stampTimer: ReturnType<typeof setTimeout> | null = null;
  /** 最後に交代した自分ターン数（2ターン続けて交代しない） */
  private lastSwapTurn = -9;
  readonly level: CpuLevel;

  /**
   * @param schedule 考える時間のあとに fn を呼ぶ（テストではすぐ呼ぶものを渡す）
   */
  constructor(
    readonly side: Side,
    private readonly schedule: (fn: () => void, ms?: number) => ReturnType<typeof setTimeout> | null = (fn, ms = CPU_THINK_MS) => setTimeout(fn, ms),
    private readonly hooks: CpuHooks = {},
  ) {
    this.level = hooks.level ?? 'normal';
  }

  attach(match: Match): void {
    this.match = match;
    if (this.hooks.onStamp) this.unsubscribe = match.subscribe((step) => this.react(step));
  }

  onIdle(state: GameState): void {
    if (this.thinking || !this.match) return;
    if (getLegalActions(state, this.side).length === 0) return;
    this.thinking = true;
    this.hooks.onThinking?.(true);
    const now = this.hooks.now ?? (() => Date.now());
    const started = now();
    const done = (action: Action | null) => {
      if (!this.match) return; // 対戦から外された
      // 考えた時間が短い時は、ふつうの考える時間まで待ってから操作する
      const waitMs = Math.max(0, CPU_THINK_MS - (now() - started));
      this.timer = this.schedule(() => {
        this.timer = null;
        this.thinking = false;
        this.hooks.onThinking?.(false);
        const m = this.match;
        if (!m) return;
        // 考えている間に状態が変わった・まだ演出中：今の状態で考え直す（演出が終われば onIdle が呼ばれる）
        if (m.state !== state || !m.idle) {
          if (m.idle) this.onIdle(m.state);
          return;
        }
        // 答えが出なかった・使えない手だった：かんたんCPU の手で進める（考え直しをくり返して止まらないように）
        if (!action || validateAction(m.state, action) !== null) action = decideCpuAction(m.state, this.side);
        if (!action) return;
        if (action.type === 'SWAP') this.lastSwapTurn = m.state.players[this.side].turnCount;
        m.submit(action);
      }, waitMs);
    };
    const noSwap = this.lastSwapTurn === state.players[this.side].turnCount - 1;
    const r = (this.hooks.think ?? defaultThink)(this.level, state, this.side, noSwap);
    if (r instanceof Promise) r.then(done, () => done(null));
    else done(r);
  }

  /** 出来事を見て、ときどきスタンプを送る（最初のターン・大ダメージを受けた・倒した・倒された） */
  private react(step: MatchStep): void {
    const random = this.hooks.random ?? Math.random;
    const me = this.side;
    let pick: { id: number; p: number } | null = null;
    for (const e of step.events) {
      if (e.type === 'TurnStarted' && step.state.turnNumber === 1) pick = { id: CPU_STAMP.hello, p: 0.7 };
      if (e.type === 'Damaged' && e.big && step.state.cards[e.uid]?.owner === me) pick = { id: CPU_STAMP.oops, p: 0.6 };
      if (e.type === 'Fainted') pick = e.by === me ? { id: CPU_STAMP.nice, p: 0.6 } : { id: CPU_STAMP.notYet, p: 0.5 };
      // 決着した時はすぐリザルトへ移るので、スタンプは出さない
      if (e.type === 'GameOver') pick = null;
    }
    if (!pick || random() >= pick.p) return;
    const now = (this.hooks.now ?? (() => Date.now()))();
    if (now - this.lastStamp < CPU_STAMP_GAP_MS) return;
    this.lastStamp = now;
    const id = pick.id;
    // 演出が少し進んでから出す
    const send = () => {
      if (this.match) this.hooks.onStamp?.(id);
    };
    if (this.hooks.later) {
      this.hooks.later(send, CPU_STAMP_DELAY_MS);
      return;
    }
    if (this.stampTimer !== null) clearTimeout(this.stampTimer);
    this.stampTimer = setTimeout(() => {
      this.stampTimer = null;
      send();
    }, CPU_STAMP_DELAY_MS);
  }

  dispose(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    if (this.stampTimer !== null) clearTimeout(this.stampTimer);
    this.timer = null;
    this.stampTimer = null;
    this.unsubscribe?.();
    this.unsubscribe = null;
    if (this.thinking) {
      this.hooks.onThinking?.(false);
      if (this.level === 'strongest') cancelThinking();
    }
    this.thinking = false;
    this.match = null;
  }
}
