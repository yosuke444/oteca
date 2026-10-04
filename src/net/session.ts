import type { Action, Side } from '../engine/types';
import { type MemberState, type Msg, type MsgBody, type Ticket, fromWire, makeMsg, roomName, toWire } from './protocol';
import { fromHex, sha256, toHex } from './sha256';
import type { NetTransport } from './transport';

/**
 * フレンド対戦の通信の流れ（SPEC §11-2〜§11-7）
 * 入室 → 部屋の人をそろえる（8人まで。v2.0-G）→ 2人だけなら自動で、3人以上なら申し込みで対戦者を決める
 * → コミット・リビールで乱数の種を決める → 操作を連番付きで送り合う（ロックステップ）→ ターンごとに状態ハッシュを比べる
 * ping/pong で切断を見張り、30秒以内に戻れば操作を送り直して続ける。再戦・「ほかの ひとと あそぶ」も扱う。
 * 画面（React）には依存しない。テストでは MemoryHub の通信で動かす。
 */

export type SessionStatus =
  | { kind: 'idle' }
  /** 部屋に入って相手を待っている（部屋の中では「まちあい」） */
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
  /** 何試合目か（0 から。再戦で +1。部屋で相手が変わっても前より大きい番号） */
  game: number;
  seed: string;
  me: Side;
  decks: Record<Side, number[]>;
  names: Record<Side, string>;
  /** 相手のプレイヤーID（レート対戦で「直前の相手」を覚えるため。v2.0-G） */
  oppPlayerId: string;
  /** 相手のレート（レート対戦の時だけ） */
  oppRate?: number;
  /** 相手のユーザーID（v2.0-J。停止中か確かめる。古い版の相手・まだ無い時は ''） */
  oppUserId: string;
  /** 同じ相手との再戦で、相手が前の試合とデッキを変えた（v2.0-G） */
  oppDeckChanged: boolean;
};

/** 部屋の人（自分もふくむ。v2.0-G） */
export type RoomMember = { peerId: string; name: string; state: MemberState; deckName: string; me: boolean };

/** 申し込みの様子（v2.0-G） */
export type InviteState =
  | { kind: 'none' }
  /** 申し込んで返事を待っている */
  | { kind: 'sent'; to: string; name: string }
  /** 申し込まれた（あそぶ／いまは やめとく） */
  | { kind: 'received'; from: string; name: string }
  /** ことわられた */
  | { kind: 'declined'; name: string }
  /** 15秒 返事が無かった・取り消された */
  | { kind: 'expired'; name: string };

