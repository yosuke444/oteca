import { appVersion, protocolVersion } from '../config/version';
import type { Action } from '../engine/types';
import { FlakyTransport } from './flakyTransport';
import { LocalTransport, devRelayBus } from './localTransport';
import { type Connection, type GameStart, type InviteState, OnlineSession, type RoomMember, type SessionStatus } from './session';
import { rateRoomName, roomName } from './protocol';
import { RateLobby } from './rateLobby';
import { RateSearch, type SocketLike } from './matchmaker';
import { SpectatorSession } from './spectator';
import { lobbyUrl } from '../config/api';
import { TradeSession, type TradeOptions } from './tradeSession';
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
  result: boolean;
  /** 部屋の人（v2.0-G） */
  members: RoomMember[];
  /** 人が来た・出ていった */
  joinLeave: { kind: 'join' | 'leave'; name: string };
  invite: InviteState;
  /** 相手が「ほかの ひとと あそぶ」で部屋に戻った */
  oppBack: void;
  /** 今の試合を観戦している人の数（v2.0-J） */
  spectators: number;
};

/** どこに入るか：フレンド部屋（部屋番号）か、レート対戦の2人だけの部屋（v2.0-G） */
export type OnlinePlace = { kind: 'friend'; roomNumber: string } | { kind: 'rate'; roomId: string };

/** 入る人の情報 */
export type OnlineMe = { name: string; deck: number[]; deckName: string; rate?: number; playerId?: string; userId?: string };

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
  /** 決着の結果が2人でそろったか（null はまだ分からない） */
  resultAgree: boolean | null = null;
  /** 届いた相手の操作（試合ごと、全部）。対戦画面が作り直されても最初から通し直せるように */
  private readonly history = new Map<number, Action[]>();
  private sink: { game: number; fn: (a: Action) => void } | null = null;
  private readonly listeners = new Map<keyof Events, Set<Listener<never>>>();

  /** 部屋の人（いちばん新しい一覧） */
  members: RoomMember[] = [];
  /** 相手が部屋に戻った（リザルトで「あいては へやに もどったよ」） */
  oppBack = false;
  /** 今の試合を観戦している人の数（v2.0-J） */
  spectators = 0;

  constructor(
    readonly place: OnlinePlace,
    readonly me: OnlineMe,
    transport: NetTransport,
  ) {
    this.flaky = new URLSearchParams(window.location.search).get('debug') === '1' ? new FlakyTransport(transport) : null;
    this.transport = this.flaky ?? transport;
    const s = new OnlineSession(this.transport, {
      name: me.name,
      deck: me.deck,
      deckName: me.deckName,
      protocol: protocolVersion,
      appVersion,
      playerId: me.playerId ?? playerId(),
      ...(me.rate !== undefined ? { rate: me.rate } : {}),
      ...(me.userId ? { userId: me.userId } : {}),
      // レート対戦の2人だけの部屋は、ほかの人が来ないので すぐ対戦者を決める（v2.7）
      ...(place.kind === 'rate' ? { pickAfterMs: 0 } : {}),
    });
    this.session = s;
    s.onStatus = (v) => this.emit('status', v);
    s.onMatched = (v) => this.emit('matched', v);
    s.onStart = (g) => {
      this.lastStart = g;
      this.resultAgree = null;
      this.oppRematch = false;
      this.myRematch = false;
      this.oppBack = false;
      this.emit('start', g);
    };
    s.onConnection = (c) => this.emit('connection', c);
    s.onStamp = (id) => this.emit('stamp', id);
    s.onOpponentRematch = () => {
      this.oppRematch = true;
      this.emit('oppRematch', undefined);
    };
    s.onDesync = (turn) => this.emit('desync', turn);
    s.onResult = (agree) => {
      this.resultAgree = agree;
      this.emit('result', agree);
    };
    s.onWaitingTick = (ms) => this.emit('waitingTick', ms);
    s.onMembers = (m) => {
      this.members = m;
      this.emit('members', m);
    };
    s.onJoinLeave = (e) => this.emit('joinLeave', e);
    s.onSpectators = (n) => {
      this.spectators = n;
      this.emit('spectators', n);
    };
    s.onInvite = (v) => this.emit('invite', v);
    s.onOpponentBack = () => {
      this.oppBack = true;
      this.oppRematch = false;
      this.myRematch = false;
      this.emit('oppBack', undefined);
    };
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

  /** 「ほかの ひとと あそぶ」：部屋の まちあい に戻る（v2.0-G） */
  backToRoom(): void {
    this.myRematch = false;
    this.oppRematch = false;
    this.lastStart = null;
    this.session.backToRoom();
  }

  /** フレンド部屋の部屋番号（レート対戦の部屋なら ''） */
  get roomNumber(): string {
    return this.place.kind === 'friend' ? this.place.roomNumber : '';
  }
}

