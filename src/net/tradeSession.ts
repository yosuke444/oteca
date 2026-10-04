import { type Offer, TRADE_DONE_KEEP, canonical, cleanOffer, tradeKey } from '../trade/trade';
import { type Msg, type MsgBody, type Ticket, makeMsg, tradeRoomName } from './protocol';
import type { Clock } from './session';
import type { NetTransport } from './transport';

/**
 * カードトレードの通信（UPDATE_v2 §9-4・SPEC §7 S16・§11）
 * 部屋 oteca-trade-<番号> で、入室チケットの早い2人が相手（3人目は まんいん）。
 * 送るのは「選んだ内容（offer）」「ロック（lock）」「最終確認（commit）」「受け取りの確認（ack）」だけ。
 * 交換を行う条件：自分の commit を送った ＆ 相手の commit を受け取った ＆ 両者の内容のハッシュが、いまの両者の内容と一致する。
 * 交換の保存（カードの増減と交換IDの記録）は画面がする（onExecute）。同じ交換IDは二度処理しない。
 * 最終確認のあと保存の前にページが閉じられた時のために、commit を送る前に「とちゅうの交換」を画面に覚えてもらい（onPending）、
 * 次に同じ相手と部屋に入った時に、相手がその交換を済ませていれば仕上げる・どちらも済ませていなければ取り消す（resume）。
 */

/** self：相手が同じセーブ（同じ playerId。引き継ぎコードで2台にした・2つのタブ）なので交換できない */
export type TradeStatus = 'idle' | 'waiting' | 'trading' | 'full' | 'version' | 'left' | 'error' | 'self';

/** とちゅうの交換（commit を送ったが、まだ保存していない） */
export type PendingTrade = { tradeId: string; give: Offer; get: Offer; oppPlayerId: string; room: string };

export type TradeView = {
  status: TradeStatus;
  oppName: string;
  /** 相手のプレイヤーID（とちゅうの交換が別の相手のものか見るため） */
  oppPlayerId: string;
  /** 相手のユーザーID（v2.0-J。停止中か確かめる。古い版の相手は ''） */
  oppUserId: string;
  myOffer: Offer;
  oppOffer: Offer;
  /** 自分・相手が「これで OK」（いまの内容に対して） */
  myLock: boolean;
  oppLock: boolean;
  /** 自分・相手が最終確認で「こうかんする」を押した */
  myCommit: boolean;
  oppCommit: boolean;
};

export type TradeOptions = {
  name: string;
  playerId: string;
  /** 自分のユーザーID（v2.0-J。相手が停止中か確かめるために送る） */
  userId?: string;
  protocol: number;
  appVersion: string;
  /** 処理済みの交換ID（セーブの trade.doneIds） */
  doneIds: () => string[];
  /** とちゅうの交換（この部屋に入る前から覚えているもの） */
  pending: () => PendingTrade | null;
  /** いまの所持数で、この内容を出せるか（「これで OK」と最終確認の前に確かめる） */
  canGive?: (offer: Offer) => boolean;
  clock?: Clock;
  randomBytes?: (n: number) => Uint8Array;
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

/** 最初に誰かを見つけてから相手を決めるまで（ほぼ同時に入った人を集める） */
export const TRADE_PICK_MS = 1000;
const TICK_MS = 250;

/** 文字のハッシュ（16桁の16進数。FNV-1a を2通り。比べるためだけに使う） */
export function textHash(s: string): string {
  let a = 0x811c9dc5;
  let b = 0x01000193 ^ s.length;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193) >>> 0;
    b = Math.imul(b ^ c ^ (i & 0xff), 0x01000193) >>> 0;
  }
  return a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0');
}

export class TradeSession {
  onChange: (v: TradeView) => void = () => {};
  /** 交換が成立した：画面がセーブに書く（同じ交換IDなら何もしない） */
  onExecute: (t: { tradeId: string; give: Offer; get: Offer }) => void = () => {};
  /** commit を送る前：とちゅうの交換を覚えておいてもらう（null で消す） */
  onPending: (p: PendingTrade | null) => void = () => {};
  /** 前の とちゅうの交換：相手が済ませていたので仕上げる（apply）／どちらも済ませていなかったので取り消す（drop） */
  onResume: (decision: 'apply' | 'drop', p: PendingTrade) => void = () => {};
  /** 相手が出ていった（画面に「あいては でていったよ」） */
  onLeft: () => void = () => {};

