import { describe, expect, it } from 'vitest';
import { connectLockstep } from '../src/battle/lockstep';
import { CpuController } from '../src/controllers/cpu';
import { Match } from '../src/controllers/match';
import { RemoteController } from '../src/controllers/remote';
import { CARD_DB } from '../src/data/cards';
import { starterDeckNos } from '../src/data/starterDeck';
import { type Side, hashState } from '../src/engine';
import { makeMsg } from '../src/net/protocol';
import { type Clock, type GameStart, LOST_AFTER_MS, OnlineSession, PICK_AFTER_MS, type SessionStatus, WAITING_AFTER_MS } from '../src/net/session';
import { MemoryHub, type MemoryTransport } from '../src/net/transport';
import { makeRandom } from './save.helpers';

/** 手で進める時計 */
class FakeClock implements Clock {
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

type Peer = {
  s: OnlineSession;
  t: MemoryTransport;
  statuses: SessionStatus['kind'][];
  starts: GameStart[];
  conn: string[];
  desync: number[];
};

function makePeer(hub: MemoryHub, clock: FakeClock, id: string, opts: { name?: string; deck?: number[]; protocol?: number; seed?: number; playerId?: string } = {}): Peer {
  const t = hub.create(id);
  const r = makeRandom(opts.seed ?? id.charCodeAt(id.length - 1));
  const s = new OnlineSession(t, {
    name: opts.name ?? id,
    deck: opts.deck ?? starterDeckNos(),
    protocol: opts.protocol ?? 1,
    appVersion: '0.0.0',
    playerId: opts.playerId ?? `player-${id}`,
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
async function matchUp(hub: MemoryHub, clock: FakeClock): Promise<void> {
  await settle(hub);
  clock.advance(PICK_AFTER_MS + 300);
  await settle(hub);
}

async function settle(hub: MemoryHub): Promise<void> {
  let quiet = 0;
  for (let i = 0; i < 50 && quiet < 3; i++) {
    const n = hub.flush();
    await new Promise((r) => setTimeout(r, 0));
    quiet = n === 0 ? quiet + 1 : 0;
  }
}

async function pair(seedA = 1, seedB = 2) {
  const hub = new MemoryHub();
  const clock = new FakeClock();
  const a = makePeer(hub, clock, 'peer-a', { seed: seedA, name: 'あ' });
  const b = makePeer(hub, clock, 'peer-b', { seed: seedB, name: 'い' });
  a.s.join('123456');
  clock.advance(10);
  b.s.join('123456');
  await matchUp(hub, clock);
  return { hub, clock, a, b };
}

describe('オンライン：入室と満室（SPEC §11-2）', () => {
  it('2人が同じ部屋に入ると対戦が始まる。種・デッキ・名前がそろい、役割はピアIDの小さい方が p1', async () => {
    const { a, b } = await pair();
    expect(a.starts).toHaveLength(1);
    expect(b.starts).toHaveLength(1);
    expect(a.starts[0].seed).toBe(b.starts[0].seed);
    expect(a.starts[0].seed).toMatch(/^[0-9a-f]{64}$/);
    expect(a.starts[0].me).toBe('p1'); // 'peer-a' < 'peer-b'
    expect(b.starts[0].me).toBe('p2');
    expect(a.starts[0].decks).toEqual(b.starts[0].decks);
    expect(a.starts[0].names).toEqual({ p1: 'あ', p2: 'い' });
    expect(b.starts[0].names).toEqual({ p1: 'あ', p2: 'い' });
  });

  it('2人が対戦者を決める時刻がずれても（相手の deck が先に届いても）対戦が始まる', async () => {
    const hub = new MemoryHub();
    const clockA = new FakeClock();
    const clockB = new FakeClock();
    const a = makePeer(hub, clockA, 'peer-a');
    const b = makePeer(hub, clockB, 'peer-b');
    a.s.join('777777');
    b.s.join('777777');
    await settle(hub);
    clockA.advance(PICK_AFTER_MS + 300); // a だけ先に決めて deck を送る
    await settle(hub);
    expect(a.statuses).toContain('matched');
    expect(b.statuses).not.toContain('matched');
    clockB.advance(PICK_AFTER_MS + 300);
    await settle(hub);
    expect(a.starts).toHaveLength(1);
    expect(b.starts).toHaveLength(1);
    expect(a.starts[0].seed).toBe(b.starts[0].seed);
  });

  it('3人目は「まんいん」になり、2人の対戦は続く', async () => {
    const { hub, clock, a, b } = await pair();
    const c = makePeer(hub, clock, 'peer-0'); // ID は一番小さいが、チケットが遅い
    clock.advance(10);
    c.s.join('123456');
    await matchUp(hub, clock);
    expect(c.statuses).toContain('full');
    expect(a.statuses).not.toContain('full');
    expect(b.statuses).not.toContain('full');
    expect(a.s.status.kind).toBe('playing');
  });

  it('3人がほぼ同時に入っても、チケットが早い2人が対戦者になる', async () => {
    const hub = new MemoryHub();
    const clock = new FakeClock();
    const peers = ['peer-x', 'peer-y', 'peer-z'].map((id, i) => makePeer(hub, clock, id, { seed: i + 5 }));
    // 3人が部屋に入ってから、まとめてメッセージが届く
    peers[1].s.join('999999');
    clock.advance(1);
    peers[2].s.join('999999');
    clock.advance(1);
    peers[0].s.join('999999');
    await matchUp(hub, clock);
    expect(peers[1].starts).toHaveLength(1);
    expect(peers[2].starts).toHaveLength(1);
    expect(peers[0].statuses).toContain('full');
  });

  it('対戦中に版の違う人が来ても、対戦は止まらない（その人には満室を返す）', async () => {
    const { hub, clock, a, b } = await pair();
    const old = makePeer(hub, clock, 'peer-old', { protocol: 0 });
    old.s.join('123456');
    await matchUp(hub, clock);
    expect(a.s.status.kind).toBe('playing');
    expect(b.s.status.kind).toBe('playing');
    expect(old.starts).toHaveLength(0);
    expect(['full', 'version']).toContain(old.s.status.kind);
  });

  it('壊れた hello（名前が文字列でない・チケットが数でない）は無視し、長い名前は8文字に切る', async () => {
    const hub = new MemoryHub();
    const clock = new FakeClock();
    const a = makePeer(hub, clock, 'peer-a');
    const bad = hub.create('peer-bad');
    bad.onPeerJoin = (id) => bad.send(makeMsg('hello', 1, { protocol: 1, appVersion: 'x', name: 5 as unknown as string, ticket: { time: 'no' as unknown as number, rand: 1 }, playerId: 'p' }), id);
    a.s.join('4444');
    bad.join('oteca-room-4444');
    await matchUp(hub, clock);
    expect(a.s.status.kind).toBe('waiting');
    const b = makePeer(hub, clock, 'peer-b', { name: 'ながいながいなまえです' });
    b.s.join('4444');
    await matchUp(hub, clock);
    expect(a.starts).toHaveLength(1);
    expect(a.starts[0].names[b.starts[0].me]).toBe('ながいながいなま');
  });

  it('プロトコル版数が違うと、両者に「バージョンがちがう」', async () => {
    const hub = new MemoryHub();
    const clock = new FakeClock();
    const a = makePeer(hub, clock, 'peer-a', { protocol: 1 });
    const b = makePeer(hub, clock, 'peer-b', { protocol: 2 });
    a.s.join('1234');
    b.s.join('1234');
    await settle(hub);
    expect(a.statuses).toContain('version');
    expect(b.statuses).toContain('version');
    expect(a.starts).toHaveLength(0);
  });
});

describe('オンライン：コミット・リビール（SPEC §11-4）', () => {
  it('種の本体がコミットと合わなければ対戦を中止する', async () => {
    const hub = new MemoryHub();
    const clock = new FakeClock();
    const a = makePeer(hub, clock, 'peer-a');
    const b = makePeer(hub, clock, 'peer-b');
    // b の送る reveal を書きかえる
    const send = b.t.send.bind(b.t);
    b.t.send = (m, to) => {
      if (m.t === 'reveal') m = makeMsg('reveal', m.v, { ...m.body, seed: '00'.repeat(32) });
      send(m, to);
    };
    a.s.join('5555');
    b.s.join('5555');
    await matchUp(hub, clock);
    expect(a.statuses).toContain('aborted');
    expect(a.starts).toHaveLength(0);
  });

  it('種は SHA-256(seed_p1 + seed_p2)：どちらか一方だけでは決まらない（同じ相手でも自分の種が変われば変わる）', async () => {
    const x = await pair(1, 2);
    const y = await pair(1, 3);
    expect(x.a.starts[0].seed).not.toBe(y.a.starts[0].seed);
  });
});

/**
 * 通信なしで、2つのセッション＋2つのエンジンを動かす。
 * 各端末では、自分の側を CPU、相手の側を remote にする（相手の操作は通信で届いたものだけ）。
 */
async function playLockstep(seedA: number, seedB: number, hooks: { tamper?: boolean } = {}) {
  const { hub, clock, a, b } = await pair(seedA, seedB);
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
    });
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
  return { hub, clock, a, b, sides };
}

describe('オンライン：ロックステップ（SPEC §11-3、§11-6）', () => {
  it('通信なしで2つのエンジンを動かすと、最後まで状態ハッシュが一致する（3試合）', async () => {
    for (let i = 0; i < 3; i++) {
      const { sides, a, b } = await playLockstep(10 + i, 20 + i);
      const [x, y] = sides;
      expect(x.match.state.phase).toBe('over');
      expect(y.match.state.phase).toBe('over');
      expect(hashState(x.match.state)).toBe(hashState(y.match.state));
      expect(x.match.log).toEqual(y.match.log);
      expect(x.match.rejected).toEqual([]);
      expect(y.match.rejected).toEqual([]);
      expect(a.desync).toEqual([]);
      expect(b.desync).toEqual([]);
    }
  }, 60000);

  it('状態ハッシュが違えば「ずれ」を知らせる', async () => {
    const { a } = await playLockstep(3, 4, { tamper: true });
    expect(a.desync.length).toBeGreaterThan(0);
  }, 60000);

  it('送る操作に「誰の操作か」は入れない（受け取った側が相手の役割を入れる）。操作だけで状態は送らない', async () => {
    const { hub, a, b } = await pair();
    const seen: unknown[] = [];
    const send = a.t.send.bind(a.t);
    a.t.send = (m, to) => {
      seen.push(m);
      send(m, to);
    };
    const got: unknown[] = [];
    b.s.onRemoteAction = (act) => got.push(act);
    a.s.sendAction({ type: 'END_TURN', player: 'p1' });
    await settle(hub);
    const msg = seen.find((m) => (m as { t: string }).t === 'action') as { body: { seq: number; action: object } };
    expect(msg.body.seq).toBe(1);
    expect(msg.body.action).toEqual({ type: 'END_TURN' });
    expect(got).toEqual([{ type: 'END_TURN', player: 'p1' }]);
  });
});

describe('オンライン：連番（SPEC §11-5）', () => {
  it('重複は無視し、飛びがあれば再送を頼んで順番どおりに通す', async () => {
    const { hub, a, b } = await pair();
    const got: string[] = [];
    b.s.onRemoteAction = (act) => got.push(act.type);
    // 2番目を一度だけ落とす
    let dropped = false;
    const send = a.t.send.bind(a.t);
    a.t.send = (m, to) => {
      if (m.t === 'action' && m.body.seq === 2 && !dropped) {
        dropped = true;
        return;
      }
      send(m, to);
      if (m.t === 'action' && m.body.seq === 1) send(m, to); // 1番目は2回届く
    };
    a.s.sendAction({ type: 'PLACE_BENCH', player: 'p1', uid: 'p1-1' });
    a.s.sendAction({ type: 'SWAP', player: 'p1', benchUid: 'p1-1' });
    a.s.sendAction({ type: 'END_TURN', player: 'p1' });
    await settle(hub);
    expect(got).toEqual(['PLACE_BENCH', 'SWAP', 'END_TURN']);
  });

  it('最後の操作を取りこぼしても、ping の「送った数」で気づいて再送を頼む', async () => {
    const { hub, clock, a, b } = await pair();
    const got: string[] = [];
    b.s.onRemoteAction = (act) => got.push(act.type);
    const send = a.t.send.bind(a.t);
    let drop = true;
    a.t.send = (m, to) => {
      if (m.t === 'action' && drop) {
        drop = false;
        return;
      }
      send(m, to);
    };
    a.s.sendAction({ type: 'END_TURN', player: 'p1' });
    await settle(hub);
    expect(got).toEqual([]);
    clock.advance(3000);
    await settle(hub);
    expect(got).toEqual(['END_TURN']);
  });
});

describe('オンライン：切断・再接続（SPEC §11-7）', () => {
  it('6秒 返事が無いと「まっています」、30秒で「きれた」。戻ってきたら送り直して続く', async () => {
    const { hub, clock, a, b } = await pair();
    const got: string[] = [];
    b.s.onRemoteAction = (act) => got.push(act.type);
    // b の通信が切れる（b は a から何も受け取れない）
    const bRecv = b.t.onMessage;
    b.t.onMessage = () => {};
    const aRecv = a.t.onMessage;
    a.t.onMessage = () => {};
    a.s.sendAction({ type: 'PLACE_BENCH', player: 'p1', uid: 'p1-1' });
    a.s.sendAction({ type: 'END_TURN', player: 'p1' });
    clock.advance(WAITING_AFTER_MS + 1000);
    await settle(hub);
    expect(a.conn).toContain('waiting');
    expect(b.conn).toContain('waiting');
    // 「もうすこし まつ」を押すと、そこから30秒待つ
    clock.advance(LOST_AFTER_MS);
    await settle(hub);
    expect(a.conn.at(-1)).toBe('lost');
    a.s.waitMore();
    expect(a.conn.at(-1)).toBe('waiting');
    // 通信が戻る
    b.t.onMessage = bRecv;
    a.t.onMessage = aRecv;
    clock.advance(3000);
    await settle(hub);
    expect(a.conn.at(-1)).toBe('ok');
    expect(b.conn.at(-1)).toBe('ok');
    expect(got).toEqual(['PLACE_BENCH', 'END_TURN']);
  });

  it('相手が部屋を出て、同じ人が入り直すと、それまでの操作を全部送り直して続く', async () => {
    const { hub, clock, a, b } = await pair();
    const got: string[] = [];
    b.s.onRemoteAction = (act) => got.push(act.type);
    a.s.sendAction({ type: 'PLACE_BENCH', player: 'p1', uid: 'p1-1' });
    await settle(hub);
    // b が一時的に部屋から消える（ネットワークが落ちた）→ その間に a が操作
    const room = 'oteca-room-123456';
    hub.exit(room, b.t);
    a.s.sendAction({ type: 'END_TURN', player: 'p1' });
    clock.advance(8000);
    await settle(hub);
    expect(a.conn).toContain('waiting');
    hub.enter(room, b.t);
    await settle(hub);
    expect(got).toEqual(['PLACE_BENCH', 'END_TURN']);
    expect(a.conn.at(-1)).toBe('ok');
  });
});

describe('オンライン：再戦（SPEC §7 S05）', () => {
  it('両者が「もういっかい」を押すと、新しい種で先攻決めからやり直す。片方だけでは始まらない', async () => {
    const { hub, a, b } = await pair();
    let oppWants = 0;
    b.s.onOpponentRematch = () => (oppWants += 1);
    a.s.requestRematch();
    await settle(hub);
    expect(oppWants).toBe(1);
    expect(a.starts).toHaveLength(1);
    b.s.requestRematch();
    await settle(hub);
    expect(a.starts).toHaveLength(2);
    expect(b.starts).toHaveLength(2);
    expect(a.starts[1].game).toBe(1);
    expect(a.starts[1].seed).toBe(b.starts[1].seed);
    expect(a.starts[1].seed).not.toBe(a.starts[0].seed);
  });
});
