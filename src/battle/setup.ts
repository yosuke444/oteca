import { CARD_DB } from '../data/cards';
import { validateDeck } from '../engine';
import type { Side } from '../engine/types';
import type { CpuLevel } from '../cpu/brains';

/**
 * 対戦画面に渡す設定。
 * - local：ひとりで両方あやつる（1台で2人ぶん）
 * - cpu：CPU と対戦（CPU対戦 S10。デバッグの「かんたんCPU」は強さ ふつう）
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
  /** 勝敗をセーブデータに記録するか（フレンド対戦は stats、CPU対戦は cpuStats） */
  record: boolean;
  /** CPU の強さ（mode が cpu の時。省略時は ふつう） */
  cpuLevel?: CpuLevel;
  /** デバッグ：サイコロの目を固定（毎回この目。null なら乱数） */
  fixedDie?: number | null;
  /** デバッグ：配ったあと山札の上に置くカード（カードNo、上から順） */
  stackTop?: Partial<Record<Side, number[]>>;
  /** フレンド対戦：何試合目か（再戦で +1） */
  game?: number;
  /** デバッグ対戦（行動ログの保存ボタンを出す） */
  debug?: boolean;
  /** デバッグ：状態ハッシュを表示する */
  showHash?: boolean;
};

/** 乱数の種を作る（ローカル対戦用。オンラインはコミット・リビールで作る） */
export function randomSeed(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** フレンド対戦の試合開始（コミット・リビールで種が決まった）→ 対戦画面の設定 */
export function onlineSetup(g: { game: number; seed: string; me: Side; decks: Record<Side, number[]>; names: Record<Side, string> }, debug = false): BattleSetup {
  return { mode: 'online', decks: g.decks, names: g.names, seed: g.seed, me: g.me, record: true, game: g.game, debug, showHash: debug };
}

/**
 * 相手から届いたデッキが正しいか（壊れたデータで対戦画面が落ちないように）。
 * おかしければ true。
 */
export function badOnlineStart(g: { decks: Record<Side, number[]> }): boolean {
  return (['p1', 'p2'] as const).some((s) => {
    const d = g.decks[s];
    return !Array.isArray(d) || !d.every((no) => Number.isInteger(no)) || validateDeck(d, CARD_DB).length > 0;
  });
}
