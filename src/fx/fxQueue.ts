import type { GameEvent, GameState, Side } from '../engine/types';
import type { FxEnv, StepContext } from './env';
import { PRESETS } from './presets';
import { wait } from './timing';
import { applyEventToView } from './viewReducer';

/** 演出する1かたまり（1つの操作ぶん） */
export type FxStep = {
  /** この操作をした人（準備の時は null） */
  actor: Side | null;
  /** この端末の人ではない（相手・CPU の）操作。前の演出から間を空けて再生する */
  gap: boolean;
  events: GameEvent[];
  /** 操作を適用した後の、エンジンの正式な状態 */
  state: GameState;
};

/** 相手の操作は1つずつ、この間を空けて再生する（SPEC §8-3） */
export const OPPONENT_GAP_MS = 600;

/**
 * イベント → 演出タイムライン（SPEC §9、§14-1 fxQueue）
 * 操作ごとのイベントを順番に演出し、終わったら表示をエンジンの状態にそろえる。
 * 演出の途中でゲームの状態は書き換えない（表示用の状態だけを進める）。
 */
export class FxQueue {
  private readonly steps: FxStep[] = [];
  private running = false;
  private disposed = false;
  private lastEnd = -Infinity;
  /** 全部の演出が終わって、待っている操作が無くなった時 */
  onIdle: () => void = () => {};
  /** 演出中かどうかが変わった時 */
  onBusyChange: (busy: boolean) => void = () => {};

  constructor(private readonly env: FxEnv) {}

  enqueue(step: FxStep): void {
    this.steps.push(step);
    if (!this.running) void this.run();
  }

  get busy(): boolean {
    return this.running;
  }

  dispose(): void {
    this.disposed = true;
    this.steps.length = 0;
  }

  private async run(): Promise<void> {
    this.running = true;
    this.onBusyChange(true);
    while (this.steps.length > 0 && !this.disposed) {
      const step = this.steps.shift()!;
      // 相手（画面の下側ではない人）の操作は、前の演出から間を空けてから再生する
      if (step.gap) {
        const since = performance.now() - this.lastEnd;
        const gap = OPPONENT_GAP_MS / this.env.speed();
        if (since < gap) await wait((gap - since) * this.env.speed());
      }
      await this.playStep(step);
      // スローモーションは1つの操作の中だけ
      this.env.slowMo(1);
      if (this.disposed) return;
      // 表示をエンジンの正式な状態にそろえる
      this.env.setView(() => step.state);
      this.lastEnd = performance.now();
    }
    this.running = false;
    if (this.disposed) return;
    this.onBusyChange(false);
    this.onIdle();
  }

  private async playStep(step: FxStep): Promise<void> {
    const over = step.events.some((e) => e.type === 'GameOver');
    const ctx: StepContext = { actor: step.actor, events: step.events, index: 0, attackerUid: null, finalBlow: over, flags: {} };
    for (let i = 0; i < step.events.length; i++) {
      if (this.disposed) return;
      const e = step.events[i];
      ctx.index = i;
      if (e.type === 'MoveSelected') ctx.attackerUid = e.uid;
      const preset = PRESETS[e.type] as { before?: Function; after?: Function } | undefined;
      // 演出で失敗しても、表示は進めて試合は止めない
      try {
        if (preset?.before) await preset.before(this.env, e, ctx);
      } catch (err) {
        console.error('[fx]', e.type, err);
      }
      const before = this.env.view();
      this.env.setView((v) => applyEventToView(v, e));
      this.env.log(e, before);
      try {
        if (preset?.after) await preset.after(this.env, e, ctx);
      } catch (err) {
        console.error('[fx]', e.type, err);
      }
    }
  }
}