let current: OnlineLink | null = null;

/** 部屋に入る（前の通信があれば閉じてから）。フレンド部屋は部屋番号、レート対戦は2人だけの部屋 */
export function startOnline(place: OnlinePlace, me: OnlineMe): OnlineLink {
  endOnline();
  const link = new OnlineLink(place, me, createTransport());
  current = link;
  if (link.flaky) {
    // 開発用：Playwright などから通信をわざと切れるように
    (window as unknown as { __otecaNet?: unknown }).__otecaNet = {
      setOffline: (v: boolean) => link.flaky?.setOffline(v),
      corruptHash: (v: boolean) => {
        if (link.flaky) link.flaky.corruptHash = v;
      },
      selfId: link.transport.selfId,
    };
  }
  link.session.joinRoom(place.kind === 'friend' ? roomName(place.roomNumber) : rateRoomName(place.roomId));
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

/** 観戦（v2.0-J。管理者メニューの「大会閲覧」）：画面を移っても（観戦の一覧 ⇄ 対戦の画面）つながったまま */
let spectator: { room: string; session: SpectatorSession } | null = null;

/** 部屋番号の部屋を観戦する（前の観戦があれば やめてから） */
export function startSpectator(room: string): SpectatorSession {
  endSpectator();
  const session = new SpectatorSession(createTransport(), protocolVersion);
  spectator = { room, session };
  session.join(room);
  return session;
}

export function currentSpectator(): { room: string; session: SpectatorSession } | null {
  return spectator;
}

export function endSpectator(): void {
  if (!spectator) return;
  spectator.session.leave();
  spectator = null;
}

/** カードトレードの通信（v2.0-H）。画面が閉じる時に leave する */
export function createTradeSession(opts: Omit<TradeOptions, 'protocol' | 'appVersion'>): TradeSession {
  return new TradeSession(createTransport(), { ...opts, protocol: protocolVersion, appVersion });
}

/**
 * レート対戦の「さがす」（v2.0-I）：受付係（WebSocket）につなぎ、つながらなければ予備の P2P の待合所（8つの小部屋）。
 * 画面が閉じる時に leave する
 */
/** このタブの印（v2.2。受付係が「同じタブの入り直し」と「ほかのタブ・端末」を見分ける。タブを閉じるまで同じ） */
function tabId(): string {
  try {
    const k = 'oteca.tabId';
    let v = sessionStorage.getItem(k);
    if (!v || !/^[0-9a-f]{16}$/.test(v)) {
      v = [...crypto.getRandomValues(new Uint8Array(8))].map((b) => b.toString(16).padStart(2, '0')).join('');
      sessionStorage.setItem(k, v);
    }
    return v;
  } catch {
    return '';
  }
}

export function createRateSearch(opts: { userId: string; name: string; rate: number; trophies: number; lastOpponentId: string; token: string }): RateSearch {
  // 受付係は token で本人を確かめる（token が無ければ予備の待合所）
  const base = opts.token ? lobbyUrl() : null;
  const url = base ? `${base}?userId=${opts.userId}&token=${opts.token}` : null;
  // 待合所の中では、ユーザーID を playerId として使う（予備の待合所の P2P も同じ）
  const full = { playerId: opts.userId, name: opts.name, rate: opts.rate, trophies: opts.trophies, lastOpponentId: opts.lastOpponentId, protocol: protocolVersion };
  return new RateSearch({ ...full, tab: tabId() }, {
    openSocket: url ? () => new WebSocket(url) as unknown as SocketLike : null,
    createLobby: () => new RateLobby(createTransport(), full),
  });
}

/**
 * 通信の方式。ふだんは Trystero。
 * URL に ?net=local を付けると、同じブラウザのタブどうしだけでつながる開発用の通信を使う。
 */
function createTransport(): NetTransport {
  const net = new URLSearchParams(window.location.search).get('net');
  if (net === 'local') return new LocalTransport();
  // 開発サーバーの中継（別々のブラウザでもつながる。開発用）
  if (net === 'dev' && import.meta.hot) return new LocalTransport(devRelayBus);
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
