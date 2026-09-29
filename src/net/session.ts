import type { Action, Side } from '../engine/types';
import { type Msg, type MsgBody, type Ticket, fromWire, makeMsg, roomName, toWire } from './protocol';
import { fromHex, sha256, toHex } from './sha256';
import type { NetTransport } from './transport';

/**
 * フレンド対戦の通信の流れ（SPEC §11-2〜§11-7）
 * 入室 → 対戦者を決める（チケットの早い2人、3人目は満室）→ コミット・リビールで乱数の種を決める
 * → 操作を連番付きで送り合う（ロックステップ）→ ターンごとに状態ハッシュを比べる
 * ping/pong で切断を見張り、30秒以内に戻れば操作を送り直して続ける。再戦も扱う。
 * 画面（React）には依存しない。テストでは MemoryHub の通信で動かす。
 */

export type SessionStatus =
  | { kind: 'idle' }
  /** 部屋に入って相手を待っている */
  | { kind: 'waiting' }
  /** 相手が見つかって、乱数の種を決めている */
  | { kind: 'matched' }
  | { kind: 'playing' }
  | { kind: 'full' }
  | { kind: 'version' }
  | { kind: 'error'; reason: string }
  /** 対戦を中止した（cheat＝種のハッシュが合わない、left＝相手が退室した） */
  | { kind: 'aborted'; reason: 'cheat' | 'left' };

/** 相手との通信の様子（SPEC §11-7） */
export type Connection = 'ok' | 'waiting' | 'lost';

export type GameStart = {
  /** 何試合目か（0 から。再戦で +1） */
  game: number;
  seed: string;
  me: Side;
  decks: Record<Side, number[]>;
  names: Record<Side, string>;
};

export type SessionOptions = {
  name: string;
  deck: number[];
  protocol: number;
  appVersion: string;
  /** この端末（タブ）の人を表す ID。再接続の時に同じ人だと分かるように */
  playerId: string;
  clock?: Clock;
  randomBytes?: (n: number) => Uint8Array;
};

export type Clock = {
  now(): number;
  every(ms: number, fn: () => void): () => void;
};

const realClock: Clock = {
  now: () => Date.now(),
  every: (ms, fn) => {
    const id = setInterval(fn, ms);
    return () => clearInterval(id);
  },
};

function realRandom(n: number): Uint8Array {
  const b = new Uint8Array(n);
  crypto.getRandomValues(b);
  return b;
}

export const PING_EVERY_MS = 3000;
/** 見張りの間隔 */
const TICK_MS = 250;
export const WAITING_AFTER_MS = 6000;
export const LOST_AFTER_MS = 30000;
/** 最初に誰かを見つけてから、対戦者を決めるまで待つ時間（ほぼ同時に入った人の hello を集めるため） */
export const PICK_AFTER_MS = 1000;

type PeerInfo = MsgBody['hello'];

type GameNeg = {
  game: number;
  mySeed: Uint8Array;
  myCommit: string;
  oppDeck: number[] | null;
  oppCommit: string | null;
  oppSeed: Uint8Array | null;
  revealed: boolean;
  started: boolean;
};

export class OnlineSession {
  // ---------------------------------------------------------------- 知らせ（画面が差し込む）
  onStatus: (s: SessionStatus) => void = () => {};
  onStart: (g: GameStart) => void = () => {};
  onRemoteAction: (a: Action) => void = () => {};
  onConnection: (c: Connection) => void = () => {};
  onStamp: (id: number) => void = () => {};
  /** 相手が「もういっかい」を押した */
  onOpponentRematch: () => void = () => {};
  /** 状態ハッシュが合わなかった（SPEC §11-6） */
  onDesync: (turn: number) => void = () => {};
  /** 相手が見つかった（VS画面用） */
  onMatched: (opponentName: string) => void = () => {};
  /** 相手を待っている間、1秒ごと（入ってからの ms） */
  onWaitingTick: (ms: number) => void = () => {};