  private readonly clock: Clock;
  private readonly randomBytes: (n: number) => Uint8Array;
  private ticket: Ticket = { time: 0, rand: 0 };
  private room = '';
  private status: TradeStatus = 'idle';
  private readonly peers = new Map<string, MsgBody['tradeHello']>();
  private opp: string | null = null;
  private oppInfo: MsgBody['tradeHello'] | null = null;
  private pickAt = 0;
  private stopTimer: (() => void) | null = null;
  private myOffer: Offer = {};
  private oppOffer: Offer = {};
  private myLock: string | null = null;
  private oppLock: string | null = null;
  private myCommit: { hash: string; tradeId: string } | null = null;
  private oppCommit: { hash: string; tradeId: string } | null = null;
  /** この部屋で成立した交換の数（交換IDを毎回変えるため） */
  private count = 0;
  readonly ignored: string[] = [];

  constructor(
    private readonly transport: NetTransport,
    private readonly opts: TradeOptions,
  ) {
    this.clock = opts.clock ?? realClock;
    this.randomBytes = opts.randomBytes ?? realRandom;
    transport.onMessage = (m, from) => this.receive(m, from);
    transport.onPeerJoin = (id) => this.sendHello(id);
    transport.onPeerLeave = (id) => {
      this.peers.delete(id);
      if (id === this.opp) this.oppGone();
    };
    transport.onError = (reason) => {
      if (this.status === 'waiting' && this.peers.size === 0) {
        this.ignored.push(reason);
        this.setStatus('error');
      }
    };
  }

  get selfId(): string {
    return this.transport.selfId;
  }

  get view(): TradeView {
    const hash = this.hash();
    return {
      status: this.status,
      oppName: this.oppInfo?.name ?? '',
      oppUserId: this.oppInfo?.userId ?? '',
      oppPlayerId: this.oppInfo?.playerId ?? '',
      myOffer: { ...this.myOffer },
      oppOffer: { ...this.oppOffer },
      myLock: this.myLock === hash,
      oppLock: this.oppLock === hash,
      myCommit: this.myCommit?.hash === hash,
      oppCommit: this.oppCommit?.hash === hash,
    };
  }

  /** 部屋に入る（部屋番号 4〜8桁。対戦とは別の名前の部屋） */
  join(roomNumber: string): void {
    const r = this.randomBytes(4);
    this.ticket = { time: this.clock.now(), rand: ((r[0] << 24) | (r[1] << 16) | (r[2] << 8) | r[3]) >>> 0 };
    this.room = roomNumber;
    this.setStatus('waiting');
    this.transport.join(tradeRoomName(roomNumber));
    this.stopTimer = this.clock.every(TICK_MS, () => this.tick());
  }

  leave(): void {
    if (this.opp) this.send(makeMsg('leave', this.opts.protocol, {}), this.opp);
    this.close();
  }

  /** あげるカードを変える（両者のロック・最終確認が外れる） */
  setOffer(o: Offer): void {
    if (this.status !== 'trading' || this.myCommit) return;
    this.myOffer = Object.fromEntries(canonical(o));
    this.clearAgreement();
    this.send(makeMsg('tradeOffer', this.opts.protocol, { offer: this.myOffer }), this.opp ?? undefined);
    this.emit();
  }

  /** 「これで OK」／取り消し */
  setLock(on: boolean): boolean {
    if (this.status !== 'trading' || this.myCommit) return false;
    // どちらも何も出していない・自分の所持数が足りない時は OK にできない
    if (on && (canonical(this.myOffer).length + canonical(this.oppOffer).length === 0 || !(this.opts.canGive?.(this.myOffer) ?? true))) return false;
    this.myLock = on ? this.hash() : null;
    this.send(makeMsg('tradeLock', this.opts.protocol, { hash: this.myLock ?? '' }), this.opp ?? undefined);
    this.emit();
    return true;
  }

  /** 最終確認で「こうかんする」（両者がロックしている時だけ） */
  commit(): boolean {
    const hash = this.hash();
    if (this.status !== 'trading' || !this.oppInfo || this.myLock !== hash || this.oppLock !== hash || this.myCommit) return false;
    // 最終確認の時にも所持数を確かめる（ロックの後に別のタブなどで減っていたら、交換しない）
    if (!(this.opts.canGive?.(this.myOffer) ?? true)) return false;
    const tradeId = this.tradeId(hash);
    // 送る前に「とちゅうの交換」を覚えてもらう（保存の前にページが閉じられても、次に仕上げ・取り消しができるように）
    this.onPending({ tradeId, give: { ...this.myOffer }, get: { ...this.oppOffer }, oppPlayerId: this.oppInfo.playerId, room: this.room });
    this.myCommit = { hash, tradeId };
    this.send(makeMsg('tradeCommit', this.opts.protocol, { hash, tradeId }), this.opp ?? undefined);
    this.emit();
    this.maybeExecute();
    return true;
  }

