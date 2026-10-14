import { afterEach, describe, expect, it, vi } from 'vitest';
import { LOBBY_CONNECT_MS, RateSearch, type SocketLike } from '../src/net/matchmaker';
import { RATE_SUBROOMS, rateLobbyName } from '../src/net/protocol';
import { RateLobby, type RatePaired, SUBROOM_HOP_MS } from '../src/net/rateLobby';
import { MemoryHub } from '../src/net/transport';
import { applyServerRate, cacheFresh, countdown, decodeUnsent, encodeUnsent, markProvisional, queueReport, removeReport, reportWinner, type ServerMe } from '../src/online/ranking';
import { ensureIdentity, flushReports, forgetRegistration, nextBatchAfter, sendReport, syncRanking } from '../src/online/rankingApi';
import { nextBatchAt } from '../worker/src/logic/batch';
import { RANKING_UNSENT_MAX, type SaveData, createDefaultSave } from '../src/save/saveData';
import { FakeClock, settle } from './net.helpers';
import { makeRandom } from './save.helpers';

/** 16桁の16進数（試合ID・部屋ID・playerId） */
const ID = (n: number) => n.toString(16).padStart(16, '0');
/** ユーザーID（15桁。v2.0-J） */
const UID = (n: number) => String(100000000000000 + n);

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

  it('⑤ 予備の待合所でも、待っているのが2人だけなら直前の相手どうしで組む（v2.7）', async () => {
    const hub = new MemoryHub();
    const clock = new FakeClock();
    const mk = (tr: ReturnType<MemoryHub['create']>, me: number, last: number) => {
      const l = new RateLobby(tr, { playerId: ID(me), name: 'x', rate: 100, lastOpponentId: ID(last), protocol: 6, clock, randomBytes: (k) => (k === 1 ? new Uint8Array([2]) : new Uint8Array(k).fill(me)) });
      const paired: RatePaired[] = [];
      l.onPaired = (x) => paired.push(x);
      return { l, paired };
    };
    const a = mk(hub.create('x1'), 1, 2);
    const b = mk(hub.create('x2'), 2, 1);
    a.l.join();
    b.l.join();
    await run(hub, clock, 5000, () => a.paired.length > 0 && b.paired.length > 0);
    expect(a.paired[0]?.roomId).toBe(b.paired[0]?.roomId);
    expect(a.paired[0].opponentId).toBe(ID(2));
    a.l.leave();
    b.l.leave();
  });

  it('⑥ 3人以上いる時は、今までどおり直前の相手を避ける', async () => {
    const hub = new MemoryHub();
    const clock = new FakeClock();
    const mk = (id: string, me: number, last: number) => {
      const l = new RateLobby(hub.create(id), { playerId: ID(me), name: 'x', rate: 100, lastOpponentId: ID(last), protocol: 6, clock, randomBytes: (k) => (k === 1 ? new Uint8Array([2]) : new Uint8Array(k).fill(me)) });
      const paired: RatePaired[] = [];
      l.onPaired = (x) => {
        paired.push(x);
        l.leave();
      };
      return { l, paired };
    };
    // a の直前の相手は b。c も a と対戦したばかり。3人いるので、a は b とも c とも組まず、b と c が組む
    const a = mk('y1', 1, 2);
    const b = mk('y2', 2, 1);
    const c = mk('y3', 3, 1);
    a.l.join();
    clock.advance(10);
    b.l.join();
    clock.advance(10);
    c.l.join();
    await run(hub, clock, 5000, () => b.paired.length > 0 && c.paired.length > 0);
    expect(b.paired[0]?.roomId).toBe(c.paired[0]?.roomId);
    expect(b.paired[0].opponentId).toBe(ID(3));
    expect(a.paired).toEqual([]);
    a.l.leave();
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
    expect(sock.sent[0]).toEqual({ t: 'join', body: { userId: ID(1), protocol: 6, lastOpponentId: ID(9), name: 'あ', rate: 120 } });
    sock.recv({ t: 'waiting', body: { count: 3 } });
    expect(got.waiting).toEqual([3]);
    // K09（v2.2）：両者の正式なレートとトロフィあげの数も届く
    sock.recv({ t: 'paired', body: { matchId: ID(77), roomId: ID(88), me: { rate: 111, trophies: 7 }, opponent: { userId: UID(2), name: 'い', rate: 130, trophies: 2 } } });
    expect(got.paired).toEqual([{ roomId: ID(88), matchId: ID(77), viaLobby: true, opponentId: UID(2), opponentName: 'い', opponentRate: 130, opponentTrophies: 2, me: { rate: 111, trophies: 7 } }]);
    expect(sock.closed).toBe(true);
    // 組めた後に切れても、予備へは行かない
    sock.drop();
    expect(got.fallback).toBe(0);
  });

  it('⑥ 受付係が「版が古い」と断ったら（version・4002）、予備の待合所へは行かずに知らせる（v2.7）', () => {
    for (const how of ['error', 'close'] as const) {
      const { s, sock, got, lobbies } = make();
      let version = 0;
      s.onVersion = () => (version += 1);
      s.join();
      sock.open();
      if (how === 'error') sock.recv({ t: 'error', body: { reason: 'version' } });
      sock.drop(4002);
      expect(version, how).toBe(1);
      expect(got.fallback, how).toBe(0);
      expect(lobbies, how).toHaveLength(0);
    }
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
    const p: RatePaired = { roomId: ID(5), matchId: ID(5), viaLobby: false, opponentId: ID(3), opponentName: 'う', opponentRate: 90, opponentTrophies: 2, me: { rate: 100, trophies: 0 } };
    lobbies[0].l.onPaired(p);
    expect(got.paired).toEqual([p]);
    expect(lobbies[0].left).toBe(true);
  });
});

