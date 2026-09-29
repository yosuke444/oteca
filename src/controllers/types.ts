import type { GameState, Side } from '../engine/types';
import type { Match } from './match';

/**
 * 対戦の各プレイヤーを操作する人（SPEC §13-3「操作する人の差し替え」）
 * - human：この端末の画面から操作する
 * - remote：通信の向こうの相手（操作は通信で届く）
 * - cpu：プログラムが考えて操作する（ストーリーモードの敵もこれを差し込む）
 */
export type ControllerKind = 'human' | 'remote' | 'cpu';

export interface Controller {
  readonly kind: ControllerKind;
  /** この Controller が受け持つ側 */
  readonly side: Side;
  /** 対戦に取り付ける */
  attach(match: Match): void;
  /**
   * 画面の演出が終わって「今の状態」が見えている時に呼ばれる。
   * CPU はここで次の操作を考える（演出の途中で先へ進まないように）。
   */
  onIdle(state: GameState): void;
  /** 対戦から外す（タイマーなどを止める） */
  dispose(): void;
}

/** 画面から操作する人。操作は画面が match.submit で直接送る */
export class HumanController implements Controller {
  readonly kind = 'human' as const;
  constructor(readonly side: Side) {}
  attach(): void {}
  onIdle(): void {}
  dispose(): void {}
}
