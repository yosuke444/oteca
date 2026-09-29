import type { Match } from '../controllers/match';
import { hashState } from '../engine';
import type { Action, Side } from '../engine/types';

/** 通信に渡すもの（OnlineSession がこの形を持つ） */
export type LockstepPort = {
  sendAction(action: Action): void;
  sendHash(turn: number, hash: string): void;
};

/**
 * 決定論ロックステップのつなぎ（SPEC §11-3、§11-6）
 * - この端末の人の操作が通ったら、その操作だけを相手に送る（状態は送らない）
 * - ターンが終わるたびに状態ハッシュを送る。番号は「何回目のターン終わりか」
 *   （きぜつ → くりだし の間はターン番号が進まないので、ターン番号だと別の時点と重なるため）
 */
export function connectLockstep(match: Match, me: Side, port: LockstepPort): () => void {
  let ended = 0;
  return match.subscribe((step) => {
    if (step.action && step.action.player === me) port.sendAction(step.action);
    for (const e of step.events) {
      if (e.type !== 'TurnEnded') continue;
      ended += 1;
      port.sendHash(ended, hashState(step.state));
    }
  });
}