  /** 交換ID：両者の内容のハッシュ・2人の入室チケット・この部屋で何回目か から作る（2人で同じになる） */
  private tradeId(hash: string): string {
    const t = [this.ticket, this.oppInfo?.ticket ?? { time: 0, rand: 0 }].map((x) => `${x.time}.${x.rand}`).sort();
    return textHash(`${hash}|${t.join('|')}|${this.count}`);
  }

  private hash(): string {
    if (!this.oppInfo) return '';
    return textHash(tradeKey({ playerId: this.opts.playerId, offer: this.myOffer }, { playerId: this.oppInfo.playerId, offer: this.oppOffer }));
  }

  private clearAgreement(): void {
    this.myLock = null;
    this.oppLock = null;
    this.myCommit = null;
    this.oppCommit = null;
  }

  // ---------------------------------------------------------------- 受け取り

  private receive(m: Msg, from: string): void {
    switch (m.t) {
      case 'tradeHello':
        this.gotHello(m.body, from);
        return;
      case 'full':
        if (this.status === 'waiting') {
          this.setStatus('full');
          this.close();
        }
        return;
    }
    if (from !== this.opp) {
      this.ignored.push(`${m.t} from ${from}`);
      return;
    }
    switch (m.t) {
      case 'tradeOffer': {
        const o = cleanOffer(m.body.offer);
        if (!o) {
          this.ignored.push('bad offer');
          return;
        }
        this.oppOffer = o;
        // どちらかが内容を変えたら、両者のロックが外れる（§9-1）。
        // 自分の最終確認も外れるので、とちゅうの交換の記録も消す（相手は内容を変えたので、まだ交換していない）
        if (this.myCommit) this.onPending(null);
        this.clearAgreement();
        this.emit();
        return;
      }
      case 'tradeLock':
        this.oppLock = typeof m.body.hash === 'string' && m.body.hash ? m.body.hash : null;
        this.emit();
        return;
      case 'tradeCommit':
        if (typeof m.body.hash !== 'string' || typeof m.body.tradeId !== 'string') return;
        this.oppCommit = { hash: m.body.hash, tradeId: m.body.tradeId };
        this.emit();
        this.maybeExecute();
        return;
      case 'tradeAck':
        return;
      case 'tradeResume':
        return;
      case 'leave':
        this.peers.delete(from);
        this.oppGone();
        return;
    }
  }

  /** 相手が出ていった：内容を空にして、また相手を待つ（同じ人が入り直せば、とちゅうの交換も仕上がる） */
  private oppGone(): void {
    this.opp = null;
    this.oppInfo = null;
    this.myOffer = {};
    this.oppOffer = {};
    this.clearAgreement();
    this.onLeft();
    this.setStatus('waiting');
    if (this.peers.size > 0 && this.pickAt === 0) this.pickAt = this.clock.now() + TRADE_PICK_MS;
  }

  /** 3つの条件がそろったら交換する（§9-4） */
  private maybeExecute(): void {
    const hash = this.hash();
    const mine = this.myCommit;
    const theirs = this.oppCommit;
    if (!mine || !theirs || mine.hash !== hash || theirs.hash !== hash || mine.tradeId !== theirs.tradeId) return;
    const t = { tradeId: mine.tradeId, give: { ...this.myOffer }, get: { ...this.oppOffer } };
    this.onExecute(t);
    this.onPending(null);
    this.send(makeMsg('tradeAck', this.opts.protocol, { tradeId: t.tradeId }), this.opp ?? undefined);
    // 次の交換へ（内容を空にする）
    this.count += 1;
    this.myOffer = {};
    this.oppOffer = {};
    this.clearAgreement();
    this.emit();
  }

  private sendHello(to?: string): void {
    if (this.status === 'idle' || this.status === 'full' || this.status === 'version') return;
    const p = this.opts.pending();
    this.send(
      makeMsg('tradeHello', this.opts.protocol, {
        protocol: this.opts.protocol,
        appVersion: this.opts.appVersion,
        name: this.opts.name,
        ticket: this.ticket,
        playerId: this.opts.playerId,
        pending: p ? p.tradeId : '',
        done: this.opts.doneIds().slice(-TRADE_DONE_KEEP),
        ...(this.opts.userId ? { userId: this.opts.userId } : {}),
      }),
      to,
    );
  }

