import type { GameEvent, GameState, Side } from '../engine/types';
import type { Particles } from './particles';

/** 演出から使える道具（画面が用意して fxQueue に渡す） */
export type FxEnv = {
  /** 演出を重ねる層（舞台 1280×720 の座標） */
  overlay: HTMLElement;
  /** 対戦画面の一番外の要素（画面揺れに使う） */
  root: HTMLElement;
  /** 画面の下側にいるプレイヤー */
  me(): Side;
  /** 演出スピードの倍率（1 / 1.6 / 2.5） */
  speed(): number;
  /** 演出をへらす */
  reduce(): boolean;
  /** 表示中の状態 */
  view(): GameState;
  /** 表示中の状態を書き換える（画面にすぐ反映される） */
  setView(fn: (v: GameState) => GameState): void;
  /** カードの要素 */
  cardEl(uid: string): HTMLElement | null;
  /** 場所の要素（例 'p1-deck'・'p2-active'・'p1-bench-0'・'dice'・'p1-hand'・'p1-stars'） */
  zoneEl(key: string): HTMLElement | null;
  /** 技表の蛍光ペン（null で消す） */
  markMove(uid: string | null, moveIndex: number | null): void;
  /** 効果音（キーは audio/soundMap.ts） */
  sound(key: string): void;
  /** 粒子（「演出をへらす」の時も入っているが、出すかどうかは parts 側で判断する） */
  particles: Particles | null;
  /** スローモーション（1 でふつう。決着の最後の一撃で 0.4） */
  slowMo(factor: number): void;
  /** BGM を一瞬下げる（大ダメージ・きぜつの瞬間。SPEC §10-3） */
  duckBgm(): void;
  /** ログに1行足す */
  log(event: GameEvent, view: GameState): void;
};

/** 1つのイベントの演出。before は表示を進める前、after は進めた後 */
export type FxPreset<E extends GameEvent = GameEvent> = {
  before?: (env: FxEnv, e: E, ctx: StepContext) => Promise<void>;
  after?: (env: FxEnv, e: E, ctx: StepContext) => Promise<void>;
};

/** 同じ操作の中のイベントどうしで共有する情報 */
export type StepContext = {
  /** この操作をした人（準備の時は null） */
  actor: Side | null;
  /** この操作のイベント全部 */
  events: GameEvent[];
  /** 今のイベントの位置 */
  index: number;
  /** 直前に技を使ったおてあげ */
  attackerUid: string | null;
  /** 最後の一撃（この操作で決着する） */
  finalBlow: boolean;
};
