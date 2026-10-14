import type { Action, RejectReason, Side } from '../engine/types';
import { type Msg, type MsgBody, type WireAction, fromWire, makeMsg, roomName } from './protocol';
import type { NetTransport } from './transport';

/**
 * 観戦（v2.0-J。管理者メニューの「大会閲覧」。SPEC §7 S20・§11-10）
 * フレンド対戦の部屋に「観戦者」として入る。hello を送らないので、まちあいの一覧にも対戦にも入らない。
 * 対戦者2人から、試合の始まり（乱数の種・デッキ・名前）と、それぞれの操作の記録を受け取り、同じ試合を再現する。
 * 画面（React）には依存しない。テストでは MemoryHub の通信で動かす。
 */

/** 部屋で進んでいる試合（2人のピアID と名前） */
export type SpecMatch = { key: string; game: number; peers: Record<Side, string>; names: Record<Side, string> };

/** 観戦する試合の始まり */
export type SpecStart = { key: string; game: number; seed: string; decks: Record<Side, number[]>; names: Record<Side, string> };

type SpectStartOrNull = SpecStart | null;

export type SpectatorStatus = 'connecting' | 'empty' | 'waiting' | 'full' | 'watching';

type Info = MsgBody['specInfo'];

const SIDES: Side[] = ['p1', 'p2'];

export class SpectatorSession {
  /** 様子：connecting＝つないでいる、empty＝だれもいない、waiting＝人はいるが対戦していない、full＝観戦者がもう3人、watching＝見ている */
  onStatus: (s: SpectatorStatus) => void = () => {};
  /** 部屋で進んでいる試合の一覧が変わった */
  onMatches: (list: SpecMatch[]) => void = () => {};
  /** 見ている試合が始まった（途中から入った時も、ここから再現する） */
  onStart: (s: SpecStart) => void = () => {};
  /** 新しい操作が届いた（drain で通す） */
  onActions: () => void = () => {};

  private readonly infos = new Map<string, Info>();
  private readonly people = new Set<string>();
  private watchingKey: string | null = null;
  private watchingGame = -1;
  private started: SpecStart | null = null;
  /** それぞれの操作（seq 1 から） */
  private logs: Record<Side, (WireAction | undefined)[]> = { p1: [], p2: [] };
  /** 通した数 */
  private applied: Record<Side, number> = { p1: 0, p2: 0 };
  private status: SpectatorStatus = 'connecting';
  private full = false;
  private lastMatches = '';

  constructor(
    private readonly transport: NetTransport,
    private readonly protocol: number,
  ) {
    transport.onMessage = (m, from) => this.receive(m, from);
    transport.onPeerJoin = (id) => {
      this.people.add(id);
      this.send(makeMsg('specHello', this.protocol, { protocol: this.protocol }), id);
      this.update();
    };
    transport.onPeerLeave = (id) => {
      this.people.delete(id);
      this.infos.delete(id);
      this.update();
    };
    transport.onError = () => {};
  }

  /** 部屋番号の部屋に入る */
  join(roomNumber: string): void {
    this.transport.join(roomName(roomNumber));
    this.setStatus('empty');
  }

  /** 観戦をやめる */
  leave(): void {
    for (const id of this.people) this.send(makeMsg('specLeave', this.protocol, {}), id);
    this.transport.leave();
  }

  get matches(): SpecMatch[] {
    const out: SpecMatch[] = [];
    const seen = new Set<string>();
    for (const [peer, info] of this.infos) {
      if (info.state !== 'playing' || !info.role || !info.names || !info.oppPeer) continue;
      const opp = this.infos.get(info.oppPeer);
      // 相手の様子も届いていて、同じ試合を指している時だけ
      if (!opp || opp.state !== 'playing' || opp.oppPeer !== peer || opp.game !== info.game) continue;
      const key = [peer, info.oppPeer].sort().join('+');
      if (seen.has(key)) continue;
      seen.add(key);
      const peers = { [info.role]: peer, [info.role === 'p1' ? 'p2' : 'p1']: info.oppPeer } as Record<Side, string>;
      out.push({ key, game: info.game, peers, names: info.names });
    }
    return out.sort((a, b) => (a.key < b.key ? -1 : 1));
  }