  status: SessionStatus = { kind: 'idle' };
  connection: Connection = 'ok';

  private readonly clock: Clock;
  private readonly randomBytes: (n: number) => Uint8Array;
  private ticket: Ticket = { time: 0, rand: 0 };
  private readonly peers = new Map<string, PeerInfo>();
  private opponentPeer: string | null = null;
  private opponentPlayerId: string | null = null;
  private opponentName = '';
  private role: Side = 'p1';
  private stopTimer: (() => void) | null = null;
  private lastHeard = 0;
  private joinedAt = 0;
  private lastPing = 0;
  /** この時刻を過ぎたら対戦者を決める（0 はまだ誰も見つけていない） */
  private pickAt = 0;

  // 試合ごと
  private game = 0;
  private neg: GameNeg | null = null;
  private readonly early = new Map<number, Msg[]>();
  /** 対戦者を決める前に届いたメッセージ（送り主ごと） */
  private readonly preMatch = new Map<string, Msg[]>();
  private myLog: MsgBody['action'][] = [];
  private expectedSeq = 1;
  private readonly buffered = new Map<number, MsgBody['action']>();
  private readonly myHashes = new Map<number, string>();
  private readonly oppHashes = new Map<number, string>();
  private myRematch = -1;
  private oppRematch = -1;
  /** 受け取った不正なメッセージの記録（SPEC §11-5「ログに残す」） */
  readonly ignored: string[] = [];

  constructor(
    private readonly transport: NetTransport,
    private readonly opts: SessionOptions,
  ) {
    this.clock = opts.clock ?? realClock;
    this.randomBytes = opts.randomBytes ?? realRandom;
    transport.onMessage = (m, from) => this.receive(m, from);
    transport.onPeerJoin = (id) => this.sendHello(id);
    transport.onPeerLeave = (id) => this.peerLeft(id);
    transport.onError = (reason) => {
      // まだ誰ともつながっていない時だけ「つながらなかった」にする
      // （関係のない人とのつながりに失敗しただけで、待つのをやめないように）
      if (this.status.kind === 'waiting' && this.peers.size === 0) this.setStatus({ kind: 'error', reason });
    };
  }

  get selfId(): string {
    return this.transport.selfId;
  }

  get myRole(): Side {
    return this.role;
  }

  /** 部屋に入る（部屋番号 4〜8桁） */
  join(roomNumber: string): void {
    const r = this.randomBytes(4);
    this.ticket = { time: this.clock.now(), rand: ((r[0] << 24) | (r[1] << 16) | (r[2] << 8) | r[3]) >>> 0 };
    this.setStatus({ kind: 'waiting' });
    this.transport.join(roomName(roomNumber));
    this.lastHeard = this.clock.now();
    this.joinedAt = this.clock.now();
    this.pickAt = 0;
    this.lastPing = 0;
    this.stopTimer = this.clock.every(TICK_MS, () => this.tick());
  }

  leave(): void {
    if (this.opponentPeer) this.send(makeMsg('leave', this.opts.protocol, {}), this.opponentPeer);
    this.close();
  }

  /** 自分の操作を送る（自分の端末のエンジンにも同じ操作を通すこと） */
  sendAction(action: Action): void {
    if (!this.neg?.started) return;
    const body = { seq: this.myLog.length + 1, action: toWire(action), game: this.game };
    this.myLog.push(body);
    this.sendToOpponent(makeMsg('action', this.opts.protocol, body));
  }

  /** ターン終了ごとの状態ハッシュ（SPEC §11-6） */
  sendHash(turn: number, hash: string): void {
    this.myHashes.set(turn, hash);
    this.sendToOpponent(makeMsg('hash', this.opts.protocol, { turn, hash, game: this.game }));
    this.compareHash(turn);
  }

  sendStamp(id: number): void {
    this.sendToOpponent(makeMsg('stamp', this.opts.protocol, { id }));
  }

