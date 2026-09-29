import { type GameConfig, applyAction, createGame } from '../engine';
import type { Action, GameEvent, GameState, RejectReason, Side } from '../engine/types';
import type { Controller } from './types';

/** 1つの操作を適用した結果（画面はこれを順に演出する） */
export type MatchStep = {
  /** 何番目の操作か（0 は試合の準備） */
  index: number;
  /** 適用した操作（準備の時は null） */
  action: Action | null;
  events: GameEvent[];
  /** 適用した後の状態 */
  state: GameState;
};

export type MatchListener = (step: MatchStep) => void;

/**
 * 1試合ぶんの進行役。
 * 操作を受け取ってエンジンの applyAction に通し、結果を聞いている人（画面・通信）に知らせる。
 * 状態を書き換えるのはここだけ。
 */
export class Match {
  private _state: GameState;
  private readonly listeners = new Set<MatchListener>();
  private readonly _log: Action[] = [];
  /** 弾かれた操作の記録（SPEC §11-5「不正な操作は無視してログに残す」） */
  readonly rejected: { action: Action; reason: RejectReason }[] = [];
  readonly initial: MatchStep;
  readonly config: GameConfig;
  readonly controllers: Record<Side, Controller>;
  /** 画面の演出が追いついていて、次の操作を考えてよい時 true（CPU が演出の途中で動かないように） */
  idle = false;

  constructor(config: GameConfig, controllers: Record<Side, Controller>) {
    this.config = config;
    const { state, events } = createGame(config);
    this._state = state;
    this.initial = { index: 0, action: null, events, state };
    this.controllers = controllers;
    controllers.p1.attach(this);
    controllers.p2.attach(this);
  }

  get state(): GameState {
    return this._state;
  }

  /** これまでに通った操作（行動ログ） */
  get log(): readonly Action[] {
    return this._log;
  }

  /** 操作を適用する。弾かれたら理由を返す */
  submit(action: Action): RejectReason | null {
    const r = applyAction(this._state, action);
    if (r.rejected) {
      this.rejected.push({ action, reason: r.rejected });
      return r.rejected;
    }
    this._state = r.state;
    this._log.push(action);
    this.idle = false;
    const step: MatchStep = { index: this._log.length, action, events: r.events, state: r.state };
    for (const fn of this.listeners) fn(step);
    return null;
  }

  subscribe(fn: MatchListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** 画面の演出が追いついた時に呼ぶ。Controller に考える番を知らせる */
  notifyIdle(): void {
    this.idle = true;
    this.controllers.p1.onIdle(this._state);
    this.controllers.p2.onIdle(this._state);
  }

  dispose(): void {
    this.listeners.clear();
    this.controllers.p1.dispose();
    this.controllers.p2.dispose();
  }
}