export type SessionOptions = {
  name: string;
  deck: number[];
  /** いまのデッキの名前（部屋の人に見せる） */
  deckName?: string;
  protocol: number;
  appVersion: string;
  /** この端末（タブ）の人を表す ID。再接続の時に同じ人だと分かるように */
  playerId: string;
  /** レート対戦の時だけ：自分のレート（相手に知らせる） */
  rate?: number;
  /** 自分のユーザーID（v2.0-J。相手が停止中か確かめるために送る） */
  userId?: string;
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
/** 1部屋に入れる人数（v2.0-G。全員が全員とつながる方式のため） */
export const ROOM_MAX = 8;
/** 観戦者の数（部屋の人数とは別。v2.0-J） */
export const SPECTATOR_MAX = 3;
/** 申し込みの返事を待つ時間（v2.0-G） */
export const INVITE_MS = 15000;
/** 承諾してから組み合わせ（pairStart）が届くまで待つ時間 */
const AWAIT_PAIR_MS = 5000;

type PeerInfo = MsgBody['hello'] & { state: MemberState; deckName: string; nextGame: number };

type GameNeg = {
  game: number;
  mySeed: Uint8Array;
  myCommit: string;
  oppDeck: number[] | null;
  oppCommit: string | null;
  oppSeed: Uint8Array | null;
  revealed: boolean;
  started: boolean;
  /** deck より先に届いた reveal */
  pendingReveal: Extract<Msg, { t: 'reveal' }> | null;
};

/** 対戦の中の通信（相手とだけやりとりする）。部屋の通信は誰とでも */
const MATCH_TYPES: ReadonlySet<Msg['t']> = new Set(['deck', 'reveal', 'action', 'resend', 'hash', 'stamp', 'rematch', 'leave', 'back']);

export class OnlineSession {
  // ---------------------------------------------------------------- 知らせ（画面が差し込む）
  onStatus: (s: SessionStatus) => void = () => {};
  onStart: (g: GameStart) => void = () => {};
  onRemoteAction: (a: Action) => void = () => {};
  onConnection: (c: Connection) => void = () => {};
  onStamp: (id: number) => void = () => {};
  /** 相手が「もういっかい」を押した */
  onOpponentRematch: () => void = () => {};
  /** 決着の結果が2人でそろったか（そろった時だけ勝敗を記録する） */
  onResult: (agree: boolean) => void = () => {};
  /** 状態ハッシュが合わなかった（SPEC §11-6） */
  onDesync: (turn: number) => void = () => {};
  /** 相手が見つかった（VS画面用） */
  onMatched: (opponentName: string) => void = () => {};
  /** 今の試合を観戦している人の数が変わった（v2.0-J。画面の隅に「かんせんちゅう」） */
  onSpectators: (count: number) => void = () => {};
  /** 相手を待っている間、1秒ごと（入ってからの ms） */
  onWaitingTick: (ms: number) => void = () => {};
  /** 部屋の人が変わった（v2.0-G） */
  onMembers: (members: RoomMember[]) => void = () => {};
  /** 人が来た・出ていった（画面の端に短く知らせる。v2.0-G） */
  onJoinLeave: (e: { kind: 'join' | 'leave'; name: string }) => void = () => {};
  /** 申し込みの様子が変わった（v2.0-G） */
  onInvite: (s: InviteState) => void = () => {};
  /** 相手が「ほかの ひとと あそぶ」を押して部屋に戻った（v2.0-G） */
  onOpponentBack: () => void = () => {};

  status: SessionStatus = { kind: 'idle' };
  connection: Connection = 'ok';
  invite: InviteState = { kind: 'none' };

  private readonly clock: Clock;
  private readonly randomBytes: (n: number) => Uint8Array;
  private ticket: Ticket = { time: 0, rand: 0 };
  private readonly peers = new Map<string, PeerInfo>();
  private opponentPeer: string | null = null;
  private opponentPlayerId: string | null = null;
  /** 相手のユーザーID（v2.0-J。hello で届く。古い版の相手は ''） */
  private opponentUserId = '';
  private opponentName = '';
  private opponentRate: number | undefined = undefined;
  private role: Side = 'p1';
  private stopTimer: (() => void) | null = null;
  private lastHeard = 0;
  private joinedAt = 0;
  private lastPing = 0;
  /** この時刻を過ぎたら、2人だけの部屋の対戦者を決める（0 は決めない） */
  private pickAt = 0;
  /** 次の試合の番号（部屋で相手が変わっても、前より大きい番号にする） */
  private nextGame = 0;
  /** 相手ごとの、前の試合のデッキ（再戦でデッキを変えたか見る） */
  private readonly lastOppDecks = new Map<string, string>();
  // 申し込み（v2.0-G）
  private outgoing: { to: string; id: string; until: number } | null = null;
  private incoming: { from: string; id: string; until: number } | null = null;
  private awaiting: { from: string; id: string; until: number } | null = null;

  // 試合ごと
  private game = 0;
  private neg: GameNeg | null = null;
  private readonly early = new Map<number, Msg[]>();
  /** 対戦者を決める前に届いた対戦のメッセージ（送り主ごと） */
  private readonly preMatch = new Map<string, Msg[]>();
  private myLog: MsgBody['action'][] = [];
  private expectedSeq = 1;
  private readonly buffered = new Map<number, MsgBody['action']>();
  private readonly myHashes = new Map<number, string>();
  private readonly oppHashes = new Map<number, string>();
  private myRematch = -1;
  /** この試合でずれを知らせた */
  private desynced = false;
  private desyncTurn = 0;
  private myResult: Side | null = null;
  private oppResult: Side | null = null;
  private resultTold = false;
  /** 「もうすこし まつ」を押した時、この時刻までは「きれた」にしない */
  private graceUntil = 0;
  private oppRematch = -1;
  /** 観戦者（ピアID → 今の試合を見ているか）。部屋の人（peers）には入れない（v2.0-J） */
  private readonly spectators = new Map<string, { watching: boolean }>();
  /** 今の試合の始まり（観戦者に送る） */
  private lastStart: GameStart | null = null;
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
    this.joinRoom(roomName(roomNumber));
  }

  /** 部屋の名前で入る（レート対戦の2人だけの部屋。v2.0-G） */
  joinRoom(room: string): void {
    const r = this.randomBytes(4);
    this.ticket = { time: this.clock.now(), rand: ((r[0] << 24) | (r[1] << 16) | (r[2] << 8) | r[3]) >>> 0 };
    this.setStatus({ kind: 'waiting' });
    this.transport.join(room);
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

  /** 次の試合から使うデッキを変える（v2.0-G「デッキを かえる」。試合中は変えない） */
  setDeck(cards: number[], deckName: string): void {
    this.opts.deck = [...cards];
    this.opts.deckName = deckName;
    if (this.status.kind === 'waiting' || this.status.kind === 'playing') this.sendPresence();
  }

  /** 部屋の人（自分もふくむ。入室チケットの順） */
  get members(): RoomMember[] {
    const me: RoomMember & { ticket: Ticket } = { peerId: this.selfId, name: this.opts.name, state: this.myState(), deckName: this.opts.deckName ?? '', me: true, ticket: this.ticket };
    const others = [...this.peers].map(([peerId, h]) => ({ peerId, name: h.name, state: h.state, deckName: h.deckName, me: false, ticket: h.ticket }));
    return [me, ...others].sort(byTicket).map(({ ticket: _t, ...m }) => (void _t, m));
  }

  /** 自分の操作を送る（自分の端末のエンジンにも同じ操作を通すこと） */
  sendAction(action: Action): void {
    if (!this.neg?.started) return;
    const body = { seq: this.myLog.length + 1, action: toWire(action), game: this.game };
    this.myLog.push(body);
    this.sendToOpponent(makeMsg('action', this.opts.protocol, body));
    // 観戦者にも（v2.0-J）
    for (const [peer, sp] of this.spectators)
      if (sp.watching) this.send(makeMsg('specAction', this.opts.protocol, { game: this.game, side: this.role, seq: body.seq, action: body.action }), peer);
  }

  /** 今の試合を見ている観戦者の数 */
  get spectatorCount(): number {
    return [...this.spectators.values()].filter((s) => s.watching).length;
  }

  /** ターン終了ごとの状態ハッシュ（SPEC §11-6） */
  sendHash(turn: number, hash: string): void {
    this.myHashes.set(turn, hash);
    this.sendToOpponent(makeMsg('hash', this.opts.protocol, { turn, hash, game: this.game }));
    this.compareHash(turn);
  }

  /** 決着した時：どちらの勝ちになったかを送り合う（SPEC §11-6 の考え方を決着にも使う） */
  sendResult(winner: Side): void {
    this.myResult = winner;
    this.sendToOpponent(makeMsg('hash', this.opts.protocol, { turn: 0, hash: 'end', game: this.game, winner }));
    this.compareResult();
  }

  private compareResult(): void {
    if (this.myResult === null || this.oppResult === null || this.resultTold) return;
    this.resultTold = true;
    this.onResult(this.myResult === this.oppResult);
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

  // ---------------------------------------------------------------- 部屋の中（v2.0-G。UPDATE_v2 §8-2）

  /** まちあいの人に「あそぼう！」を申し込む */
  inviteTo(peerId: string): boolean {
    const target = this.peers.get(peerId);
    if (this.status.kind !== 'waiting' || this.outgoing || this.incoming || this.awaiting || !target || target.state !== 'waiting') return false;
    const id = toHex(this.randomBytes(6));
    this.outgoing = { to: peerId, id, until: this.clock.now() + INVITE_MS };
    this.send(makeMsg('invite', this.opts.protocol, { to: peerId, id }), peerId);
    this.setInvite({ kind: 'sent', to: peerId, name: target.name });
    return true;
  }

  /** 自分の申し込みを取り消す */
  cancelInvite(): void {
    const o = this.outgoing;
    if (!o) return;
    this.outgoing = null;
    this.send(makeMsg('inviteCancel', this.opts.protocol, { to: o.to, id: o.id }), o.to);
    this.setInvite({ kind: 'none' });
  }

  /** 申し込まれた：あそぶ（true）／いまは やめとく（false） */
  answerInvite(accept: boolean): void {
    const i = this.incoming;
    if (!i) return;
    this.incoming = null;
    this.send(makeMsg('inviteReply', this.opts.protocol, { to: i.from, id: i.id, accept }), i.from);
    if (accept) this.awaiting = { from: i.from, id: i.id, until: this.clock.now() + AWAIT_PAIR_MS };
    this.setInvite({ kind: 'none' });
  }

  /** 申し込みの知らせを消す（ことわられた・時間切れ の表示を閉じた） */
  clearInviteNote(): void {
    if (this.invite.kind === 'declined' || this.invite.kind === 'expired') this.setInvite({ kind: 'none' });
  }

  /** 「ほかの ひとと あそぶ」：相手との対戦をやめて、部屋の まちあい に戻る（相手も戻る） */
  backToRoom(): void {
    if (this.opponentPeer) this.send(makeMsg('back', this.opts.protocol, {}), this.opponentPeer);
    this.resetMatch();
    this.setStatus({ kind: 'waiting' });
  }

  /** 部屋に まちあい の人が（相手のほかに）いるか（「ほかの ひとと あそぶ」を出すか） */
  get othersWaiting(): boolean {
    return [...this.peers].some(([id, h]) => id !== this.opponentPeer && h.playerId !== this.opponentPlayerId && h.state === 'waiting');
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
      case 'presence':
        this.gotPresence(m.body, from);
        return;
      case 'specHello':
      case 'specWatch':
      case 'specLeave':
        this.gotSpectator(m, from);
        return;
      case 'specFull':
      case 'specInfo':
      case 'specSync':
      case 'specAction':
        // 観戦者あてのもの（対戦者どうしでは使わない）
        return;
      case 'invite':
      case 'inviteReply':
      case 'inviteCancel':
      case 'pairStart':
        this.gotRoomMsg(m, from);
        return;
      case 'queue':
      case 'pairPropose':
      case 'pairAccept':
      case 'tradeHello':
      case 'tradeOffer':
      case 'tradeLock':
      case 'tradeCommit':
      case 'tradeAck':
      case 'tradeResume':
        // レートの待合所のメッセージ（ここでは使わない）
        return;
    }
    if (!MATCH_TYPES.has(m.t)) return;
    // 相手が出ていった知らせ（peerLeave）の後に、その相手の leave が届くこともある
    if (m.t === 'leave' && from === this.goneOpponent && !this.opponentPeer) {
      this.gotLeave(from);
      return;
    }
    if (from !== this.opponentPeer) {
      // まだ対戦者を決めていない間に届いたもの（相手の方が先に決めた）は、決めてから通す
      if (this.status.kind === 'waiting' && this.peers.has(from) && (m.t === 'deck' || m.t === 'reveal' || m.t === 'action')) {
        const list = this.preMatch.get(from) ?? [];
        list.push(m);
        this.preMatch.set(from, list);
        // 承諾して組み合わせ（pairStart）を待っている相手から deck が届いた：pairStart が届かなくても、その試合で始める
        if (m.t === 'deck' && this.awaiting?.from === from) {
          this.awaiting = null;
          this.startMatchWith(from, m.body.game);
          return;
        }
        this.armPick();
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
        if (m.body.winner) {
          this.oppResult = m.body.winner;
          this.compareResult();
          return;
        }
        if (m.body.mismatch) {
          if (!this.desynced) {
            this.desynced = true;
            this.desyncTurn = m.body.turn;
            this.onDesync(m.body.turn);
          }
          return;
        }
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
      case 'back':
        // 相手が「ほかの ひとと あそぶ」：自分も まちあい に戻る
        this.resetMatch();
        this.setStatus({ kind: 'waiting' });
        this.onOpponentBack();
        return;
      case 'leave':
        this.gotLeave(from);
        return;
    }
  }

  /** 相手が部屋を出た（leave） */
  private gotLeave(from: string): void {
    this.goneOpponent = null;
    if ([...this.peers.keys()].some((id) => id !== from)) {
      // 部屋にほかの人がいる：相手は部屋を出たが、自分は まちあい に戻る（v2.0-G）
      this.peers.delete(from);
      this.resetMatch();
      this.setStatus({ kind: 'waiting' });
      this.onOpponentBack();
      return;
    }
    this.setStatus({ kind: 'aborted', reason: 'left' });
    this.close();
  }

  /** つながりが切れた相手（このあと leave が届いたら、部屋を出たと分かる） */
  private goneOpponent: string | null = null;

  private sendHello(to?: string): void {
    if (this.status.kind === 'idle' || this.status.kind === 'full' || this.status.kind === 'version') return;
    this.send(
      makeMsg('hello', this.opts.protocol, {
        protocol: this.opts.protocol,
        appVersion: this.opts.appVersion,
        name: this.opts.name,
        ticket: this.ticket,
        playerId: this.opts.playerId,
        state: this.myState(),
        deckName: this.opts.deckName ?? '',
        nextGame: this.nextGame,
        ...(this.opts.rate !== undefined ? { rate: this.opts.rate } : {}),
        ...(this.opts.userId ? { userId: this.opts.userId } : {}),
      }),
      to,
    );
  }

  private sendPresence(): void {
    if (this.status.kind === 'idle' || this.status.kind === 'full' || this.status.kind === 'version' || this.status.kind === 'error') return;
    this.send(makeMsg('presence', this.opts.protocol, { state: this.myState(), deckName: this.opts.deckName ?? '', nextGame: this.nextGame }));
  }

  private myState(): MemberState {
    return this.status.kind === 'matched' || this.status.kind === 'playing' ? 'playing' : 'waiting';
  }

  private gotHello(raw: MsgBody['hello'], from: string): void {
    const h = cleanHello(raw);
    if (!h) {
      this.ignored.push(`bad hello from ${from}`);
      return;
    }
    if (h.protocol !== this.opts.protocol) {
      if (this.status.kind !== 'waiting' || this.opponentPlayerId || this.peers.size > 0) {
        // もう対戦者がいる・部屋にほかの人がいる：版の違う人が来ても続ける（その人には満室を返す）
        this.send(makeMsg('full', this.opts.protocol, {}), from);
        return;
      }
      // 両者に「バージョンがちがうよ」を出す（相手にも分かるように、自分の hello も返す）
      this.sendHello(from);
      this.setStatus({ kind: 'version' });
      this.close();
      return;
    }
    // 同じ人が入り直した（ピアIDが変わった）：前の分を消す
    for (const [id, p] of this.peers) if (id !== from && p.playerId === h.playerId) this.peers.delete(id);
    const known = this.peers.has(from);
    this.peers.set(from, h);
    if (!known) {
      this.sendHello(from);
      if (h.playerId !== this.opponentPlayerId) this.onJoinLeave({ kind: 'join', name: h.name });
    }
    this.emitMembers();

    if (this.opponentPlayerId && h.playerId === this.opponentPlayerId) {
      // 再接続（SPEC §11-7）：それまでの操作を全部送り直す
      this.opponentPeer = from;
      this.heard();
      this.resync();
      return;
    }
    // 部屋の人数（v2.0-G）：入室チケットの順で ROOM_MAX 番目より後の人は満室
    if (!this.opponentPlayerId && this.myRank() >= ROOM_MAX) {
      this.setStatus({ kind: 'full' });
      this.close();
      return;
    }
    // すぐには決めず、少し待ってほかの人の hello も集めてから決める
    this.armPick();
  }

  private gotPresence(b: MsgBody['presence'], from: string): void {
    const p = this.peers.get(from);
    if (!p || !b || (b.state !== 'waiting' && b.state !== 'playing')) return;
    p.state = b.state;
    p.deckName = typeof b.deckName === 'string' ? b.deckName.slice(0, 16) : '';
    p.nextGame = Number.isInteger(b.nextGame) && b.nextGame >= 0 ? b.nextGame : 0;
    this.emitMembers();
    this.armPick();
  }

  /** 申し込み・組み合わせ（v2.0-G） */
  private gotRoomMsg(m: Extract<Msg, { t: 'invite' | 'inviteReply' | 'inviteCancel' | 'pairStart' }>, from: string): void {
    const p = this.peers.get(from);
    if (!p) return;
    switch (m.t) {
      case 'invite': {
        if (m.body.to !== this.selfId) return;
        // 申し込みが行き違った（自分も同じ人に申し込んでいる）：ピアIDの小さい方が相手の申し込みを受ける
        if (this.outgoing?.to === from && !this.incoming && !this.awaiting && this.status.kind === 'waiting') {
          if (this.selfId < from) {
            this.outgoing = null;
            this.send(makeMsg('inviteReply', this.opts.protocol, { to: from, id: String(m.body.id), accept: true }), from);
            this.awaiting = { from, id: String(m.body.id), until: this.clock.now() + AWAIT_PAIR_MS };
            this.setInvite({ kind: 'none' });
          }
          return;
        }
        const busy = this.status.kind !== 'waiting' || !!this.outgoing || !!this.incoming || !!this.awaiting;
        if (busy) {
          this.send(makeMsg('inviteReply', this.opts.protocol, { to: from, id: m.body.id, accept: false }), from);
          return;
        }
        this.incoming = { from, id: String(m.body.id), until: this.clock.now() + INVITE_MS };
        this.setInvite({ kind: 'received', from, name: p.name });
        return;
      }
      case 'inviteReply': {
        if (m.body.to !== this.selfId) return;
        const o = this.outgoing;
        if (!o || o.to !== from || o.id !== m.body.id) {
          // もう取り消した申し込みへの「あそぶ」：取り消しを知らせる
          if (m.body.accept) this.send(makeMsg('inviteCancel', this.opts.protocol, { to: from, id: m.body.id }), from);
          return;
        }
        this.outgoing = null;
        if (!m.body.accept || this.status.kind !== 'waiting') {
          if (m.body.accept) this.send(makeMsg('inviteCancel', this.opts.protocol, { to: from, id: m.body.id }), from);
          this.setInvite({ kind: 'declined', name: p.name });
          return;
        }
        // 承諾された：組み合わせを部屋全体に知らせて、対戦を始める
        const game = Math.max(this.nextGame, p.nextGame);
        this.send(makeMsg('pairStart', this.opts.protocol, { a: this.selfId, b: from, pairId: o.id, game }));
        this.setInvite({ kind: 'none' });
        this.startMatchWith(from, game);
        return;
      }
      case 'inviteCancel': {
        if (m.body.to !== this.selfId) return;
        if (this.incoming?.from === from && this.incoming.id === m.body.id) {
          this.incoming = null;
          this.setInvite({ kind: 'expired', name: p.name });
        }
        if (this.awaiting?.from === from && this.awaiting.id === m.body.id) this.awaiting = null;
        return;
      }
      case 'pairStart': {
        const { a, b, pairId, game } = m.body;
        if (a !== from) return;
        // ほかの2人が組んだ：たいせんちゅう にする
        for (const id of [a, b]) {
          const x = this.peers.get(id);
          if (x) x.state = 'playing';
        }
        this.emitMembers();
        if (b === this.selfId && a === from && this.awaiting?.from === from && this.awaiting.id === pairId && this.status.kind === 'waiting' && Number.isInteger(game) && game >= 0) {
          this.awaiting = null;
          this.startMatchWith(from, game);
        }
        return;
      }
    }
  }

  /** 部屋の中で、入室チケットが自分より早い人の数 */
  private myRank(): number {
    let n = 0;
    for (const [id, h] of this.peers) if (byTicket({ ticket: h.ticket, peerId: id }, { ticket: this.ticket, peerId: this.selfId }) < 0) n += 1;
    return n;
  }

  /** 少し待ってから、2人だけの部屋の対戦者を決める */
  private armPick(): void {
    if (this.status.kind === 'waiting' && this.pickAt === 0) this.pickAt = this.clock.now() + PICK_AFTER_MS;
  }

  /**
   * 2人だけの部屋で2人とも まちあい なら、その2人が対戦者（今までどおり。SPEC §11-2）。
   * 3人以上の時は自動で始めない（申し込みで決める。v2.0-G）
   */
  private pickPlayers(): void {
    this.pickAt = 0;
    if (this.status.kind !== 'waiting' || this.outgoing || this.incoming || this.awaiting) return;
    if (this.myRank() >= ROOM_MAX) {
      this.setStatus({ kind: 'full' });
      this.close();
      return;
    }
    if (this.peers.size !== 1) return;
    const [id, info] = [...this.peers][0];
    // 相手の方が先に決めて deck を送ってきた（相手は もう たいせんちゅう）：その試合番号で始める
    const early = (this.preMatch.get(id) ?? []).find((m): m is Extract<Msg, { t: 'deck' }> => m.t === 'deck');
    if (info.state !== 'waiting' && !early) return;
    this.startMatchWith(id, early ? early.body.game : Math.max(this.nextGame, info.nextGame));
  }

  /** この人と対戦を始める（種を決めるところから） */
  private startMatchWith(peerId: string, game: number): void {
    const info = this.peers.get(peerId);
    if (!info) return;
    this.opponentPeer = peerId;
    this.opponentPlayerId = info.playerId;
    this.opponentUserId = info.userId ?? '';
    this.opponentName = info.name;
    this.opponentRate = info.rate;
    info.state = 'playing';
    // 役割はピアIDの文字列比較で小さい方が p1（先攻・後攻とは別）
    this.role = this.selfId < peerId ? 'p1' : 'p2';
    this.heard();
    this.setStatus({ kind: 'matched' });
    this.emitMembers();
    this.onMatched(this.opponentName);
    void this.startNegotiation(game);
    const held = this.preMatch.get(peerId) ?? [];
    this.preMatch.clear();
    for (const m of held) this.receive(m, peerId);
  }

  /** 相手との対戦の情報を消す（部屋には残る） */
  private resetMatch(): void {
    this.preMatch.clear();
    this.negToken += 1;
    this.opponentPeer = null;
    this.opponentPlayerId = null;
    this.opponentUserId = '';
    this.opponentName = '';
    this.neg = null;
    this.myLog = [];
    this.expectedSeq = 1;
    this.buffered.clear();
    this.early.clear();
    this.myHashes.clear();
    this.oppHashes.clear();
    this.myRematch = -1;
    this.oppRematch = -1;
    this.desynced = false;
    this.myResult = null;
    this.oppResult = null;
    this.resultTold = false;
    this.graceUntil = 0;
    if (this.connection !== 'ok') {
      this.connection = 'ok';
      this.onConnection('ok');
    }
  }

  // ---------------------------------------------------------------- コミット・リビール（SPEC §11-4）

  /** 試合の交渉ごとに +1（待っている間に相手との対戦をやめた時、古い交渉を続けないため） */
  private negToken = 0;

  private async startNegotiation(game: number): Promise<void> {
    const token = ++this.negToken;
    this.game = game;
    this.nextGame = game + 1;
    this.myLog = [];
    this.expectedSeq = 1;
    this.buffered.clear();
    this.myHashes.clear();
    this.oppHashes.clear();
    this.desynced = false;
    this.desyncTurn = 0;
    this.myResult = null;
    this.oppResult = null;
    this.resultTold = false;
    const mySeed = this.randomBytes(32);
    const myCommit = toHex(await sha256(mySeed));
    if (token !== this.negToken) return;
    this.neg = { game, mySeed, myCommit, oppDeck: null, oppCommit: null, oppSeed: null, revealed: false, started: false, pendingReveal: null };
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
      const pending = neg.pendingReveal;
      if (pending) {
        neg.pendingReveal = null;
        await this.gotNeg(pending);
        return;
      }
    } else {
      if (!neg.oppCommit) {
        // deck より先に reveal が来た（ふつうは無いが、再接続の時などに起こりうる）→ deck が来てから確かめる
        neg.pendingReveal = m;
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
    if (neg.started || this.neg !== neg) return;
    neg.started = true;
    const opp: Side = this.role === 'p1' ? 'p2' : 'p1';
    const oppId = this.opponentPlayerId ?? '';
    const deckKey = neg.oppDeck.join(',');
    const before = this.lastOppDecks.get(oppId);
    this.lastOppDecks.set(oppId, deckKey);
    this.setStatus({ kind: 'playing' });
    this.onStart({
      game: neg.game,
      seed,
      me: this.role,
      decks: { [this.role]: this.opts.deck, [opp]: neg.oppDeck } as Record<Side, number[]>,
      names: { [this.role]: this.opts.name, [opp]: this.opponentName } as Record<Side, string>,
      oppPlayerId: oppId,
      oppUserId: this.opponentUserId,
      ...(this.opponentRate !== undefined ? { oppRate: this.opponentRate } : {}),
      oppDeckChanged: before !== undefined && before !== deckKey,
    });
    this.lastStart = {
      game: neg.game,
      seed,
      me: this.role,
      decks: { [this.role]: this.opts.deck, [opp]: neg.oppDeck } as Record<Side, number[]>,
      names: { [this.role]: this.opts.name, [opp]: this.opponentName } as Record<Side, string>,
      oppPlayerId: oppId,
      oppUserId: this.opponentUserId,
      oppDeckChanged: false,
    };
    // 観戦者に知らせる（見ている人には、新しい試合の始まりを送る。再戦でも見続けられる）
    this.tellSpectators();
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
    if (a === undefined || b === undefined || a === b || this.desynced) return;
    this.desynced = true;
    this.desyncTurn = turn;
    // 相手にも知らせる（相手の側ではハッシュが合って見えることもあるため）
    this.sendToOpponent(makeMsg('hash', this.opts.protocol, { turn, hash: a, game: this.game, mismatch: true }));
    this.onDesync(turn);
  }

  // ---------------------------------------------------------------- 再接続・再戦

  /** 相手が戻ってきた：交渉中なら deck/reveal を、対戦中なら操作を全部送り直す */
  private resync(): void {
    const neg = this.neg;
    if (!neg) return;
    this.sendToOpponent(makeMsg('deck', this.opts.protocol, { cards: this.opts.deck, commit: neg.myCommit, game: neg.game }));
    if (neg.revealed) this.sendToOpponent(makeMsg('reveal', this.opts.protocol, { seed: toHex(neg.mySeed), game: neg.game }));
    for (const a of this.myLog) this.sendToOpponent(makeMsg('action', this.opts.protocol, a));
    // ターン終わりのハッシュ・ずれの知らせ・決着の結果も（切れている間に消えたかもしれない）
    for (const [turn, hash] of this.myHashes) this.sendToOpponent(makeMsg('hash', this.opts.protocol, { turn, hash, game: this.game }));
    if (this.desynced) this.sendToOpponent(makeMsg('hash', this.opts.protocol, { turn: this.desyncTurn, hash: this.myHashes.get(this.desyncTurn) ?? '', game: this.game, mismatch: true }));
    if (this.myResult) this.sendToOpponent(makeMsg('hash', this.opts.protocol, { turn: 0, hash: 'end', game: this.game, winner: this.myResult }));
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
    const now = this.clock.now();
    if (this.status.kind === 'waiting') {
      this.onWaitingTick(now - this.joinedAt);
      if (this.pickAt !== 0 && now >= this.pickAt) this.pickPlayers();
    }
    // 申し込みの時間切れ（v2.0-G）
    if (this.outgoing && now >= this.outgoing.until) {
      const o = this.outgoing;
      this.outgoing = null;
      this.send(makeMsg('inviteCancel', this.opts.protocol, { to: o.to, id: o.id }), o.to);
      this.setInvite({ kind: 'expired', name: this.peers.get(o.to)?.name ?? '' });
      this.armPick();
    }
    if (this.incoming && now >= this.incoming.until) {
      const i = this.incoming;
      this.incoming = null;
      this.send(makeMsg('inviteReply', this.opts.protocol, { to: i.from, id: i.id, accept: false }), i.from);
      this.setInvite({ kind: 'none' });
      this.armPick();
    }
    if (this.awaiting && now >= this.awaiting.until) {
      this.awaiting = null;
      this.armPick();
    }
    if (!this.opponentPeer && !this.opponentPlayerId) return;
    if (this.opponentPeer && now - this.lastPing >= PING_EVERY_MS) {
      this.lastPing = now;
      this.send(makeMsg('ping', this.opts.protocol, { t: now, n: this.myLog.length, game: this.game }), this.opponentPeer);
    }
    const since = now - this.lastHeard;
    const lost = since >= LOST_AFTER_MS && now >= this.graceUntil;
    const next: Connection = lost ? 'lost' : since >= WAITING_AFTER_MS ? 'waiting' : 'ok';
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
    this.graceUntil = this.clock.now() + LOST_AFTER_MS;
    this.connection = 'waiting';
    this.onConnection('waiting');
  }

  /** 相手の名前 */
  get opponent(): string {
    return this.opponentName;
  }

  private peerLeft(id: string): void {
    if (this.spectators.delete(id)) {
      this.onSpectators(this.spectatorCount);
      return;
    }
    const p = this.peers.get(id);
    this.peers.delete(id);
    if (p && p.playerId !== this.opponentPlayerId) this.onJoinLeave({ kind: 'leave', name: p.name });
    // 申し込みの相手が出ていった
    if (this.outgoing?.to === id) {
      this.outgoing = null;
      this.setInvite({ kind: 'expired', name: p?.name ?? '' });
    }
    if (this.incoming?.from === id) {
      this.incoming = null;
      this.setInvite({ kind: 'none' });
    }
    if (this.awaiting?.from === id) this.awaiting = null;
    this.emitMembers();
    if (id === this.opponentPeer) {
      this.goneOpponent = id;
      this.opponentPeer = null;
      if (this.connection === 'ok') {
        this.connection = 'waiting';
        this.onConnection('waiting');
      }
    } else this.armPick();
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
    const before = this.myState();
    this.status = s;
    this.onStatus(s);
    // 部屋の人に、自分の状態（まちあい／たいせんちゅう）を知らせる
    if (this.myState() !== before) {
      this.sendPresence();
      // 対戦が終わった（まちあいに戻った）：観戦者にも知らせ、見ていた試合は終わり
      if (this.myState() === 'waiting') {
        this.lastStart = null;
        for (const sp of this.spectators.values()) sp.watching = false;
        this.onSpectators(0);
        this.tellSpectators();
      }
    }
    if (s.kind === 'waiting') this.armPick();
    this.emitMembers();
  }

  private setInvite(s: InviteState): void {
    this.invite = s;
    this.onInvite(s);
  }

  private emitMembers(): void {
    this.onMembers(this.members);
  }

  // ---------------------------------------------------------------- 観戦（v2.0-J。SPEC §11-10）

  private gotSpectator(m: Extract<Msg, { t: 'specHello' | 'specWatch' | 'specLeave' }>, from: string): void {
    if (this.peers.has(from)) return; // 部屋の人は観戦者になれない
    switch (m.t) {
      case 'specHello': {
        if (m.body?.protocol !== this.opts.protocol) return;
        if (!this.spectators.has(from) && this.spectators.size >= SPECTATOR_MAX) {
          this.send(makeMsg('specFull', this.opts.protocol, {}), from);
          return;
        }
        if (!this.spectators.has(from)) this.spectators.set(from, { watching: false });
        this.send(this.specInfoMsg(), from);
        return;
      }
      case 'specWatch': {
        const sp = this.spectators.get(from);
        if (!sp) return;
        const start = this.lastStart;
        if (!start || m.body?.game !== start.game) return;
        sp.watching = true;
        this.send(this.specSyncMsg(start), from);
        this.onSpectators(this.spectatorCount);
        return;
      }
      case 'specLeave':
        if (this.spectators.delete(from)) this.onSpectators(this.spectatorCount);
        return;
    }
  }

  private specInfoMsg(): Msg {
    const s = this.lastStart;
    const playing = !!s && this.myState() === 'playing';
    return makeMsg('specInfo', this.opts.protocol, {
      state: playing ? 'playing' : 'waiting',
      name: this.opts.name,
      game: playing ? s.game : -1,
      oppPeer: playing ? (this.opponentPeer ?? '') : '',
      ...(playing ? { names: s.names, role: s.me } : {}),
    });
  }

  private specSyncMsg(s: GameStart): Msg {
    return makeMsg('specSync', this.opts.protocol, {
      game: s.game,
      seed: s.seed,
      decks: s.decks,
      names: s.names,
      side: s.me,
      log: this.myLog.filter((a) => a.game === s.game).map((a) => a.action),
    });
  }

  /** 観戦者みんなに今の様子を知らせ、見ている人には試合の始まりと記録を送る */
  private tellSpectators(): void {
    if (!this.spectators.size) return;
    const info = this.specInfoMsg();
    for (const [peer, sp] of this.spectators) {
      this.send(info, peer);
      if (sp.watching && this.lastStart) this.send(this.specSyncMsg(this.lastStart), peer);
    }
    this.onSpectators(this.spectatorCount);
  }

  private close(): void {
    this.stopTimer?.();
    this.stopTimer = null;
    this.transport.leave();
  }
}

/** 入室チケットの順（同じ時刻ならランダムな数、それも同じならピアIDの順） */
function byTicket(a: { ticket: Ticket; peerId: string }, b: { ticket: Ticket; peerId: string }): number {
  return a.ticket.time - b.ticket.time || a.ticket.rand - b.ticket.rand || (a.peerId < b.peerId ? -1 : a.peerId > b.peerId ? 1 : 0);
}

/** 名前の長さ（SPEC §7 S06：8文字まで） */
const NAME_MAX = 8;

/** 受け取った hello の中身を確かめる（壊れたデータで画面が落ちたり、対戦者の選び方が食い違ったりしないように） */
function cleanHello(h: MsgBody['hello']): PeerInfo | null {
  if (!h || typeof h !== 'object') return null;
  const t = h.ticket as Partial<Ticket> | undefined;
  if (typeof h.protocol !== 'number' || typeof h.playerId !== 'string' || !t || !Number.isFinite(t.time) || !Number.isFinite(t.rand)) return null;
  const name = typeof h.name === 'string' && h.name.trim() !== '' ? [...h.name].slice(0, NAME_MAX).join('') : '？';
  return {
    protocol: h.protocol,
    appVersion: String(h.appVersion ?? ''),
    name,
    ticket: { time: Number(t.time), rand: Number(t.rand) },
    playerId: h.playerId.slice(0, 64),
    state: h.state === 'playing' ? 'playing' : 'waiting',
    deckName: typeof h.deckName === 'string' ? h.deckName.slice(0, 16) : '',
    ...(typeof h.userId === 'string' && /^[1-9][0-9]{14}$/.test(h.userId) ? { userId: h.userId } : {}),
    nextGame: Number.isInteger(h.nextGame) && (h.nextGame as number) >= 0 ? (h.nextGame as number) : 0,
    ...(typeof h.rate === 'number' && Number.isFinite(h.rate) ? { rate: Math.max(0, Math.round(h.rate)) } : {}),
  };
}