  /** 「もういっかい」（両者が押したら再戦） */
  requestRematch(): void {
    this.myRematch = this.game + 1;
    this.sendToOpponent(makeMsg('rematch', this.opts.protocol, { game: this.game + 1 }));
    this.maybeRematch();
  }

  /** 行動ログ（ズレた時のダウンロード用） */
  debugLog(): unknown {
    return { selfId: this.selfId, role: this.role, game: this.game, sent: this.myLog, expectedSeq: this.expectedSeq, ignored: this.ignored };
  }

  // ---------------------------------------------------------------- 受け取り

  private receive(m: Msg, from: string): void {
    if (from === this.opponentPeer) this.heard();
    switch (m.t) {
      case 'hello':
        this.gotHello(m.body, from);
        return;
      case 'full':
        // 待っている時か、自分が選んだ相手から（相手は別の人と組んでいた）なら、自分があふれた
        if (this.status.kind === 'waiting' || (this.status.kind === 'matched' && from === this.opponentPeer)) {
          this.setStatus({ kind: 'full' });
          this.close();
        }
        return;
      case 'ping':
        this.send(makeMsg('pong', this.opts.protocol, { t: m.body.t, n: this.myLog.length, game: this.game }), from);
        if (from === this.opponentPeer) this.checkBehind(m.body);
        return;
      case 'pong':
        if (from === this.opponentPeer) this.checkBehind(m.body);
        return;
    }
    if (from !== this.opponentPeer) {
      // まだ対戦者を決めていない間に届いたもの（相手の方が先に決めた）は、決めてから通す
      if (this.status.kind === 'waiting' && this.peers.has(from)) {
        const list = this.preMatch.get(from) ?? [];
        list.push(m);
        this.preMatch.set(from, list);
        return;
      }
      this.ignored.push(`${m.t} from ${from}`);
      return;
    }
    switch (m.t) {
      case 'deck':
      case 'reveal':
        if (m.body.game > this.game) this.keepEarly(m.body.game, m);
        else if (m.body.game === this.game) void this.gotNeg(m);
        return;
      case 'action':
        if (m.body.game > this.game) this.keepEarly(m.body.game, m);
        else if (m.body.game === this.game) this.gotAction(m.body);
        return;
      case 'resend':
        if (m.body.game === this.game) for (const a of this.myLog.slice(m.body.from - 1)) this.sendToOpponent(makeMsg('action', this.opts.protocol, a));
        return;
      case 'hash':
        if (m.body.game !== this.game) return;
        this.oppHashes.set(m.body.turn, m.body.hash);
        this.compareHash(m.body.turn);
        return;
      case 'stamp':
        this.onStamp(m.body.id);
        return;
      case 'rematch':
        this.oppRematch = m.body.game;
        this.onOpponentRematch();
        this.maybeRematch();
        return;
      case 'leave':
        this.setStatus({ kind: 'aborted', reason: 'left' });
        this.close();
        return;
    }
  }

  private sendHello(to?: string): void {
    if (this.status.kind === 'idle' || this.status.kind === 'full' || this.status.kind === 'version') return;
    this.send(
      makeMsg('hello', this.opts.protocol, {
        protocol: this.opts.protocol,
        appVersion: this.opts.appVersion,
        name: this.opts.name,
        ticket: this.ticket,
        playerId: this.opts.playerId,
      }),
      to,
    );
  }

  private gotHello(raw: PeerInfo, from: string): void {
    const h = cleanHello(raw);
    if (!h) {
      this.ignored.push(`bad hello from ${from}`);
      return;
    }
    if (h.protocol !== this.opts.protocol) {
      if (this.status.kind !== 'waiting' || this.opponentPlayerId) {
        // もう対戦者が決まっている：版の違う人が来ても対戦は続ける（その人には満室を返す）
        this.send(makeMsg('full', this.opts.protocol, {}), from);
        return;
      }
      // 両者に「バージョンがちがうよ」を出す（相手にも分かるように、自分の hello も返す）
      this.sendHello(from);
      this.setStatus({ kind: 'version' });
      this.close();
      return;
    }
    const known = this.peers.has(from);
    this.peers.set(from, h);
    if (!known) this.sendHello(from);

    if (this.opponentPlayerId) {
      if (h.playerId === this.opponentPlayerId) {
        // 再接続（SPEC §11-7）：それまでの操作を全部送り直す
        this.opponentPeer = from;
        this.heard();
        this.resync();
      } else {
        this.send(makeMsg('full', this.opts.protocol, {}), from);
      }
      return;
    }
    // すぐには決めず、少し待ってほかの人の hello も集めてから決める
    if (this.pickAt === 0) this.pickAt = this.clock.now() + PICK_AFTER_MS;
  }

