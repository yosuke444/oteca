import type { Action, Side } from '../engine/types';
import type { Match } from './match';
import type { Controller } from './types';

/**
 * 通信の向こうの相手（SPEC §13-3 remote）
 * 通信で届いた操作を feed で受け取り、この端末のエンジンにも同じ順番で通す（ロックステップ、§11-3）。
 * 通信そのものには依存しない（届け役は画面が差し込む）。
 */
export class RemoteController implements Controller {
  readonly kind = 'remote' as const;
  private match: Match | null = null;
  /** 取り付ける前に届いた操作 */
  private readonly early: Action[] = [];

  constructor(readonly side: Side) {}

  attach(match: Match): void {
    this.match = match;
    for (const a of this.early.splice(0)) this.feed(a);
  }

  /** 相手の操作を通す。相手の側の操作でなければ（不正）弾いてログに残す */
  feed(action: Action): void {
    const match = this.match;
    if (!match) {
      this.early.push(action);
      return;
    }
    if (action.player !== this.side) {
      match.rejected.push({ action, reason: 'notYourTurn' });
      return;
    }
    match.submit(action);
  }

  onIdle(): void {}

  dispose(): void {
    this.match = null;
  }
}
