import { afterEach, describe, expect, it, vi } from 'vitest';
import { LOBBY_CONNECT_MS, RateSearch, type SocketLike } from '../src/net/matchmaker';
import { RATE_SUBROOMS, rateLobbyName } from '../src/net/protocol';
import { RateLobby, type RatePaired, SUBROOM_HOP_MS } from '../src/net/rateLobby';
import { MemoryHub } from '../src/net/transport';
import { applyServerRate, cacheFresh, countdown, decodeUnsent, encodeUnsent, markProvisional, queueReport, removeReport, reportWinner, type ServerMe } from '../src/online/ranking';
import { ensureIdentity, flushReports, nextBatchAfter, sendReport } from '../src/online/rankingApi';
import { nextBatchAt } from '../worker/src/logic/batch';
import { RANKING_UNSENT_MAX, type SaveData, createDefaultSave } from '../src/save/saveData';
import { FakeClock, settle } from './net.helpers';
import { makeRandom } from './save.helpers';

const ID = (n: number) => n.toString(16).padStart(16, '0');

describe('I04 予備の待合所（8つの小部屋）', () => {
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

  it('小部屋の名前は oteca-rate-p<版数>-<0〜7>', () => {
    expect(RATE_SUBROOMS).toBe(8);
    expect(rateLobbyName(6, 0)).toBe('oteca-rate-p6-0');
    expect(rateLobbyName(6, 7)).toBe('oteca-rate-p6-7');
  });

  it('同じ小部屋なら、今まで通り組める（試合ID は部屋ID。受付係の試合ではない）', async () => {
    const hub = new MemoryHub();
    const clock = new FakeClock();
    const a = lobby(hub, clock, 1, 3);
    const b = lobby(hub, clock, 2, 3);
    a.l.join();
    clock.advance(10);
    b.l.join();
    await run(hub, clock, 5000, () => a.paired.length > 0 && b.paired.length > 0);
    expect(a.paired[0].roomId).toBe(b.paired[0].roomId);
    expect(a.paired[0].matchId).toBe(a.paired[0].roomId);
    expect(a.paired[0].viaLobby).toBe(false);
    expect(a.paired[0].matchId).toMatch(/^[0-9a-f]{16}$/);
  });

  it('10秒だれもいなければ、ほかの小部屋（今の10秒の区切りで決まる所）へ移る。だれかいれば移らない', async () => {
    const hub = new MemoryHub();
    const clock = new FakeClock();
    const log: string[] = [];
    const a = lobby(hub, clock, 1, 5, log);
    a.l.join();
    expect(log).toEqual(['oteca-rate-p6-5']);
    await run(hub, clock, SUBROOM_HOP_MS - 500);
    expect(log).toHaveLength(1);
    await run(hub, clock, 1000);
    expect(log).toHaveLength(2);
    expect(log[1]).not.toBe(log[0]);
    expect(log[1]).toMatch(/^oteca-rate-p6-[0-7]$/);
    expect(a.l.currentRoom).toBe(Number(log[1].slice(-1)));
    a.l.leave();
  });

  it('直前の相手しかいない小部屋は、だれもいないのと同じ（移る）', async () => {
    const hub = new MemoryHub();
    const clock = new FakeClock();
    const log: string[] = [];
    const tr1 = hub.create('x1');
    const tr2 = hub.create('x2');
    const mk = (tr: typeof tr1, me: number, last: number, l?: string[]) => {
      const realJoin = tr.join.bind(tr);
      tr.join = (room: string) => {
        l?.push(room);
        realJoin(room);
      };
      let first = true;
      return new RateLobby(tr, {
        playerId: ID(me),
        name: 'x',
        rate: 100,
        lastOpponentId: ID(last),
        protocol: 6,
        clock,
        randomBytes: (k) => (first && k === 1 ? ((first = false), new Uint8Array([2])) : new Uint8Array(k).fill(7)),
      });
    };
    const a = mk(tr1, 1, 2, log);
    const b = mk(tr2, 2, 1);
    a.join();
    b.join();
    await run(hub, clock, SUBROOM_HOP_MS + 1000);
    expect(log.length).toBeGreaterThanOrEqual(2);
    a.leave();
    b.leave();
  });

});

/** テスト用の WebSocket */
class FakeSocket implements SocketLike {
  readyState = 0;
  sent: unknown[] = [];
  closed = false;
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: ((ev?: { code?: number }) => void) | null = null;
  onerror: (() => void) | null = null;
  send(d: string) {
    this.sent.push(JSON.parse(d));
  }
  close() {
    this.closed = true;
    this.readyState = 3;
  }
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  recv(m: unknown) {
    this.onmessage?.({ data: JSON.stringify(m) });
  }
  drop(code = 1006) {
    this.readyState = 3;
    this.onclose?.({ code });
  }
}