  /** 入室チケットが早い2人が対戦者（SPEC §11-2） */
  private pickPlayers(): void {
    if (this.status.kind !== 'waiting') return;
    const me = { id: this.selfId, ticket: this.ticket };
    const all = [me, ...[...this.peers].map(([id, h]) => ({ id, ticket: h.ticket }))];
    all.sort((a, b) => a.ticket.time - b.ticket.time || a.ticket.rand - b.ticket.rand || (a.id < b.id ? -1 : 1));
    const players = all.slice(0, 2);
    if (!players.some((p) => p.id === this.selfId)) {
      this.setStatus({ kind: 'full' });
      this.close();
      return;
    }
    for (const p of all.slice(2)) this.send(makeMsg('full', this.opts.protocol, {}), p.id);
    if (players.length < 2) {
      // 相手がいなくなっていた：次に誰か来たら、また少し待ってから決める
      this.pickAt = 0;
      return;
    }
    const opp = players.find((p) => p.id !== this.selfId)!;
    const info = this.peers.get(opp.id)!;
    this.opponentPeer = opp.id;
    this.opponentPlayerId = info.playerId;
    this.opponentName = info.name;
    // 役割はピアIDの文字列比較で小さい方が p1（先攻・後攻とは別）
    this.role = this.selfId < opp.id ? 'p1' : 'p2';
    this.heard();
    this.setStatus({ kind: 'matched' });
    this.onMatched(this.opponentName);
    void this.startNegotiation(0);
    const held = this.preMatch.get(opp.id) ?? [];
    this.preMatch.clear();
    for (const m of held) this.receive(m, opp.id);
  }

  // ---------------------------------------------------------------- コミット・リビール（SPEC §11-4）

  private async startNegotiation(game: number): Promise<void> {
    this.game = game;
    this.myLog = [];
    this.expectedSeq = 1;
    this.buffered.clear();
    this.myHashes.clear();
    this.oppHashes.clear();
    const mySeed = this.randomBytes(32);
    const myCommit = toHex(await sha256(mySeed));
    this.neg = { game, mySeed, myCommit, oppDeck: null, oppCommit: null, oppSeed: null, revealed: false, started: false };
    this.sendToOpponent(makeMsg('deck', this.opts.protocol, { cards: this.opts.deck, commit: myCommit, game }));
    // 先に届いていたメッセージ
    const early = this.early.get(game) ?? [];
    this.early.delete(game);
    for (const m of early) {
      if (m.t === 'action') this.gotAction(m.body);
      else if (m.t === 'deck' || m.t === 'reveal') await this.gotNeg(m);
    }
  }

  private async gotNeg(m: Extract<Msg, { t: 'deck' | 'reveal' }>): Promise<void> {
    const neg = this.neg;
    if (!neg || neg.game !== m.body.game) {
      this.keepEarly(m.body.game, m);
      return;
    }
    if (m.t === 'deck') {
      neg.oppDeck = m.body.cards;
      neg.oppCommit = m.body.commit;
      if (!neg.revealed) {
        neg.revealed = true;
        this.sendToOpponent(makeMsg('reveal', this.opts.protocol, { seed: toHex(neg.mySeed), game: neg.game }));
      }
    } else {
      if (!neg.oppCommit) {
        // deck より先に reveal が来ることは無いはずだが、念のため後で処理する
        this.keepEarly(m.body.game, m);
        return;
      }
      let seed: Uint8Array;
      try {
        seed = fromHex(m.body.seed);
      } catch {
        this.setStatus({ kind: 'aborted', reason: 'cheat' });
        return;
      }
      if (toHex(await sha256(seed)) !== neg.oppCommit) {
        this.setStatus({ kind: 'aborted', reason: 'cheat' });
        this.close();
        return;
      }
      neg.oppSeed = seed;
    }
    await this.maybeStart();
  }

