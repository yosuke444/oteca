import { describe, expect, it } from 'vitest';
import { RateLobby, type RatePaired } from '../src/net/rateLobby';
import { rateRoomName } from '../src/net/protocol';
import { MemoryHub } from '../src/net/transport';
import { FakeClock, makePeer, matchUp, settle } from './net.helpers';
import { makeRandom } from './save.helpers';

type P = { lobby: RateLobby; paired: RatePaired[]; playerId: string };

function player(hub: MemoryHub, clock: FakeClock, n: number, lastOpponentId = ''): P {
  const r = makeRandom(100 + n);
  const playerId = `pl-${n}`;
  const tr = hub.create(`lobby-${n}`);
  const lobby = new RateLobby(tr, {
    playerId,
    name: `人${n}`,
    rate: 100 + n,
    lastOpponentId,
    protocol: 9,
    rooms: 1,
    clock,
    randomBytes: (k) => new Uint8Array(k).map(() => r.int(0, 255)),
  });
  const p: P = { lobby, paired: [], playerId };
  lobby.onPaired = (x) => {
    p.paired.push(x);
    lobby.leave();
  };
  return p;
}

async function run(hub: MemoryHub, clock: FakeClock, ms: number) {
  for (let t = 0; t < ms; t += 250) {
    clock.advance(250);
    await settle(hub);
  }
}

describe('R05 レートの待合所（UPDATE_v2 §8-4）', () => {
  it('4人で2組できる。待ち始めた順に組み、同じ部屋IDを2人が受け取る', async () => {
    const hub = new MemoryHub();
    const clock = new FakeClock();
    const ps = [1, 2, 3, 4].map((n) => player(hub, clock, n));
    for (const p of ps) {
      p.lobby.join();
      clock.advance(10);
    }
    await run(hub, clock, 5000);
    for (const p of ps) expect(p.paired, p.playerId).toHaveLength(1);
    const pairOf = (p: P) => ps.find((q) => q !== p && q.paired[0].roomId === p.paired[0].roomId)!;
    expect(pairOf(ps[0])).toBe(ps[1]);
    expect(pairOf(ps[2])).toBe(ps[3]);
    expect(ps[0].paired[0]).toMatchObject({ opponentId: 'pl-2', opponentName: '人2', opponentRate: 102 });
  });

  it('待っている人数が分かる', async () => {
    const hub = new MemoryHub();
    const clock = new FakeClock();
    // 直前の相手どうしなので組まれない2人
    const a = player(hub, clock, 1, 'pl-2');
    const b = player(hub, clock, 2, 'pl-1');
    const counts: number[] = [];
    a.lobby.onWaiting = (n) => counts.push(n);
    a.lobby.join();
    b.lobby.join();
    await run(hub, clock, 3000);
    expect(counts.at(-1)).toBe(2);
    expect(a.paired).toHaveLength(0);
  });

  it('直前の相手とは組まない。待っているのが直前の相手だけなら、ほかの人が来るまで待つ', async () => {
    const hub = new MemoryHub();
    const clock = new FakeClock();
    const a = player(hub, clock, 1, 'pl-2');
    const b = player(hub, clock, 2, 'pl-1');
    a.lobby.join();
    clock.advance(10);
    b.lobby.join();
    await run(hub, clock, 6000);
    expect(a.paired).toHaveLength(0);
    expect(b.paired).toHaveLength(0);
    const c = player(hub, clock, 3);
    c.lobby.join();
    await run(hub, clock, 5000);
    // c は先に待っていた a と組む。b は待ち続ける
    expect(c.paired[0]?.opponentId).toBe('pl-1');
    expect(a.paired[0]?.opponentId).toBe('pl-3');
    expect(b.paired).toHaveLength(0);
  });

  it('片方だけが直前の相手として覚えていても組まない', async () => {
    const hub = new MemoryHub();
    const clock = new FakeClock();
    const a = player(hub, clock, 1, 'pl-2');
    const b = player(hub, clock, 2, '');
    a.lobby.join();
    b.lobby.join();
    await run(hub, clock, 6000);
    expect(a.paired).toHaveLength(0);
    expect(b.paired).toHaveLength(0);
  });

  it('やめた人は待ち行列から消え、組まれない', async () => {
    const hub = new MemoryHub();
    const clock = new FakeClock();
    const a = player(hub, clock, 1);
    const b = player(hub, clock, 2);
    a.lobby.join();
    b.lobby.join();
    b.lobby.leave();
    await run(hub, clock, 9000);
    expect(a.paired).toHaveLength(0);
    expect(a.lobby.waiting).toBe(1);
  });

  it('組んだ2人は、2人だけの部屋に移ると自動で対戦が始まり、相手のレートと ID が分かる', async () => {
    const hub = new MemoryHub();
    const clock = new FakeClock();
    const a = player(hub, clock, 1);
    const b = player(hub, clock, 2);
    a.lobby.join();
    b.lobby.join();
    await run(hub, clock, 5000);
    const roomId = a.paired[0].roomId;
    expect(b.paired[0].roomId).toBe(roomId);
    const sa = makePeer(hub, clock, 'room-a', { playerId: 'pl-1' });
    const sb = makePeer(hub, clock, 'room-b', { playerId: 'pl-2' });
    // レートは hello で知らせる
    (sa.s as unknown as { opts: { rate: number } }).opts.rate = 101;
    (sb.s as unknown as { opts: { rate: number } }).opts.rate = 102;
    sa.s.joinRoom(rateRoomName(roomId));
    sb.s.joinRoom(rateRoomName(roomId));
    await matchUp(hub, clock);
    expect(sa.starts).toHaveLength(1);
    expect(sb.starts).toHaveLength(1);
    expect(sa.starts[0]).toMatchObject({ oppPlayerId: 'pl-2', oppRate: 102 });
    expect(sb.starts[0]).toMatchObject({ oppPlayerId: 'pl-1', oppRate: 101 });
  });

  it('同じセーブ（同じ playerId）の2つのタブどうしは組まない', async () => {
    const hub = new MemoryHub();
    const clock = new FakeClock();
    const a = player(hub, clock, 1);
    const b = player(hub, clock, 1);
    a.lobby.join();
    clock.advance(10);
    b.lobby.join();
    await run(hub, clock, 6000);
    expect(a.paired).toHaveLength(0);
    expect(b.paired).toHaveLength(0);
  });
});