describe('I01 受付係につなぐ（端末の側）', () => {
  function make(withSocket = true) {
    const sock = new FakeSocket();
    const timers: { fn: () => void; ms: number; alive: boolean }[] = [];
    const lobbies: { joined: boolean; left: boolean; l: RateLobby }[] = [];
    const s = new RateSearch(
      { playerId: ID(1), name: 'あ', rate: 120, lastOpponentId: ID(9), protocol: 6 },
      {
        openSocket: withSocket ? () => sock : null,
        createLobby: () => {
          const rec = { joined: false, left: false, l: null as unknown as RateLobby };
          const fake = {
            onWaiting: (_n: number) => {},
            onPaired: (_p: RatePaired) => {},
            join: () => void (rec.joined = true),
            leave: () => void (rec.left = true),
          };
          rec.l = fake as unknown as RateLobby;
          lobbies.push(rec);
          return rec.l;
        },
        setTimer: (fn, ms) => {
          const t = { fn, ms, alive: true };
          timers.push(t);
          return () => void (t.alive = false);
        },
      },
    );
    const got = { waiting: [] as number[], paired: [] as RatePaired[], fallback: 0 };
    s.onWaiting = (n) => got.waiting.push(n);
    s.onPaired = (p) => got.paired.push(p);
    s.onFallback = () => (got.fallback += 1);
    const fire = () => timers.filter((t) => t.alive).forEach((t) => ((t.alive = false), t.fn()));
    return { s, sock, got, lobbies, fire, timers };
  }

  it('つながったら join（playerId・版数・直前の相手・名前・レート）を送り、人数と相手を受け取る', () => {
    const { s, sock, got } = make();
    s.join();
    sock.open();
    expect(sock.sent[0]).toEqual({ t: 'join', body: { playerId: ID(1), protocol: 6, lastOpponentId: ID(9), name: 'あ', rate: 120 } });
    sock.recv({ t: 'waiting', body: { count: 3 } });
    expect(got.waiting).toEqual([3]);
    sock.recv({ t: 'paired', body: { matchId: ID(77), roomId: ID(88), opponent: { playerId: ID(2), name: 'い', rate: 130 } } });
    expect(got.paired).toEqual([{ roomId: ID(88), matchId: ID(77), viaLobby: true, opponentId: ID(2), opponentName: 'い', opponentRate: 130 }]);
    expect(sock.closed).toBe(true);
    // 組めた後に切れても、予備へは行かない
    sock.drop();
    expect(got.fallback).toBe(0);
  });

  it(`${LOBBY_CONNECT_MS / 1000}秒つながらなければ、予備の待合所へ（画面に知らせる）`, () => {
    const { s, got, lobbies, fire, timers } = make();
    s.join();
    expect(timers[0].ms).toBe(5000);
    fire();
    expect(got.fallback).toBe(1);
    expect(lobbies[0].joined).toBe(true);
    expect(s.fallback).toBe(true);
  });

  it('待っている途中で切れたら、1回だけ つなぎ直す。また切れたら予備の待合所へ', () => {
    const { s, sock, got, lobbies, fire } = make();
    s.join();
    sock.open();
    sock.drop();
    expect(got.fallback).toBe(0);
    // 少し待って つなぎ直す（もう一度 join を送る）
    fire();
    sock.open();
    expect(sock.sent.filter((m) => (m as { t: string }).t === 'join')).toHaveLength(2);
    sock.recv({ t: 'waiting', body: { count: 2 } });
    expect(got.waiting).toEqual([2]);
    sock.drop();
    expect(got.fallback).toBe(1);
    expect(lobbies).toHaveLength(1);
  });

  it('同じセーブの別のタブが さがし始めた（4000 で切られた）：予備へ行かずに やめる', () => {
    const { s, sock, got, lobbies } = make();
    let replaced = 0;
    s.onReplaced = () => (replaced += 1);
    s.join();
    sock.open();
    sock.drop(4000);
    expect(replaced).toBe(1);
    expect(got.fallback).toBe(0);
    expect(lobbies).toHaveLength(0);
  });

  it('受付係を使わない設定（?lobby=off）なら、すぐ予備の待合所', () => {
    const { s, got, lobbies } = make(false);
    s.join();
    expect(got.fallback).toBe(1);
    expect(lobbies[0].joined).toBe(true);
  });

  it('「やめる」で leave を送って切る（予備に切り替えない）', () => {
    const { s, sock, got } = make();
    s.join();
    sock.open();
    s.leave();
    expect(sock.sent.at(-1)).toEqual({ t: 'leave' });
    expect(sock.closed).toBe(true);
    expect(got.fallback).toBe(0);
  });

  it('予備の待合所で組めたら、その相手を渡す', () => {
    const { s, got, lobbies, fire } = make();
    s.join();
    fire();
    const p: RatePaired = { roomId: ID(5), matchId: ID(5), viaLobby: false, opponentId: ID(3), opponentName: 'う', opponentRate: 90 };
    lobbies[0].l.onPaired(p);
    expect(got.paired).toEqual([p]);
    expect(lobbies[0].left).toBe(true);
  });
});