  private async maybeStart(): Promise<void> {
    const neg = this.neg;
    if (!neg || neg.started || !neg.oppSeed || !neg.oppDeck || !neg.revealed) return;
    // 種 = SHA-256(seed_p1 + seed_p2)
    const p1 = this.role === 'p1' ? neg.mySeed : neg.oppSeed;
    const p2 = this.role === 'p1' ? neg.oppSeed : neg.mySeed;
    const joined = new Uint8Array(p1.length + p2.length);
    joined.set(p1);
    joined.set(p2, p1.length);
    const seed = toHex(await sha256(joined));
    if (neg.started) return;
    neg.started = true;
    const opp: Side = this.role === 'p1' ? 'p2' : 'p1';
    this.setStatus({ kind: 'playing' });
    this.onStart({
      game: neg.game,
      seed,
      me: this.role,
      decks: { [this.role]: this.opts.deck, [opp]: neg.oppDeck } as Record<Side, number[]>,
      names: { [this.role]: this.opts.name, [opp]: this.opponentName } as Record<Side, string>,
    });
    // 種が決まる前に届いていた操作
    this.flushActions();
  }

  // ---------------------------------------------------------------- 操作（連番・重複・飛び）

  private gotAction(body: MsgBody['action']): void {
    if (body.seq < this.expectedSeq || this.buffered.has(body.seq)) return; // 重複は無視
    this.buffered.set(body.seq, body);
    if (!this.neg?.started) return;
    if (body.seq > this.expectedSeq) {
      // 飛びがあった → 再送を要求
      this.sendToOpponent(makeMsg('resend', this.opts.protocol, { from: this.expectedSeq, game: this.game }));
    }
    this.flushActions();
  }

  private flushActions(): void {
    const opp: Side = this.role === 'p1' ? 'p2' : 'p1';
    for (;;) {
      const next = this.buffered.get(this.expectedSeq);
      if (!next) return;
      this.buffered.delete(this.expectedSeq);
      this.expectedSeq += 1;
      this.onRemoteAction(fromWire(next.action, opp));
    }
  }

  /** 相手が送った数より受け取った数が少なければ、足りない分の再送を頼む */
  private checkBehind(b: { n?: number; game?: number }): void {
    if (!this.neg?.started || b.game !== this.game || b.n === undefined) return;
    if (b.n >= this.expectedSeq && !this.buffered.has(this.expectedSeq)) {
      this.sendToOpponent(makeMsg('resend', this.opts.protocol, { from: this.expectedSeq, game: this.game }));
    }
  }

  private compareHash(turn: number): void {
    const a = this.myHashes.get(turn);
    const b = this.oppHashes.get(turn);
    if (a !== undefined && b !== undefined && a !== b) this.onDesync(turn);
  }

  // ---------------------------------------------------------------- 再接続・再戦

  /** 相手が戻ってきた：交渉中なら deck/reveal を、対戦中なら操作を全部送り直す */
  private resync(): void {
    const neg = this.neg;
    if (!neg) return;
    this.sendToOpponent(makeMsg('deck', this.opts.protocol, { cards: this.opts.deck, commit: neg.myCommit, game: neg.game }));
    if (neg.revealed) this.sendToOpponent(makeMsg('reveal', this.opts.protocol, { seed: toHex(neg.mySeed), game: neg.game }));
    for (const a of this.myLog) this.sendToOpponent(makeMsg('action', this.opts.protocol, a));
    if (this.myRematch > this.game) this.sendToOpponent(makeMsg('rematch', this.opts.protocol, { game: this.myRematch }));
  }

