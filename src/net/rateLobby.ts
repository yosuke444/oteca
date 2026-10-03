import { type Msg, type MsgBody, type Ticket, makeMsg, rateLobbyName } from './protocol';
import { toHex } from './sha256';
import type { Clock } from './session';
import type { NetTransport } from './transport';

/**
 * レート対戦の待合所（UPDATE_v2 §8-4・SPEC §7 S15）
 * 共通の部屋 oteca-rate-p<版数> で待っている人を集め、全員が同じ待ち行列から同じ組み合わせを計算する。
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
  /** 直前のレート対戦の相手（'' ＝なし） */
  lastOpponentId: string;
  protocol: number;
  clock?: Clock;
  randomBytes?: (n: number) => Uint8Array;
};

export type RatePaired = { roomId: string; opponentName: string; opponentId: string; opponentRate: number };

type Entry = { peerId: string; playerId: string; ticket: Ticket; lastOpponentId: string; name: string; rate: number; heard: number };

/** 待っている知らせを送る間隔 */
export const QUEUE_EVERY_MS = 2000;
/** この間 知らせが来なければ、もう待っていないとみなす */
export const QUEUE_STALE_MS = 7000;
/** 申し込みの返事を待つ時間 */
export const PROPOSE_MS = 4000;
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
    this.transport.join(rateLobbyName(this.opts.protocol));
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
        // 待っている時だけ、最初に来た申し込みを受ける（直前の相手からの申し込みは受けない）
        const ok = this.state === 'queue' && !!e && /^[0-9a-f]{8,32}$/.test(roomId) && !this.isLastOpponent(e);
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
    this.onPaired({ roomId, opponentName: e.name, opponentId: e.playerId, opponentRate: e.rate });
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
   * 直前の相手でなければ組む。自分の相手と、自分の方が早いか
   */
  private partner(now: number): { peerId: string; iAmFirst: boolean } | null {
    type Q = { peerId: string; playerId: string; ticket: Ticket; lastOpponentId: string };
    const me: Q = { peerId: this.selfId, playerId: this.opts.playerId, ticket: this.ticket, lastOpponentId: this.opts.lastOpponentId };
    const list: Q[] = [me, ...this.entries.values()].sort((a, b) => a.ticket.time - b.ticket.time || a.ticket.rand - b.ticket.rand || (a.peerId < b.peerId ? -1 : 1));
    const used = new Set<string>();
    for (let i = 0; i < list.length; i++) {
      const x = list[i];
      if (used.has(x.peerId)) continue;
      for (let j = i + 1; j < list.length; j++) {
        const y = list[j];
        if (used.has(y.peerId)) continue;
        if (x.playerId === y.playerId || x.playerId === y.lastOpponentId || y.playerId === x.lastOpponentId) continue;
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
    this.send(makeMsg('queue', this.opts.protocol, { playerId: this.opts.playerId, ticket: this.ticket, lastOpponentId: this.opts.lastOpponentId, name: this.opts.name, rate: this.opts.rate }), to);
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
  };
}