describe('I05 端末のランキング（かりのレート・報告・上書き）', () => {
  const base = () => createDefaultSave();
  const me = (x: Partial<ServerMe> = {}): ServerMe => ({ rate: 150, wins: 3, losses: 1, best: 160, rank: 2, visible: true, name: '', optIn: true, ...x });

  afterEach(() => vi.unstubAllGlobals());

  it('新しいセーブ：名前を載せる設定はオン、「かり」ではない', () => {
    const s = base();
    expect(s.ranking).toEqual({ token: '', optIn: true, unsent: [], provisional: false, syncedAt: 0, playedAt: 0 });
  });

  it('報告をセーブに入れる・消す（同じ試合は1つ、多すぎたら古いものから）', () => {
    const s = base();
    queueReport(s, { matchId: ID(1), winner: ID(5) });
    queueReport(s, { matchId: ID(1), winner: 'void' });
    expect(s.ranking.unsent).toEqual([`${ID(1)}:void`]);
    for (let i = 2; i < 30; i++) queueReport(s, { matchId: ID(i), winner: ID(5) });
    expect(s.ranking.unsent).toHaveLength(RANKING_UNSENT_MAX);
    expect(decodeUnsent(s.ranking.unsent[0])?.matchId).toBe(ID(10));
    removeReport(s, ID(29));
    expect(s.ranking.unsent.some((u) => u.startsWith(ID(29)))).toBe(false);
    expect(decodeUnsent(encodeUnsent({ matchId: ID(3), winner: ID(4) }))).toEqual({ matchId: ID(3), winner: ID(4) });
    expect(decodeUnsent('xyz:void')).toBeNull();
    expect(decodeUnsent(`${ID(3)}:nope`)).toBeNull();
  });

  it('報告する勝者：勝ち → 自分、負け → 相手、無効 → void', () => {
    expect(reportWinner('win', ID(1), ID(2))).toBe(ID(1));
    expect(reportWinner('lose', ID(1), ID(2))).toBe(ID(2));
    expect(reportWinner('void', ID(1), ID(2))).toBe('void');
  });

  it('対戦の後は「かり」。次の更新の後に、正式なレートで上書きして「かり」を消す（1回の更新で1回）', () => {
    const s = base();
    s.rate = 118;
    markProvisional(s);
    expect(s.ranking.provisional).toBe(true);
    const updatedAt = 1_800_000_000_000;
    expect(applyServerRate(s, me(), updatedAt, updatedAt + 5000)).toBe(true);
    expect(s.rate).toBe(150);
    expect(s.rateStats).toEqual({ wins: 3, losses: 1, best: 160 });
    expect(s.ranking.provisional).toBe(false);
    expect(s.ranking.syncedAt).toBe(updatedAt + 5000);
    // その後の対戦（かり）は、次の更新まで上書きしない
    s.rate = 170;
    s.ranking.provisional = true;
    expect(applyServerRate(s, me(), updatedAt, updatedAt + 9000)).toBe(false);
    expect(s.rate).toBe(170);
    // 次の更新が来たら上書き
    expect(applyServerRate(s, me({ rate: 171 }), updatedAt + 86400000, updatedAt + 86400000 + 10)).toBe(true);
    expect(s.rate).toBe(171);
  });

  it('サーバーで1試合も数えていない人・送れていない報告がある人', () => {
    const s = base();
    s.rate = 180; // 前の版で端末だけで上げたレート
    s.ranking.provisional = true;
    expect(applyServerRate(s, me({ wins: 0, losses: 0, rate: 100 }), 10, 20)).toBe(false);
    expect(s.rate).toBe(180);
    expect(applyServerRate(s, null, 10, 20)).toBe(false);
    s.ranking.unsent = [`${ID(1)}:${ID(2)}`];
    expect(applyServerRate(s, me(), 10, 20)).toBe(true);
    // まだ届いていない試合があるので「かり」のまま
    expect(s.ranking.provisional).toBe(true);
  });

  it('次の更新までの残り時間（時:分:秒）・一覧の保存を使える間', () => {
    expect(countdown(10_000 + 3_723_000, 10_000)).toBe('1:02:03');
    expect(countdown(0, 5000)).toBe('0:00:00');
    expect(cacheFresh({ nextAt: 100, playerId: 'a' }, 'a', 99)).toBe(true);
    expect(cacheFresh({ nextAt: 100, playerId: 'a' }, 'a', 100)).toBe(false);
    expect(cacheFresh({ nextAt: 100, playerId: 'a' }, 'b', 50)).toBe(false);
    expect(cacheFresh(null, 'a', 0)).toBe(false);
  });

  it('次の まとめ処理の時刻は、サーバーと同じ（日本時間 4:00）', () => {
    for (const t of [Date.UTC(2026, 9, 3, 18, 59), Date.UTC(2026, 9, 3, 19, 0), Date.UTC(2026, 9, 4, 12, 0), Date.UTC(2026, 11, 31, 19, 30)]) {
      expect(nextBatchAfter(t)).toBe(nextBatchAt(t));
    }
  });

  it('送れなかった報告を送り直す：送れたものは消し、つながらなければ残す（token の誤りは捨てる）', async () => {
    let s: SaveData = { ...base(), playerId: ID(1), ranking: { ...base().ranking, token: 'a'.repeat(32), unsent: [`${ID(10)}:${ID(1)}`, `${ID(11)}:void`, `${ID(12)}:${ID(2)}`] } };
    const update = (fn: (d: SaveData) => void) => {
      const d = structuredClone(s);
      fn(d);
      s = d;
    };
    const statuses = [200, 401, 0];
    const bodies: unknown[] = [];
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)));
      const st = statuses.shift();
      if (!st) throw new Error('offline');
      return new Response(JSON.stringify({ ok: st === 200 }), { status: st });
    });
    await flushReports(() => s, update);
    expect(bodies[0]).toEqual({ matchId: ID(10), playerId: ID(1), token: 'a'.repeat(32), winner: ID(1) });
    // 1つ目は送れた、2つ目は token の誤り（捨てる）、3つ目はつながらない（残す）
    expect(s.ranking.unsent).toEqual([`${ID(12)}:${ID(2)}`]);
    expect(await sendReport({ playerId: ID(1), ranking: { ...s.ranking, token: '' } }, { matchId: ID(1), winner: 'void' })).toBe('retry');
    // 2つ目の 401（token が使えない）の後は token を消している（次に登録し直す）
    expect(s.ranking.token).toBe('');
    // 送るのは「単純なリクエスト」（事前確認が飛ばない：text/plain）
  });

  it('登録：playerId がもう登録されていたら（409）、playerId を作り直して登録し直す', async () => {
    let s: SaveData = { ...base(), playerId: ID(1), ranking: { ...base().ranking, unsent: [`${ID(9)}:void`] } };
    const update = (fn: (d: SaveData) => void) => {
      const d = structuredClone(s);
      fn(d);
      s = d;
    };
    const sent: { body: { playerId: string }; headers: unknown }[] = [];
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      sent.push({ body: JSON.parse(String(init.body)), headers: init.headers });
      return sent.length === 1 ? new Response('{}', { status: 409 }) : new Response(JSON.stringify({ token: 'b'.repeat(32) }), { status: 200 });
    });
    const id = await ensureIdentity(s, update);
    expect(sent[0].body.playerId).toBe(ID(1));
    expect(sent[1].body.playerId).not.toBe(ID(1));
    expect(id).toEqual({ token: 'b'.repeat(32), playerId: sent[1].body.playerId });
    expect(s.playerId).toBe(sent[1].body.playerId);
    expect(s.ranking.token).toBe('b'.repeat(32));
    // 前の playerId の試合の報告は捨てる
    expect(s.ranking.unsent).toEqual([]);
    expect(sent[0].headers).toEqual({ 'content-type': 'text/plain;charset=UTF-8' });
  });

  it('まとめ処理の後にも遊んでいたら、正式なレートで上書きしない（「かり」のまま）', () => {
    const s = base();
    s.rate = 130;
    markProvisional(s, 2000);
    expect(s.ranking.playedAt).toBe(2000);
    expect(applyServerRate(s, me(), 1000, 3000)).toBe(false);
    expect(s.rate).toBe(130);
    expect(applyServerRate(s, me(), 2500, 3000)).toBe(true);
    expect(s.rate).toBe(150);
  });
});