  private maybeRematch(): void {
    const next = this.game + 1;
    if (this.myRematch === next && this.oppRematch === next) {
      this.setStatus({ kind: 'matched' });
      void this.startNegotiation(next);
    }
  }

  private keepEarly(game: number, m: Msg): void {
    const list = this.early.get(game) ?? [];
    list.push(m);
    this.early.set(game, list);
  }

  // ---------------------------------------------------------------- 切断の見張り（SPEC §11-7）

  private tick(): void {
    if (this.status.kind === 'waiting') {
      this.onWaitingTick(this.clock.now() - this.joinedAt);
      if (this.pickAt !== 0 && this.clock.now() >= this.pickAt) this.pickPlayers();
    }
    if (!this.opponentPeer && !this.opponentPlayerId) return;
    if (this.opponentPeer && this.clock.now() - this.lastPing >= PING_EVERY_MS) {
      this.lastPing = this.clock.now();
      this.send(makeMsg('ping', this.opts.protocol, { t: this.clock.now(), n: this.myLog.length, game: this.game }), this.opponentPeer);
    }
    const since = this.clock.now() - this.lastHeard;
    const next: Connection = since >= LOST_AFTER_MS ? 'lost' : since >= WAITING_AFTER_MS ? 'waiting' : 'ok';
    if (next !== this.connection) {
      this.connection = next;
      this.onConnection(next);
    }
  }

  private heard(): void {
    this.lastHeard = this.clock.now();
    if (this.connection !== 'ok') {
      this.connection = 'ok';
      // 通信が戻った：途切れている間に届かなかったかもしれないので、全部送り直す（重複は相手が捨てる）
      this.resync();
      this.onConnection('ok');
    }
  }

  /** 「もうすこし まつ」：切れた扱いをやめて、もう30秒待つ（SPEC §11-7） */
  waitMore(): void {
    this.lastHeard = this.clock.now() - WAITING_AFTER_MS;
    this.connection = 'waiting';
    this.onConnection('waiting');
  }

  /** 相手の名前 */
  get opponent(): string {
    return this.opponentName;
  }

  private peerLeft(id: string): void {
    this.peers.delete(id);
    if (id === this.opponentPeer) {
      this.opponentPeer = null;
      if (this.connection === 'ok') {
        this.connection = 'waiting';
        this.onConnection('waiting');
      }
    }
  }

  // ---------------------------------------------------------------- 道具

  /** ping の間隔（テスト用に外から時間を進める時に使う） */
  pingNow(): void {
    this.tick();
  }

  private sendToOpponent(m: Msg): void {
    if (this.opponentPeer) this.send(m, this.opponentPeer);
  }

  private send(m: Msg, to?: string): void {
    this.transport.send(m, to);
  }

  private setStatus(s: SessionStatus): void {
    this.status = s;
    this.onStatus(s);
  }

  private close(): void {
    this.stopTimer?.();
    this.stopTimer = null;
    this.transport.leave();
  }
}

/** 名前の長さ（SPEC §7 S06：8文字まで） */
const NAME_MAX = 8;

/** 受け取った hello の中身を確かめる（壊れたデータで画面が落ちたり、対戦者の選び方が食い違ったりしないように） */
function cleanHello(h: PeerInfo): PeerInfo | null {
  if (!h || typeof h !== 'object') return null;
  const t = h.ticket as Partial<Ticket> | undefined;
  if (typeof h.protocol !== 'number' || typeof h.playerId !== 'string' || !t || !Number.isFinite(t.time) || !Number.isFinite(t.rand)) return null;
  const name = typeof h.name === 'string' && h.name.trim() !== '' ? [...h.name].slice(0, NAME_MAX).join('') : '？';
  return { protocol: h.protocol, appVersion: String(h.appVersion ?? ''), name, ticket: { time: Number(t.time), rand: Number(t.rand) }, playerId: h.playerId.slice(0, 64) };
}
