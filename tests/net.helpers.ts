import { connectLockstep } from '../src/battle/lockstep';
import { CpuController } from '../src/controllers/cpu';
import { Match } from '../src/controllers/match';
import { RemoteController } from '../src/controllers/remote';
import { CARD_DB } from '../src/data/cards';
import { classicDeckNos } from '../src/data/starterDeck';
import type { GameEvent, Side } from '../src/engine';
import { type Clock, type GameStart, OnlineSession, PICK_AFTER_MS, type SessionStatus } from '../src/net/session';
import { MemoryHub, type MemoryTransport } from '../src/net/transport';
import { makeRandom } from './save.helpers';

/** 通信のテスト（net.session.test.ts・net.session.slow.test.ts）で共通に使うもの */

/** 手で進める時計 */
export class FakeClock implements Clock {
  t = 1_000_000;
  private readonly timers: { every: number; next: number; fn: () => void; alive: boolean }[] = [];
  now = () => this.t;
  every = (ms: number, fn: () => void) => {
    const timer = { every: ms, next: this.t + ms, fn, alive: true };
    this.timers.push(timer);
    return () => void (timer.alive = false);
  };
  advance(ms: number): void {
    const end = this.t + ms;
    for (;;) {
      const due = this.timers.filter((x) => x.alive && x.next <= end).sort((a, b) => a.next - b.next)[0];
      if (!due) break;
      this.t = due.next;
      due.next += due.every;
      due.fn();
    }
    this.t = end;
  }
}

export type Peer = {
  s: OnlineSession;
  t: MemoryTransport;
  statuses: SessionStatus['kind'][];
  starts: GameStart[];
  conn: string[];
  desync: number[];
};

export function makePeer(hub: MemoryHub, clock: FakeClock, id: string, opts: { name?: string; deck?: number[]; protocol?: number; seed?: number; playerId?: string; userId?: string } = {}): Peer {
  const t = hub.create(id);
  const r = makeRandom(opts.seed ?? id.charCodeAt(id.length - 1));
  const s = new OnlineSession(t, {
    name: opts.name ?? id,
    deck: opts.deck ?? classicDeckNos(),
    protocol: opts.protocol ?? 1,
    appVersion: '0.0.0',
    playerId: opts.playerId ?? `player-${id}`,
    ...(opts.userId ? { userId: opts.userId } : {}),
    clock,
    randomBytes: (n) => new Uint8Array(n).map(() => r.int(0, 255)),
  });
  const p: Peer = { s, t, statuses: [], starts: [], conn: [], desync: [] };
  s.onStatus = (st) => p.statuses.push(st.kind);
  s.onStart = (g) => p.starts.push(g);
  s.onConnection = (c) => p.conn.push(c);
  s.onDesync = (turn) => p.desync.push(turn);
  return p;
}

/** メッセージを届け切る（SHA-256 の非同期処理も待つ） */
/** 入室のあと：hello を集めて対戦者を決め、種を決めるところまで進める */
export async function matchUp(hub: MemoryHub, clock: FakeClock): Promise<void> {
  await settle(hub);
  clock.advance(PICK_AFTER_MS + 300);
  await settle(hub);
}

export async function settle(hub: MemoryHub): Promise<void> {
  let quiet = 0;
  for (let i = 0; i < 80 && quiet < 4; i++) {
    const n = hub.flush();
    // 何も届かなかった時は少し長めに待つ（SHA-256 の計算は非同期。遅い機械（GitHub の公開の作業）では 0ms では終わらないことがあった）
    await new Promise((r) => setTimeout(r, n === 0 ? 5 : 0));
    quiet = n === 0 ? quiet + 1 : 0;
  }
}

export async function pair(seedA = 1, seedB = 2, deck?: number[]) {
  const hub = new MemoryHub();
  const clock = new FakeClock();
  const a = makePeer(hub, clock, 'peer-a', { seed: seedA, name: 'あ', deck });
  const b = makePeer(hub, clock, 'peer-b', { seed: seedB, name: 'い', deck });
  a.s.join('123456');
  clock.advance(10);
  b.s.join('123456');
  await matchUp(hub, clock);
  return { hub, clock, a, b };
}

/**
 * 通信なしで、2つのセッション＋2つのエンジンを動かす。
 * 各端末では、自分の側を CPU、相手の側を remote にする（相手の操作は通信で届いたものだけ）。
 */
export async function playLockstep(seedA: number, seedB: number, hooks: { tamper?: boolean; deck?: number[] } = {}) {
  const { hub, clock, a, b } = await pair(seedA, seedB, hooks.deck);
  /** それぞれの端末で出たイベント（画面の演出の順番） */
  const logs: GameEvent[][] = [];
  const pending: (() => void)[] = [];
  const sched = (fn: () => void) => {
    pending.push(fn);
    return null;
  };
  const sides: { peer: Peer; match: Match; me: Side }[] = [];
  for (const peer of [a, b]) {
    const g = peer.starts[0];
    const opp: Side = g.me === 'p1' ? 'p2' : 'p1';
    const remote = new RemoteController(opp);
    const cpu = new CpuController(g.me, sched);
    const match = new Match({ seed: g.seed, decks: g.decks, cardDb: CARD_DB }, g.me === 'p1' ? { p1: cpu, p2: remote } : { p1: remote, p2: cpu });
    peer.s.onRemoteAction = (act) => remote.feed(act);
    // 画面と同じつなぎ（battle/lockstep.ts）を使う。tamper の時は b のハッシュをわざと変える
    connectLockstep(match, g.me, {
      sendAction: (act) => peer.s.sendAction(act),
      sendHash: (turn, h) => peer.s.sendHash(turn, hooks.tamper && peer === b ? 'deadbeef' : h),
      sendResult: (w) => peer.s.sendResult(w),
    });
    const log: GameEvent[] = [];
    match.subscribe((step) => log.push(...step.events));
    logs.push(log);
    sides.push({ peer, match, me: g.me });
  }
  for (let i = 0; i < 20000; i++) {
    for (const s of sides) s.match.notifyIdle();
    await settle(hub);
    const fn = pending.shift();
    if (!fn) {
      if (sides.every((s) => s.match.state.phase === 'over')) break;
      continue;
    }
    fn();
  }
  return { hub, clock, a, b, sides, logs };
}
