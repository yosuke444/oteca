import { describe, expect, it } from 'vitest';
import { RateLobby, type RatePaired } from '../src/net/rateLobby';
import { MemoryHub } from '../src/net/transport';
import { FakeClock, settle } from './net.helpers';
import { makeRandom } from './save.helpers';

/** 重いテスト（npm run test:slow）：予備の待合所の小部屋を移りながら出会う（SPEC §16-2i I04） */

const ID = (n: number) => n.toString(16).padStart(16, '0');

describe('I04 予備の待合所：ちがう小部屋から始めても出会える', () => {
  /** 最初の小部屋を決めておける乱数（1バイト目＝小部屋の番号） */
  function lobby(hub: MemoryHub, clock: FakeClock, n: number, firstRoom: number, joinLog?: string[]) {
    const r = makeRandom(500 + n);
    let first = true;
    const tr = hub.create(`fb-${n}`);
    const realJoin = tr.join.bind(tr);
    tr.join = (room: string) => {
      joinLog?.push(room);
      realJoin(room);
    };
    const l = new RateLobby(tr, {
      playerId: ID(n),
      name: `人${n}`,
      rate: 100,
      lastOpponentId: '',
      protocol: 6,
      clock,
      randomBytes: (k) => {
        if (first && k === 1) {
          first = false;
          return new Uint8Array([firstRoom]);
        }
        return new Uint8Array(k).map(() => r.int(0, 255));
      },
    });
    const paired: RatePaired[] = [];
    l.onPaired = (p) => {
      paired.push(p);
      l.leave();
    };
    return { l, paired };
  }
  async function run(hub: MemoryHub, clock: FakeClock, ms: number, stop?: () => boolean, step = 250) {
    for (let t = 0; t < ms; t += step) {
      clock.advance(step);
      await settle(hub);
      if (stop?.()) return;
    }
  }

  it('ちがう小部屋から始めても、移っているうちに出会って組める（何回ためしても）', async () => {
    const took: number[] = [];
    for (let seed = 0; seed < 4; seed++) {
      const hub = new MemoryHub();
      const clock = new FakeClock();
      const a = lobby(hub, clock, 10 + seed * 2, 0);
      const b = lobby(hub, clock, 11 + seed * 2, 4);
      a.l.join();
      clock.advance(3000);
      b.l.join();
      const t0 = clock.now();
      await run(hub, clock, 10 * 60 * 1000, () => a.paired.length > 0 && b.paired.length > 0, 500);
      took.push(clock.now() - t0);
      expect(a.paired, `seed ${seed}`).toHaveLength(1);
      expect(b.paired[0]?.roomId).toBe(a.paired[0].roomId);
    }
    console.log('出会うまで（秒）', took.map((t) => Math.round(t / 1000)));
  }, 120000);
});
