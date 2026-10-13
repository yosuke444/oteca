import { type Msg, type MsgBody, RATE_SUBROOMS, type Ticket, makeMsg, rateLobbyName } from './protocol';
import { toHex } from './sha256';
import type { Clock } from './session';
import type { NetTransport } from './transport';
import type { PlayerBadge } from '../ui/common/trophyBadge';

/**
 * レート対戦の予備の待合所（UPDATE_v2 §8-4・SPEC §7 S15。v2.0-I からは受付係につながらない時だけ使う）
 * 小部屋 oteca-rate-p<版数>-<0〜7> で待っている人を集め、全員が同じ待ち行列から同じ組み合わせを計算する。
 * - 入る小部屋はランダム。10秒、組める人がだれもいなければ、ほかの小部屋へ移る（今の10秒の区切りで決まる小部屋。同じころに移る人が集まる）。
 * - レートは組み合わせに使わない。待ち始めた順（入室チケット）に組む。
 * - 直前に対戦した人とは組まない（プレイヤーID で判別）。
 * - 組み合わせの早い方が申し込み（pairPropose）→ 相手が承諾（pairAccept）を1往復はさんで、取り合いを防ぐ。
 * - 組んだ2人は待合所を出て、2人だけの部屋（oteca-rate-<部屋ID>）へ移る（移った先は OnlineSession）。
 * 画面（React）には依存しない。テストでは MemoryHub の通信で動かす。
 */

export type RateLobbyOptions = {
  playerId: string;
  name: string;
  rate: number;
  /** トロフィあげの数（v2.2。予備の待合所では自分で知らせる。書かなければ 0） */
  trophies?: number;
  /** 直前のレート対戦の相手（'' ＝なし） */
  lastOpponentId: string;
  protocol: number;
  /** 小部屋の数（テストで 1 にすると、今までの1つの部屋と同じ） */
  rooms?: number;
  clock?: Clock;
  randomBytes?: (n: number) => Uint8Array;
};

/**
 * 相手が決まった。matchId は結果の報告に使う試合ID（受付係が組んだ時は受付係の試合ID、予備の待合所では部屋ID）。
 * viaLobby：受付係が組んだ（false は予備の待合所）。
 * me・opponentTrophies（v2.2）：VS 画面と対戦中の名前の欄に出す、両者のレートとトロフィあげの数
 * （受付係が組んだ時はサーバーの記録、予備の待合所では端末が知らせたもの）
 */
export type RatePaired = { roomId: string; matchId: string; viaLobby: boolean; opponentName: string; opponentId: string; opponentRate: number; opponentTrophies: number; me: PlayerBadge };

type Entry = { peerId: string; playerId: string; ticket: Ticket; lastOpponentId: string; name: string; rate: number; trophies: number; heard: number };

/** 待っている知らせを送る間隔 */
export const QUEUE_EVERY_MS = 2000;
/** この間 知らせが来なければ、もう待っていないとみなす */
export const QUEUE_STALE_MS = 7000;
/** 申し込みの返事を待つ時間 */
export const PROPOSE_MS = 4000;
/** この間、組める人がだれもいなければ、ほかの小部屋へ移る */
export const SUBROOM_HOP_MS = 10000;
/** ことわられた組み合わせを、しばらく試さない時間 */
const REJECT_COOLDOWN_MS = 3000;
const TICK_MS = 250;

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

export class RateLobby {
  /** 待っている人数（自分もふくむ）が変わった */
  onWaiting: (count: number) => void = () => {};
  /** 相手が決まった（このあと待合所を出て、2人だけの部屋へ） */
  onPaired: (p: RatePaired) => void = () => {};

  private readonly clock: Clock;
  private readonly randomBytes: (n: number) => Uint8Array;
  private ticket: Ticket = { time: 0, rand: 0 };
  private readonly entries = new Map<string, Entry>();
  private state: 'idle' | 'queue' | 'proposing' | 'paired' = 'idle';
  /** 申し込み中（相手の情報は申し込んだ時に写しておく：承諾した相手はすぐ待合所を出るので） */
  private proposal: { to: string; roomId: string; until: number; entry: Entry } | null = null;
  private readonly rejected = new Map<string, number>();
  private stopTimer: (() => void) | null = null;
  private lastQueue = 0;
  private lastCount = -1;
  /** 今いる小部屋 */
  private room = 0;
  /** 最後に組める人がいた時刻（小部屋に入った時刻から数える） */
  private lastUseful = 0;

  constructor(
    private readonly transport: NetTransport,
    private readonly opts: RateLobbyOptions,
  ) {
    this.clock = opts.clock ?? realClock;
    this.randomBytes = opts.randomBytes ?? realRandom;
    transport.onMessage = (m, from) => this.receive(m, from);
    transport.onPeerJoin = (id) => this.sendQueue(id);
    transport.onPeerLeave = (id) => {
      this.entries.delete(id);
      this.emitCount();
    };
    transport.onError = () => {};
  }

  get selfId(): string {
    return this.transport.selfId;
  }