describe('I05 端末のランキング（かりのレート・報告・上書き）', () => {
  const base = () => createDefaultSave();
  const me = (x: Partial<ServerMe> = {}): ServerMe => ({ rate: 150, wins: 3, losses: 1, best: 160, rank: 2, visible: true, name: '', optIn: true, ...x });

  afterEach(() => {
    vi.unstubAllGlobals();
    forgetRegistration();
  });

  it('新しいセーブ：名前を載せる設定はオン、「かり」ではない', () => {
    const s = base();
    expect(s.ranking).toEqual({ token: '', optIn: true, unsent: [], provisional: false, syncedAt: 0, playedAt: 0, lastMatchId: '' });
  });

  it('報告をセーブに入れる・消す（同じ試合は1つ、多すぎたら古いものから）', () => {
    const s = base();
    queueReport(s, { matchId: ID(1), winner: UID(5) });
    queueReport(s, { matchId: ID(1), winner: 'void' });
    expect(s.ranking.unsent).toEqual([`${ID(1)}:void`]);
    for (let i = 2; i < 30; i++) queueReport(s, { matchId: ID(i), winner: UID(5) });
    expect(s.ranking.unsent).toHaveLength(RANKING_UNSENT_MAX);
    expect(decodeUnsent(s.ranking.unsent[0])?.matchId).toBe(ID(10));
    removeReport(s, ID(29));
    expect(s.ranking.unsent.some((u) => u.startsWith(ID(29)))).toBe(false);
    expect(decodeUnsent(encodeUnsent({ matchId: ID(3), winner: UID(4) }))).toEqual({ matchId: ID(3), winner: UID(4) });
    // 勝った人が前の playerId（16進数）のものは読まない
    expect(decodeUnsent(`${ID(3)}:${ID(4)}`)).toBeNull();
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
    s.ranking.unsent = [`${ID(1)}:${UID(2)}`];
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

  it('K07 次の まとめ処理の時刻は、日本時間 4:00 と 16:00 の近い方（端末とサーバーで同じ関数）', () => {
    expect(nextBatchAfter(Date.UTC(2026, 9, 3, 18, 59))).toBe(Date.UTC(2026, 9, 3, 19, 0)); // 3:59 → 4:00
    expect(nextBatchAfter(Date.UTC(2026, 9, 3, 19, 0))).toBe(Date.UTC(2026, 9, 4, 7, 0)); // 4:00 → 16:00
    expect(nextBatchAfter(Date.UTC(2026, 9, 4, 5, 0))).toBe(Date.UTC(2026, 9, 4, 7, 0)); // 14:00 は もう更新ではない
    expect(nextBatchAfter(Date.UTC(2026, 9, 4, 6, 59))).toBe(Date.UTC(2026, 9, 4, 7, 0)); // 15:59 → 16:00
    expect(nextBatchAfter(Date.UTC(2026, 9, 4, 7, 0))).toBe(Date.UTC(2026, 9, 4, 19, 0)); // 16:00 → 次の日の 4:00
    expect(nextBatchAfter(Date.UTC(2026, 11, 31, 10, 0))).toBe(Date.UTC(2026, 11, 31, 19, 0)); // 年をまたぐ
    expect(nextBatchAfter).toBeTypeOf('function');
    expect(nextBatchAt(1)).toBe(nextBatchAfter(1));
  });

  it('更新の直前（10分＋1分以内）に終わった試合は、まだ数えられていないかもしれないので上書きしない', () => {
    const s = base();
    const updatedAt = Date.UTC(2026, 9, 4, 7, 0); // 16:00
    s.rate = 140;
    markProvisional(s, updatedAt - 5 * 60 * 1000); // 15:55 に終わった（相手が切れて片方だけの報告かもしれない）
    expect(applyServerRate(s, me(), updatedAt, updatedAt + 1000)).toBe(false);
    expect(s.ranking.provisional).toBe(true);
    markProvisional(s, updatedAt - 12 * 60 * 1000); // 15:48：数えられている
    expect(applyServerRate(s, me(), updatedAt, updatedAt + 1000)).toBe(true);
  });

  it('送れなかった報告を送り直す：送れたものは消し、つながらなければ残す（token の誤りは捨てる）', async () => {
    let s: SaveData = { ...base(), userId: UID(1), userIdRegistered: true, ranking: { ...base().ranking, token: 'a'.repeat(32), unsent: [`${ID(10)}:${UID(1)}`, `${ID(11)}:void`, `${ID(12)}:${UID(2)}`] } };
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
    expect(bodies[0]).toEqual({ matchId: ID(10), userId: UID(1), token: 'a'.repeat(32), winner: UID(1) });
    // 1つ目は送れた、2つ目はサーバーに行が無い（登録し直しもつながらないので捨てる）、3つ目は送らずに残す
    expect(s.ranking.unsent).toEqual([`${ID(12)}:${UID(2)}`]);
    expect(await sendReport({ userId: UID(1), ranking: { ...s.ranking, token: '' } }, { matchId: ID(1), winner: 'void' })).toBe('retry');
    // 2つ目の 401（サーバーに自分の行が無い）は、同じユーザーID と token で登録し直す（ここではつながらないので、その報告は捨てる）。
    // ユーザーID・token・登録の印は変えない
    expect(bodies[2]).toMatchObject({ userId: UID(1), token: 'a'.repeat(32) });
    expect(s.userIdRegistered).toBe(true);
    expect(s.userId).toBe(UID(1));
    expect(s.ranking.token).toBe('a'.repeat(32));
    // 送るのは「単純なリクエスト」（事前確認が飛ばない：text/plain）
  });

  it('J01 登録：ユーザーID がほかの人に使われていたら（409）、登録の前だけ作り直して登録し直す', async () => {
    let s: SaveData = { ...base(), userId: UID(1), ranking: { ...base().ranking, token: 'e'.repeat(32), unsent: [`${ID(9)}:void`] } };
    const update = (fn: (d: SaveData) => void) => {
      const d = structuredClone(s);
      fn(d);
      s = d;
    };
    const sent: { body: { userId: string; token: string; legacyPlayerId?: string }; headers: unknown }[] = [];
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      sent.push({ body: JSON.parse(String(init.body)), headers: init.headers });
      return sent.length === 1 ? new Response('{}', { status: 409 }) : new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
    const id = await ensureIdentity(s, update);
    expect(sent[0].body.userId).toBe(UID(1));
    expect(sent[1].body.userId).not.toBe(UID(1));
    expect(sent[1].body.userId).toMatch(/^[1-9][0-9]{14}$/);
    // token は起動の時に作ってセーブに入れてある（送り直しても同じ）
    expect(sent[0].body.token).toBe('e'.repeat(32));
    expect(sent[1].body.token).toBe(sent[0].body.token);
    expect(id).toEqual({ token: sent[0].body.token, userId: sent[1].body.userId });
    expect(s.userId).toBe(sent[1].body.userId);
    expect(s.userIdRegistered).toBe(true);
    expect(s.ranking.token).toBe(sent[0].body.token);
    // 前のユーザーID の送れなかった報告は捨てる
    expect(s.ranking.unsent).toEqual([]);
    expect(sent[0].headers).toEqual({ 'content-type': 'text/plain;charset=UTF-8' });
    // 登録した後は、もうサーバーに聞かない・ユーザーID を変えない
    const before = sent.length;
    expect(await ensureIdentity(s, update)).toEqual(id);
    expect(sent.length).toBe(before);
  });

  it('J02 今までの人（v2.0-I で token をもらった人）は、playerId も送って付け替えてもらう', async () => {
    let s: SaveData = { ...base(), playerId: ID(7), userId: UID(3), ranking: { ...base().ranking, token: 'c'.repeat(32) } };
    const update = (fn: (d: SaveData) => void) => {
      const d = structuredClone(s);
      fn(d);
      s = d;
    };
    const sent: Record<string, unknown>[] = [];
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      sent.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify({ ok: true, migrated: true }), { status: 200 });
    });
    expect(await ensureIdentity(s, update)).toEqual({ token: 'c'.repeat(32), userId: UID(3) });
    expect(sent[0]).toMatchObject({ userId: UID(3), token: 'c'.repeat(32), legacyPlayerId: ID(7) });
    expect(s.userIdRegistered).toBe(true);
  });

  it('つながらない時は登録しない（ユーザーID も変えない）', async () => {
    let s: SaveData = { ...base(), userId: UID(4), ranking: { ...base().ranking, token: 'f'.repeat(32) } };
    vi.stubGlobal('fetch', async () => {
      throw new Error('offline');
    });
    expect(await ensureIdentity(s, (fn) => fn(s))).toBeNull();
    expect(s.userId).toBe(UID(4));
    expect(s.userIdRegistered).toBe(false);
  });

  it('J01 登録の直後に古いセーブで聞かれても（画面の描き直しの前）、登録は1回だけで、ユーザーID は変わらない', async () => {
    // 送れなかった報告がある、まだ登録していない人
    const stale: SaveData = { ...base(), userId: UID(5), ranking: { ...base().ranking, token: 'd'.repeat(32), unsent: [`${ID(30)}:void`] } };
    let s = structuredClone(stale);
    const update = (fn: (d: SaveData) => void) => {
      const d = structuredClone(s);
      fn(d);
      s = d;
    };
    const paths: string[] = [];
    vi.stubGlobal('fetch', async (url: string) => {
      paths.push(new URL(url).pathname);
      return new Response(JSON.stringify({ ok: true, me: null, updatedAt: 0, nextAt: 0 }), { status: 200 });
    });
    // getSave はずっと古いセーブを返す（React の描き直しの前）
    await Promise.all([syncRanking(() => stale, update), ensureIdentity(stale, update), ensureIdentity(stale, update)]);
    expect(paths.filter((p) => p === '/register')).toHaveLength(1);
    expect(s.userId).toBe(UID(5));
    expect(s.userIdRegistered).toBe(true);
    // 報告も送った（ユーザーID を作り直して捨てたりしない）
    expect(paths).toContain('/result');
    expect(s.ranking.unsent).toEqual([]);
  });

  it('登録した後は、サーバーが 401（自分の行が無い）でもユーザーID を変えずに登録し直す', async () => {
    let s: SaveData = { ...base(), userId: UID(6), userIdRegistered: true, ranking: { ...base().ranking, token: 'b'.repeat(32), unsent: [`${ID(31)}:void`] } };
    const update = (fn: (d: SaveData) => void) => {
      const d = structuredClone(s);
      fn(d);
      s = d;
    };
    const calls: { path: string; body: { userId?: string } }[] = [];
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      const path = new URL(url).pathname;
      calls.push({ path, body: JSON.parse(String(init.body)) });
      if (path === '/result') return new Response('{}', { status: 401 });
      // ほかの人が使っている（409）：作り直さない
      return new Response('{}', { status: 409 });
    });
    await flushReports(() => s, update);
    expect(calls.map((c) => c.path)).toEqual(['/result', '/register']);
    expect(calls[1].body.userId).toBe(UID(6));
    expect(s.userId).toBe(UID(6));
  });

  it('サーバーが「最後に数えた試合」が自分の最後の試合と同じと言えば、更新の直後でも上書きする', () => {
    const s = base();
    const updatedAt = Date.UTC(2026, 9, 4, 5, 0);
    s.rate = 140;
    markProvisional(s, updatedAt - 60 * 1000, ID(42)); // 13:59 に終わった試合
    expect(applyServerRate(s, { ...me(), lastMatch: ID(41) }, updatedAt, updatedAt + 1000)).toBe(false);
    expect(applyServerRate(s, { ...me(), lastMatch: ID(42) }, updatedAt, updatedAt + 1000)).toBe(true);
    expect(s.rate).toBe(150);
  });

  it('まとめ処理の後にも遊んでいたら、正式なレートで上書きしない（「かり」のまま）', () => {
    const s = base();
    s.rate = 130;
    const MIN = 60 * 1000;
    markProvisional(s, 100 * MIN);
    expect(s.ranking.playedAt).toBe(100 * MIN);
    // 更新（90分）の後に遊んだ：上書きしない
    expect(applyServerRate(s, me(), 90 * MIN, 120 * MIN)).toBe(false);
    expect(s.rate).toBe(130);
    // 遊んだ20分後の更新：上書きする
    expect(applyServerRate(s, me(), 120 * MIN, 121 * MIN)).toBe(true);
    expect(s.rate).toBe(150);
  });
});