  /** この試合を見る（2人に知らせると、それぞれから始まりと記録が届く） */
  watch(m: SpecMatch): void {
    this.watchingKey = m.key;
    this.watchingGame = m.game;
    this.started = null;
    this.logs = { p1: [], p2: [] };
    this.applied = { p1: 0, p2: 0 };
    for (const side of SIDES) this.send(makeMsg('specWatch', this.protocol, { game: m.game }), m.peers[side]);
    this.setStatus('watching');
  }

  get watchingMatch(): string | null {
    return this.watchingKey;
  }

  /** 今の様子（画面を移った時に読み直す） */
  get state(): SpectatorStatus {
    return this.status;
  }

  /** 見ている試合の始まり（まだなら null） */
  get currentStart(): SpectStartOrNull {
    return this.started;
  }

  /**
   * 届いた操作を、通せるだけ通す（2人の操作は別々に届くので、順番が前後することがある。
   * まだその人の番でない操作は、相手の操作を通してから もう一度ためす）
   * @param submit 試合に通す（弾かれたら理由）
   * @returns 通した数
   */
  drain(submit: (a: Action) => RejectReason | null): number {
    let n = 0;
    for (let progress = true; progress; ) {
      progress = false;
      for (const side of SIDES) {
        for (;;) {
          const w = this.logs[side][this.applied[side]];
          if (!w) break;
          if (submit(fromWire(w, side)) !== null) break;
          this.applied[side] += 1;
          n += 1;
          progress = true;
        }
      }
    }
    return n;
  }

  /** まだ通していない操作の数 */
  get pending(): number {
    return SIDES.reduce((a, s) => a + this.logs[s].filter((x, i) => x && i >= this.applied[s]).length, 0);
  }

  private receive(m: Msg, from: string): void {
    // 受け取る側でも版を確かめる（v2.7）：自分と違うプロトコル版数のものは受け取らない
    if (m.v !== this.protocol) return;
    switch (m.t) {
      case 'specFull':
        this.full = true;
        this.setStatus('full');
        return;
      case 'specInfo':
        if (!m.body || (m.body.state !== 'playing' && m.body.state !== 'waiting')) return;
        this.infos.set(from, m.body);
        this.people.add(from);
        this.update();
        return;
      case 'specSync':
        this.gotSync(m.body, from);
        return;
      case 'specAction': {
        const b = m.body;
        if (!this.started || !b || b.game !== this.started.game || (b.side !== 'p1' && b.side !== 'p2') || !Number.isInteger(b.seq) || b.seq < 1) return;
        if (!this.fromWatched(from, b.side)) return;
        this.logs[b.side][b.seq - 1] = b.action;
        this.onActions();
        return;
      }
    }
  }

  /** 見ている試合の、その役割の人から届いたか */
  private fromWatched(from: string, side: Side): boolean {
    const m = this.matches.find((x) => x.key === this.watchingKey);
    return !!m && m.peers[side] === from;
  }

  private gotSync(b: MsgBody['specSync'], from: string): void {
    if (!this.watchingKey || !b || (b.side !== 'p1' && b.side !== 'p2') || !Array.isArray(b.log)) return;
    const m = this.matches.find((x) => x.key === this.watchingKey);
    if (!m || m.peers[b.side] !== from) return;
    // 新しい試合（再戦）：はじめから
    if (!this.started || this.started.game !== b.game) {
      if (b.game < this.watchingGame) return;
      this.watchingGame = b.game;
      this.logs = { p1: [], p2: [] };
      this.applied = { p1: 0, p2: 0 };
      this.started = { key: this.watchingKey, game: b.game, seed: String(b.seed), decks: b.decks, names: b.names };
      this.onStart(this.started);
    }
    b.log.forEach((a, i) => {
      this.logs[b.side][i] = a;
    });
    this.onActions();
  }

  private update(): void {
    const list = this.matches;
    const sig = JSON.stringify(list);
    if (sig !== this.lastMatches) {
      this.lastMatches = sig;
      this.onMatches(list);
      // 見ていた試合が終わった（まちあいに戻った）：次の試合を待つ
      if (this.watchingKey && !list.some((x) => x.key === this.watchingKey)) {
        this.watchingKey = null;
        this.started = null;
      }
    }
    if (this.full) return;
    if (this.watchingKey) this.setStatus('watching');
    else this.setStatus(this.people.size === 0 ? 'empty' : 'waiting');
  }

  private setStatus(s: SpectatorStatus): void {
    if (s === this.status) return;
    this.status = s;
    this.onStatus(s);
  }

  private send(m: Msg, to: string): void {
    this.transport.send(m, to);
  }
}
