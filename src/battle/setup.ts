import type { Side } from '../engine/types';

/**
 * 対戦画面に渡す設定。
 * - local：ひとりで両方あやつる（1台で2人ぶん）
 * - cpu：かんたんCPU と対戦
 * - online：フレンド対戦（通信）
 */
export type BattleMode = 'local' | 'cpu' | 'online';

export type BattleSetup = {
  mode: BattleMode;
  decks: Record<Side, number[]>;
  names: Record<Side, string>;
  /** 乱数の種（オンラインではコミット・リビールで決めた値） */
  seed: string;
  /** 画面の下側にいる人（online ではこの端末の役割） */
  me: Side;
  /** 勝敗をセーブデータに記録するか（フレンド対戦だけ） */
  record: boolean;
  /** デバッグ：サイコロの目を固定（毎回この目。null なら乱数） */
  fixedDie?: number | null;
  /** デバッグ：配ったあと山札の上に置くカード（カードNo、上から順） */
  stackTop?: Partial<Record<Side, number[]>>;
};

/** 乱数の種を作る（ローカル対戦用。オンラインはコミット・リビールで作る） */
export function randomSeed(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}