  /** 待合所に入る（「さがす」） */
  join(): void {
    const r = this.randomBytes(4);
    this.ticket = { time: this.clock.now(), rand: ((r[0] << 24) | (r[1] << 16) | (r[2] << 8) | r[3]) >>> 0 };
    this.state = 'queue';
    this.room = this.pickRoom(-1);
    this.transport.join(rateLobbyName(this.opts.protocol, this.room));
    this.lastUseful = this.clock.now();
    this.lastQueue = 0;
    this.stopTimer = this.clock.every(TICK_MS, () => this.tick());
    this.emitCount();
  }

  /** 待合所を出る（「やめる」・相手が決まった後） */
  leave(): void {
    this.state = 'idle';
    this.stopTimer?.();
    this.stopTimer = null;
    this.transport.leave();
  }

  /** 今いる小部屋の番号 */
  get currentRoom(): number {
    return this.room;
  }

  private get roomCount(): number {
    return Math.max(1, Math.floor(this.opts.rooms ?? RATE_SUBROOMS));
  }

  /**
   * 小部屋を選ぶ。最初はランダム。移る時は「今の10秒の区切り」で決まる小部屋（今と同じなら次）。
   * 同じころに移る人どうしが同じ小部屋に集まるので、早く出会える
   */
  private pickRoom(except: number): number {
    const n = this.roomCount;
    if (n === 1) return 0;
    if (except < 0) return this.randomBytes(1)[0] % n;
    // 5 と 8 は互いに素なので、区切りごとに8つの小部屋を順に回る
    const slot = Math.floor(this.clock.now() / SUBROOM_HOP_MS);
    const room = (slot * 5) % n;
    return room === except ? (room + 1) % n : room;
  }

  /** ほかの小部屋へ移る */
  private hop(now: number): void {
    this.transport.leave();
    this.entries.clear();
    this.rejected.clear();
    this.room = this.pickRoom(this.room);
    this.transport.join(rateLobbyName(this.opts.protocol, this.room));
    this.lastUseful = now;
    this.lastQueue = 0;
    this.emitCount();
  }

  /** 待っている人数（自分もふくむ） */
  get waiting(): number {
    return this.entries.size + (this.state === 'idle' ? 0 : 1);
  }

  private receive(m: Msg, from: string): void {
    if (this.state === 'idle' || this.state === 'paired') return;
    switch (m.t) {
      case 'queue': {
        const e = cleanQueue(m.body);
        if (!e) return;
        // 自分と同じユーザーID の人（同じデータの別の端末・タブ）は一覧に入れない（人数にも数えない。組まない。v2.2）
        if (e.playerId === this.opts.playerId) return;
        // 同じ人が入り直した（ピアIDが変わった）：前の分を消す
        for (const [id, x] of this.entries) if (id !== from && x.playerId === e.playerId) this.entries.delete(id);
        this.entries.set(from, { ...e, peerId: from, heard: this.clock.now() });
        this.emitCount();
        return;
      }
      case 'pairPropose': {
        if (m.body.to !== this.selfId) return;
        const e = this.entries.get(from);
        const roomId = String(m.body.roomId ?? '');
        // 待っている時だけ、最初に来た申し込みを受ける（直前の相手からの申し込みは受けない。ただし待っているのが2人だけなら受ける。v2.7）
        const ok = this.state === 'queue' && !!e && /^[0-9a-f]{8,32}$/.test(roomId) && (this.entries.size === 1 || !this.isLastOpponent(e));
        this.send(makeMsg('pairAccept', this.opts.protocol, { to: from, roomId, accept: ok }), from);
        if (ok && e) this.paired(roomId, e);
        return;
      }
      case 'pairAccept': {
        const p = this.proposal;
        if (m.body.to !== this.selfId || !p || p.to !== from || p.roomId !== m.body.roomId) return;
        this.proposal = null;
        if (m.body.accept) {
          this.paired(p.roomId, p.entry);
          return;
        }
        this.state = 'queue';
        this.rejected.set(from, this.clock.now() + REJECT_COOLDOWN_MS);
        return;
      }
    }
  }

  /** 組めない相手：直前の相手（どちらかが覚えていれば）・同じセーブの別のタブ */
  private isLastOpponent(e: Pick<Entry, 'playerId' | 'lastOpponentId'>): boolean {
    return e.playerId === this.opts.playerId || e.playerId === this.opts.lastOpponentId || e.lastOpponentId === this.opts.playerId;
  }

  private paired(roomId: string, e: Entry): void {
    this.state = 'paired';
    // 予備の待合所で組んだ試合は、受付係の試合ID が無いので、部屋ID を試合ID にする（2人とも同じ）
    this.onPaired({ roomId, matchId: roomId, viaLobby: false, opponentName: e.name, opponentId: e.playerId, opponentRate: e.rate, opponentTrophies: e.trophies, me: { rate: this.opts.rate, trophies: this.opts.trophies ?? 0 } });
  }

