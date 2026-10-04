import { CARD_DB } from '../data/cards';
import type { SandboxSide } from '../engine/setup';
import { validateDeck } from '../engine';
import type { RuleSet, Side } from '../engine/types';
import type { CpuLevel } from '../cpu/brains';
import { safeName } from '../online/rate';
import { t } from '../i18n';

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
  /** デバッグ「カードを ためす」：カードを置いた所から始める（SPEC §7 S99・v2.0） */
  sandbox?: Record<Side, SandboxSide>;
  /** デバッグ「カードを ためす」：この順にサイコロの目を出す（そのあとは乱数） */
  forcedDice?: number[];
  /** チュートリアル：山札を切らずに、decks に書いた順で配る（UPDATE_v2 §6T-5） */
  noShuffle?: boolean;
  /** チュートリアルの対戦（記録しない。リザルトへは進まない） */
  tutorial?: boolean;
  /** プレイヤー別のルール（ストーリーのボスルール。SPEC §7 S08） */
  rules?: Partial<Record<Side, Partial<RuleSet>>>;
  /** ストーリーの対戦（ステージ番号。報酬はリザルトで） */
  story?: { stage: number };
  /**
   * レート対戦（v2.0-G）：相手のレートとプレイヤーID（結果はリザルトでレートに書く）。
   * matchId：結果の報告に使う試合ID（v2.0-I。受付係の試合ID、予備の待合所では部屋ID）
   */
  rated?: { oppRate: number; oppId: string; matchId?: string };
};

/** 乱数の種を作る（ローカル対戦用。オンラインはコミット・リビールで作る） */
export function randomSeed(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** フレンド対戦の試合開始（コミット・リビールで種が決まった）→ 対戦画面の設定 */
export function onlineSetup(
  g: { game: number; seed: string; me: Side; decks: Record<Side, number[]>; names: Record<Side, string> },
  debug = false,
  rated?: BattleSetup['rated'],
): BattleSetup {
  const opp: Side = g.me === 'p1' ? 'p2' : 'p1';
  // 相手の名前に禁止語があれば「ななし」（v2.0-G。対戦画面・ログ・リザルトで）
  const names = { ...g.names, [opp]: safeName(g.names[opp], t().lobby.nameless) } as Record<Side, string>;
  return { mode: 'online', decks: g.decks, names, seed: g.seed, me: g.me, record: true, game: g.game, debug, showHash: debug, ...(rated ? { rated } : {}) };
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