  private gotHello(raw: MsgBody['tradeHello'], from: string): void {
    const h = cleanHello(raw);
    if (!h) {
      this.ignored.push(`bad hello from ${from}`);
      return;
    }
    if (h.protocol !== this.opts.protocol) {
      if (this.opp) {
        this.send(makeMsg('full', this.opts.protocol, {}), from);
        return;
      }
      this.sendHello(from);
      this.setStatus('version');
      this.close();
      return;
    }
    const known = this.peers.has(from);
    this.peers.set(from, h);
    if (!known) this.sendHello(from);
    if (this.opp) {
      if (from !== this.opp && h.playerId !== this.oppInfo?.playerId) this.send(makeMsg('full', this.opts.protocol, {}), from);
      return;
    }
    if (this.pickAt === 0) this.pickAt = this.clock.now() + TRADE_PICK_MS;
  }

  /** 入室チケットの早い2人が相手。3人目以降は まんいん */
  private pick(): void {
    this.pickAt = 0;
    if (this.status !== 'waiting') return;
    const me = { id: this.selfId, ticket: this.ticket };
    const all = [me, ...[...this.peers].map(([id, h]) => ({ id, ticket: h.ticket }))].sort(
      (a, b) => a.ticket.time - b.ticket.time || a.ticket.rand - b.ticket.rand || (a.id < b.id ? -1 : 1),
    );
    const two = all.slice(0, 2);
    if (!two.some((p) => p.id === this.selfId)) {
      this.setStatus('full');
      this.close();
      return;
    }
    for (const p of all.slice(2)) this.send(makeMsg('full', this.opts.protocol, {}), p.id);
    if (two.length < 2) return;
    const opp = two.find((p) => p.id !== this.selfId)!;
    const info = this.peers.get(opp.id)!;
    if (info.playerId === this.opts.playerId) {
      // 同じセーブどうし：交換できない（内容のハッシュの並べ方も決まらない）
      this.setStatus('self');
      this.close();
      return;
    }
    this.opp = opp.id;
    this.oppInfo = info;
    // 交換IDの「この部屋で何回目か」は、相手ごとに 0 から（入り直した相手は新しいセッションなので）
    this.count = 0;
    this.setStatus('trading');
    this.resume(this.oppInfo);
  }

  /** 前の とちゅうの交換を、相手の記録で仕上げる・取り消す */
  private resume(h: MsgBody['tradeHello']): void {
    const p = this.opts.pending();
    if (!p || p.oppPlayerId !== h.playerId) return;
    // 自分はもう保存を済ませていた（記録を消す前に閉じた）：何もしないで記録だけ消す
    if (this.opts.doneIds().includes(p.tradeId)) {
      this.onPending(null);
      return;
    }
    const decision = h.done.includes(p.tradeId) ? 'apply' : 'drop';
    this.onResume(decision, p);
    this.onPending(null);
  }

  private tick(): void {
    if (this.status === 'waiting' && this.pickAt !== 0 && this.clock.now() >= this.pickAt) this.pick();
  }

  private send(m: Msg, to?: string): void {
    this.transport.send(m, to);
  }

  private setStatus(s: TradeStatus): void {
    this.status = s;
    this.emit();
  }

  private emit(): void {
    this.onChange(this.view);
  }

  private close(): void {
    this.stopTimer?.();
    this.stopTimer = null;
    this.transport.leave();
  }

  /** テスト用：時間を進めた時に見張りを動かす */
  pingNow(): void {
    this.tick();
  }
}

/** 受け取った hello を確かめる */
function cleanHello(h: MsgBody['tradeHello']): MsgBody['tradeHello'] | null {
  if (!h || typeof h !== 'object') return null;
  const t = h.ticket as Partial<Ticket> | undefined;
  if (typeof h.protocol !== 'number' || typeof h.playerId !== 'string' || !t || !Number.isFinite(t.time) || !Number.isFinite(t.rand)) return null;
  const name = typeof h.name === 'string' && h.name.trim() !== '' ? [...h.name].slice(0, 8).join('') : '？';
  return {
    protocol: h.protocol,
    appVersion: String(h.appVersion ?? ''),
    name,
    ticket: { time: Number(t.time), rand: Number(t.rand) },
    playerId: h.playerId.slice(0, 64),
    pending: typeof h.pending === 'string' ? h.pending.slice(0, 32) : '',
    done: Array.isArray(h.done) ? h.done.filter((x): x is string => typeof x === 'string').slice(-TRADE_DONE_KEEP) : [],
    ...(typeof h.userId === 'string' && /^[1-9][0-9]{14}$/.test(h.userId) ? { userId: h.userId } : {}),
  };
}
