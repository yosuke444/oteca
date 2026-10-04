import type { RateLobby, RateLobbyOptions, RatePaired } from './rateLobby';

/**
 * レート対戦の「さがす」（v2.0-I。UPDATE_v2 §8-4・SPEC §7 S15・§11-9）
 * ふだんは受付係（Cloudflare の Durable Object）に WebSocket でつなぎ、受付係が組んだ相手を受け取る。
 * 受付係に5秒つながらない時・待っている途中で切れた時は、予備の P2P の待合所（8つの小部屋）に切り替える。
 * 画面（React）には依存しない。テストでは偽の WebSocket で動かす。
 */

/** WebSocket のうち、使う所だけ */
export type SocketLike = {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onopen: (() => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: ((ev?: { code?: number }) => void) | null;
  onerror: (() => void) | null;
};

/** 受付係につながるまで待つ時間（これを過ぎたら予備の待合所へ） */
export const LOBBY_CONNECT_MS = 5000;
/** 待っている途中で切れた時、つなぎ直すまでの時間（1回だけ。だめなら予備の待合所へ） */
export const LOBBY_RETRY_MS = 1000;
/** 同じセーブの別のタブが さがし始めたので、受付係がこのタブの接続を切った */
export const CLOSE_REPLACED = 4000;

export type RateSearchDeps = {
  /** 受付係の WebSocket を開く（null は受付係を使わない：すぐ予備の待合所へ） */
  openSocket: (() => SocketLike) | null;
  /** 予備の待合所を作る */
  createLobby: () => RateLobby;
  /** 時間がたったら呼ぶ（止める関数を返す） */
  setTimer?: (fn: () => void, ms: number) => () => void;
};

type Mode = 'idle' | 'connecting' | 'lobby' | 'p2p' | 'done';

/** 受付係から届くもの */
type ServerMsg =
  | { t: 'waiting'; body: { count: number } }
  | { t: 'paired'; body: { matchId: string; roomId: string; opponent: { playerId: string; name: string; rate: number } } }
  | { t: 'error'; body: { reason: string } };

const realTimer = (fn: () => void, ms: number) => {
  const id = setTimeout(fn, ms);
  return () => clearTimeout(id);
};

export class RateSearch {
  /** 待っている人数（自分もふくむ）が変わった */
  onWaiting: (count: number) => void = () => {};
  /** 相手が決まった（このあと2人だけの部屋へ） */
  onPaired: (p: RatePaired) => void = () => {};
  /** 予備の待合所に切り替えた（画面に「いまは こみあっているので…」） */
  onFallback: () => void = () => {};
  /** 同じセーブの別のタブが さがし始めたので、このタブは やめた */
  onReplaced: () => void = () => {};

  private mode: Mode = 'idle';
  private ws: SocketLike | null = null;
  private lobby: RateLobby | null = null;
  private stopTimer: (() => void) | null = null;
  /** つなぎ直した回数 */
  private retries = 0;
  private readonly setTimer: (fn: () => void, ms: number) => () => void;

  constructor(
    private readonly opts: Pick<RateLobbyOptions, 'playerId' | 'name' | 'rate' | 'lastOpponentId' | 'protocol'>,
    private readonly deps: RateSearchDeps,
  ) {
    this.setTimer = deps.setTimer ?? realTimer;
  }

  /** 受付係を使っているか（false は予備の待合所） */
  get usingLobby(): boolean {
    return this.mode === 'connecting' || this.mode === 'lobby';
  }

  get fallback(): boolean {
    return this.mode === 'p2p';
  }

  /** 「さがす」 */
  join(): void {
    if (this.mode !== 'idle') return;
    this.mode = 'connecting';
    this.retries = 0;
    this.connect();
  }

  private connect(): void {
    if (!this.deps.openSocket) {
      this.toFallback();
      return;
    }
    let ws: SocketLike;
    try {
      ws = this.deps.openSocket();
    } catch {
      this.toFallback();
      return;
    }
    this.ws = ws;
    this.stopTimer = this.setTimer(() => {
      if (this.mode === 'connecting') this.toFallback();
    }, LOBBY_CONNECT_MS);
    ws.onopen = () => {
      if (this.mode !== 'connecting' || this.ws !== ws) return;
      this.clearTimer();
      this.mode = 'lobby';
      const { playerId, protocol, lastOpponentId, name, rate } = this.opts;
      ws.send(JSON.stringify({ t: 'join', body: { playerId, protocol, lastOpponentId, name, rate } }));
    };
    ws.onmessage = (ev) => {
      if (this.ws !== ws) return;
      let m: ServerMsg;
      try {
        m = JSON.parse(String(ev.data)) as ServerMsg;
      } catch {
        return;
      }
      if (m.t === 'waiting' && Number.isInteger(m.body?.count)) this.onWaiting(m.body.count);
      else if (m.t === 'paired') this.paired(m.body);
      else if (m.t === 'error') this.toFallback();
    };
    // つながる前に切れた：予備の待合所へ。待っている途中に切れた：1回だけ つなぎ直す（組めた後・やめた後は何もしない）
    ws.onclose = (ev) => {
      if (this.ws !== ws) return;
      if (ev?.code === CLOSE_REPLACED) {
        this.leave();
        this.onReplaced();
        return;
      }
      if (this.mode === 'lobby' && this.retries < 1) {
        this.retries += 1;
        this.closeSocket(false);
        this.mode = 'connecting';
        this.stopTimer = this.setTimer(() => {
          if (this.mode === 'connecting' && !this.ws) this.connect();
        }, LOBBY_RETRY_MS);
        return;
      }
      if (this.mode === 'connecting' || this.mode === 'lobby') this.toFallback();
    };
    // エラーの後には close が来るので、そちらで決める
    ws.onerror = () => {};
  }

  /** 「やめる」・画面を出る・相手が決まった後 */
  leave(): void {
    this.clearTimer();
    this.closeSocket(true);
    this.lobby?.leave();
    this.lobby = null;
    this.mode = 'idle';
  }

  private paired(b: Extract<ServerMsg, { t: 'paired' }>['body']): void {
    const hex = (v: unknown) => typeof v === 'string' && /^[0-9a-f]{16}$/.test(v);
    if (!b || !hex(b.matchId) || !hex(b.roomId) || !hex(b.opponent?.playerId)) {
      this.toFallback();
      return;
    }
    this.mode = 'done';
    // 組めたら受付係との接続は切る
    this.closeSocket(false);
    this.onPaired({
      roomId: b.roomId,
      matchId: b.matchId,
      viaLobby: true,
      opponentId: b.opponent.playerId,
      opponentName: typeof b.opponent.name === 'string' ? b.opponent.name : '',
      opponentRate: Number.isFinite(b.opponent.rate) ? Math.max(0, Math.round(b.opponent.rate)) : 100,
    });
  }

  private toFallback(): void {
    if (this.mode === 'p2p' || this.mode === 'done' || this.mode === 'idle') return;
    this.clearTimer();
    this.closeSocket(true);
    this.mode = 'p2p';
    const lobby = this.deps.createLobby();
    this.lobby = lobby;
    lobby.onWaiting = (n) => this.onWaiting(n);
    lobby.onPaired = (p) => {
      this.mode = 'done';
      lobby.leave();
      this.lobby = null;
      this.onPaired(p);
    };
    this.onFallback();
    lobby.join();
  }

  private closeSocket(sendLeave: boolean): void {
    const ws = this.ws;
    this.ws = null;
    if (!ws) return;
    ws.onopen = ws.onmessage = ws.onclose = ws.onerror = null;
    try {
      if (sendLeave && ws.readyState === 1) ws.send(JSON.stringify({ t: 'leave' }));
      ws.close(1000, 'bye');
    } catch {
      // もう閉じている
    }
  }

  private clearTimer(): void {
    this.stopTimer?.();
    this.stopTimer = null;
  }
}
