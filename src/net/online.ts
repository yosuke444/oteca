import { appVersion, protocolVersion } from '../config/version';
import type { Action } from '../engine/types';
import { FlakyTransport } from './flakyTransport';
import { LocalTransport } from './localTransport';
import { type Connection, type GameStart, OnlineSession, type SessionStatus } from './session';
import type { NetTransport } from './transport';
import { TrysteroTransport } from './trysteroTransport';

/**
 * フレンド対戦の「いまの通信」をひとつだけ持っておく所。
 * ロビー → 対戦 → リザルト → 再戦 と画面が変わっても、同じセッション（同じ相手とのつながり）を使い続ける。
 * 画面ごとに on(...) で知らせを聞き、画面を出る時に外す。
 */

type Events = {
  status: SessionStatus;
  matched: string;
  start: GameStart;
  connection: Connection;
  stamp: number;
  oppRematch: void;
  desync: number;
  waitingTick: number;
};

type Listener<T> = (v: T) => void;

export class OnlineLink {
  readonly session: OnlineSession;
  readonly transport: NetTransport;
  readonly flaky: FlakyTransport | null;
  /** 最後に始まった試合（再戦のたびに新しくなる） */
  lastStart: GameStart | null = null;
  /** 相手が「もういっかい」を押している */
  oppRematch = false;
  /** 自分が「もういっかい」を押した */
  myRematch = false;
  /** 届いた相手の操作（試合ごと、全部）。対戦画面が作り直されても最初から通し直せるように */
  private readonly history = new Map<number, Action[]>();
  private sink: { game: number; fn: (a: Action) => void } | null = null;
  private readonly listeners = new Map<keyof Events, Set<Listener<never>>>();

  constructor(
    readonly roomNumber: string,
    readonly myName: string,
    deck: number[],
    transport: NetTransport,
  ) {
    this.flaky = new URLSearchParams(window.location.search).get('debug') === '1' ? new FlakyTransport(transport) : null;
    this.transport = this.flaky ?? transport;
    const s = new OnlineSession(this.transport, { name: myName, deck, protocol: protocolVersion, appVersion, playerId: playerId() });
    this.session = s;
    s.onStatus = (v) => this.emit('status', v);
    s.onMatched = (v) => this.emit('matched', v);
    s.onStart = (g) => {
      this.lastStart = g;
      this.oppRematch = false;
      this.myRematch = false;
      this.emit('start', g);
    };
    s.onConnection = (c) => this.emit('connection', c);
    s.onStamp = (id) => this.emit('stamp', id);
    s.onOpponentRematch = () => {
      this.oppRematch = true;
      this.emit('oppRematch', undefined);
    };
    s.onDesync = (turn) => this.emit('desync', turn);
    s.onWaitingTick = (ms) => this.emit('waitingTick', ms);
    s.onRemoteAction = (a) => {
      const game = this.lastStart?.game ?? 0;
      const list = this.history.get(game) ?? [];
      list.push(a);
      this.history.set(game, list);
      if (this.sink && this.sink.game === game) this.sink.fn(a);
    };
  }

  on<K extends keyof Events>(type: K, fn: Listener<Events[K]>): () => void {
    const set = this.listeners.get(type) ?? new Set();
    this.listeners.set(type, set);
    set.add(fn as Listener<never>);
    return () => set.delete(fn as Listener<never>);
  }

  private emit<K extends keyof Events>(type: K, v: Events[K]): void {
    for (const fn of [...(this.listeners.get(type) ?? [])]) (fn as Listener<Events[K]>)(v);
  }

  /** 対戦画面が相手の操作を受け取り始める（その試合でそれまでに届いた分も、最初から全部渡す） */
  receiveActions(game: number, fn: (a: Action) => void): () => void {
    this.sink = { game, fn };
    for (const a of this.history.get(game) ?? []) fn(a);
    return () => {
      if (this.sink?.fn === fn) this.sink = null;
    };
  }

  requestRematch(): void {
    this.myRematch = true;
    this.session.requestRematch();
  }
}

let current: OnlineLink | null = null;

/** 部屋に入る（前の通信があれば閉じてから） */
export function startOnline(roomNumber: string, name: string, deck: number[]): OnlineLink {
  endOnline();
  const link = new OnlineLink(roomNumber, name, deck, createTransport());
  current = link;
  if (link.flaky) {
    // 開発用：Playwright などから通信をわざと切れるように
    (window as unknown as { __otecaNet?: unknown }).__otecaNet = {
      setOffline: (v: boolean) => link.flaky?.setOffline(v),
      selfId: link.transport.selfId,
    };
  }
  link.session.join(roomNumber);
  return link;
}

export function currentOnline(): OnlineLink | null {
  return current;
}

/** 部屋を出る（相手に leave を送って閉じる） */
export function endOnline(): void {
  if (!current) return;
  current.session.leave();
  current = null;
}

/**
 * 通信の方式。ふだんは Trystero。
 * URL に ?net=local を付けると、同じブラウザのタブどうしだけでつながる開発用の通信を使う。
 */
function createTransport(): NetTransport {
  if (new URLSearchParams(window.location.search).get('net') === 'local') return new LocalTransport();
  return new TrysteroTransport();
}

/**
 * このページの人を表す ID（通信が切れて戻った時に、同じ人だと分かるように）。
 * ページを読み込むたびに変わる（再読み込みからの復帰は P2 で今回は作らない。SPEC §11-7）。
 */
const PLAYER_ID = (() => {
  const b = new Uint8Array(8);
  crypto.getRandomValues(b);
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
})();

function playerId(): string {
  return PLAYER_ID;
}