  private tick(): void {
    const now = this.clock.now();
    if (this.state === 'idle' || this.state === 'paired') return;
    if (now - this.lastQueue >= QUEUE_EVERY_MS) this.sendQueue();
    for (const [id, e] of this.entries) if (now - e.heard > QUEUE_STALE_MS) this.entries.delete(id);
    this.emitCount();
    if (this.state === 'proposing' && this.proposal && now >= this.proposal.until) {
      this.rejected.set(this.proposal.to, now + REJECT_COOLDOWN_MS);
      this.proposal = null;
      this.state = 'queue';
    }
    if (this.state !== 'queue') return;
    // 組める人がいるか（直前の相手・同じセーブだけなら、いないのと同じ。ただし待っているのが自分と1人だけなら、直前の相手とも組む。v2.7）
    const onlyTwo = this.entries.size === 1;
    for (const e of this.entries.values()) if (onlyTwo || !this.isLastOpponent(e)) this.lastUseful = now;
    if (this.roomCount > 1 && now - this.lastUseful >= SUBROOM_HOP_MS) {
      this.hop(now);
      return;
    }
    const partner = this.partner(now);
    const entry = partner ? this.entries.get(partner.peerId) : undefined;
    if (!partner || !partner.iAmFirst || !entry) return;
    // 組み合わせの早い方が申し込む
    const roomId = toHex(this.randomBytes(8));
    this.proposal = { to: partner.peerId, roomId, until: now + PROPOSE_MS, entry: { ...entry } };
    this.state = 'proposing';
    this.send(makeMsg('pairPropose', this.opts.protocol, { to: partner.peerId, roomId }), partner.peerId);
  }

  /**
   * 待ち行列から組み合わせを作る（全員が同じ計算をする）：待ち始めた順に、まだ組んでいない人どうしを、
   * 直前の相手でなければ組む（待っているのが2人だけなら、直前の相手どうしでも組む。v2.7）。自分の相手と、自分の方が早いか
   */
  private partner(now: number): { peerId: string; iAmFirst: boolean } | null {
    type Q = { peerId: string; playerId: string; ticket: Ticket; lastOpponentId: string };
    const me: Q = { peerId: this.selfId, playerId: this.opts.playerId, ticket: this.ticket, lastOpponentId: this.opts.lastOpponentId };
    const list: Q[] = [me, ...this.entries.values()].sort((a, b) => a.ticket.time - b.ticket.time || a.ticket.rand - b.ticket.rand || (a.peerId < b.peerId ? -1 : 1));
    const onlyTwo = list.length === 2;
    const used = new Set<string>();
    for (let i = 0; i < list.length; i++) {
      const x = list[i];
      if (used.has(x.peerId)) continue;
      for (let j = i + 1; j < list.length; j++) {
        const y = list[j];
        if (used.has(y.peerId)) continue;
        if (x.playerId === y.playerId || (!onlyTwo && (x.playerId === y.lastOpponentId || y.playerId === x.lastOpponentId))) continue;
        // 自分がことわられたばかりの相手は、しばらく試さない（自分の計算だけ。ほかの人の組み合わせには影響しない）
        if ((x === me && (this.rejected.get(y.peerId) ?? 0) > now) || (y === me && (this.rejected.get(x.peerId) ?? 0) > now)) continue;
        used.add(x.peerId);
        used.add(y.peerId);
        if (x === me) return { peerId: y.peerId, iAmFirst: true };
        if (y === me) return { peerId: x.peerId, iAmFirst: false };
        break;
      }
    }
    return null;
  }

  private sendQueue(to?: string): void {
    if (this.state === 'idle' || this.state === 'paired') return;
    this.lastQueue = this.clock.now();
    this.send(makeMsg('queue', this.opts.protocol, { playerId: this.opts.playerId, ticket: this.ticket, lastOpponentId: this.opts.lastOpponentId, name: this.opts.name, rate: this.opts.rate, trophies: this.opts.trophies ?? 0 }), to);
  }

  private send(m: Msg, to?: string): void {
    this.transport.send(m, to);
  }

  private emitCount(): void {
    const n = this.waiting;
    if (n === this.lastCount) return;
    this.lastCount = n;
    this.onWaiting(n);
  }
}

/** 受け取った待合所の知らせを確かめる */
function cleanQueue(b: MsgBody['queue']): Omit<Entry, 'peerId' | 'heard'> | null {
  if (!b || typeof b !== 'object' || typeof b.playerId !== 'string') return null;
  const t = b.ticket as Partial<Ticket> | undefined;
  if (!t || !Number.isFinite(t.time) || !Number.isFinite(t.rand)) return null;
  const name = typeof b.name === 'string' && b.name.trim() !== '' ? [...b.name].slice(0, 8).join('') : '？';
  return {
    playerId: b.playerId.slice(0, 64),
    ticket: { time: Number(t.time), rand: Number(t.rand) },
    lastOpponentId: typeof b.lastOpponentId === 'string' ? b.lastOpponentId.slice(0, 64) : '',
    name,
    rate: Number.isFinite(b.rate) ? Math.max(0, Math.round(b.rate)) : 100,
    trophies: Number.isSafeInteger(b.trophies) ? Math.max(0, Math.min(9999, b.trophies as number)) : 0,
  };
}
