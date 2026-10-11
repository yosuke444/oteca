import { describe, expect, it } from 'vitest';
import { makeMsg } from '../src/net/protocol';
import { LOST_AFTER_MS, PICK_AFTER_MS, WAITING_AFTER_MS } from '../src/net/session';
import { MemoryHub } from '../src/net/transport';
import { FakeClock, type Peer, makePeer, matchUp, pair, settle } from './net.helpers';

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

  it('（v2.0-G）対戦中の2人の部屋に3人目が来ても まんいん にならず、まちあい で入る。2人の対戦は続く', async () => {
    const { hub, clock, a, b } = await pair();
    const c = makePeer(hub, clock, 'peer-0'); // ID は一番小さいが、チケットが遅い
    clock.advance(10);
    c.s.join('123456');
    await matchUp(hub, clock);
    expect(c.statuses).not.toContain('full');
    expect(c.s.status.kind).toBe('waiting');
    expect(c.starts).toHaveLength(0);
    expect(a.s.status.kind).toBe('playing');
    expect(b.s.status.kind).toBe('playing');
    // 3人目から見ると、2人は たいせんちゅう
    expect(c.s.members.filter((m) => !m.me).map((m) => m.state)).toEqual(['playing', 'playing']);
  });

  it('（v2.0-G）3人がほぼ同時に入ると、自動では始まらない（申し込みで決める）', async () => {
    const hub = new MemoryHub();
    const clock = new FakeClock();
    const peers = ['peer-x', 'peer-y', 'peer-z'].map((id, i) => makePeer(hub, clock, id, { seed: i + 5 }));
    peers[1].s.join('999999');
    clock.advance(1);
    peers[2].s.join('999999');
    clock.advance(1);
    peers[0].s.join('999999');
    await matchUp(hub, clock);
    for (const p of peers) {
      expect(p.starts).toHaveLength(0);
      expect(p.s.status.kind).toBe('waiting');
      expect(p.s.members).toHaveLength(3);
    }
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

describe('オンライン：ロックステップ（SPEC §11-3、§11-6）', () => {
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
  /** 「まっています」になる時まで、見張りの間隔ずつ進める */
  async function untilWaiting(hub: Parameters<typeof settle>[0], clock: { advance: (ms: number) => void }, conn: string[]) {
    for (let i = 0; i < 200 && conn.at(-1) !== 'waiting'; i++) {
      clock.advance(250);
      await settle(hub);
    }
  }
  it('D01 6秒 返事が無いと「まっています」（残り秒数）。そこから29秒でつながり直すと、送り直して続く（v2.4）', async () => {
    const { hub, clock, a, b } = await pair();
    const got: string[] = [];
    b.s.onRemoteAction = (act) => got.push(act.type);
    const bRecv = b.t.onMessage;
    b.t.onMessage = () => {};
    const aRecv = a.t.onMessage;
    a.t.onMessage = () => {};
    a.s.sendAction({ type: 'PLACE_BENCH', player: 'p1', uid: 'p1-1' });
    a.s.sendAction({ type: 'END_TURN', player: 'p1' });
    expect(a.s.lostInSeconds).toBeNull();
    clock.advance(WAITING_AFTER_MS - 500);
    await settle(hub);
    expect(a.conn).not.toContain('waiting');
    await untilWaiting(hub, clock, a.conn);
    expect(a.conn.at(-1)).toBe('waiting');
    expect(a.s.lostInSeconds).toBe(30);
    clock.advance(LOST_AFTER_MS - 1000);
    await settle(hub);
    // 29秒：まだ「きれた」にならない（残り1秒）
    expect(a.conn.at(-1)).toBe('waiting');
    expect(a.conn).not.toContain('lost');
    expect(a.s.lostInSeconds).toBe(1);
    // つながり直す
    b.t.onMessage = bRecv;
    a.t.onMessage = aRecv;
    clock.advance(500);
    await settle(hub);
    clock.advance(3000);
    await settle(hub);
    expect(a.conn.at(-1)).toBe('ok');
    expect(b.conn.at(-1)).toBe('ok');
    expect(a.conn).not.toContain('lost');
    expect(a.s.lostInSeconds).toBeNull();
    expect(got).toEqual(['PLACE_BENCH', 'END_TURN']);
  });

  it('D02 「まっています」になってから30秒で「きれた」。そのあと戻ってきても送り直して ok に戻る', async () => {
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
    await untilWaiting(hub, clock, a.conn);
    expect(a.conn).toContain('waiting');
    clock.advance(LOST_AFTER_MS - 1000);
    await settle(hub);
    expect(a.conn.at(-1)).toBe('waiting');
    clock.advance(1000);
    await settle(hub);
    expect(a.conn.at(-1)).toBe('lost');
    expect(a.s.lostInSeconds).toBe(0);
    clock.advance(1000);
    await settle(hub);
    expect(b.conn.at(-1)).toBe('lost');
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

describe('オンライン：切れている間に送ったハッシュ・結果（SPEC §11-6、§11-7）', () => {
  /** a と b の間の通信を切る。戻す関数を返す */
  function cut(a: Peer, b: Peer) {
    const [ra, rb] = [a.t.onMessage, b.t.onMessage];
    a.t.onMessage = () => {};
    b.t.onMessage = () => {};
    return () => {
      a.t.onMessage = ra;
      b.t.onMessage = rb;
    };
  }

  it('切れている間のターン終わりのハッシュも、戻った時に送り直されて、ずれに両方が気づく', async () => {
    const { hub, clock, a, b } = await pair();
    const restore = cut(a, b);
    a.s.sendHash(1, 'aaaaaaaa');
    b.s.sendHash(1, 'bbbbbbbb');
    clock.advance(WAITING_AFTER_MS + 1000);
    await settle(hub);
    expect(a.desync).toEqual([]);
    restore();
    clock.advance(3500);
    await settle(hub);
    expect(a.desync).toEqual([1]);
    expect(b.desync).toEqual([1]);
  });

  it('決着の結果を送り合い、そろった時だけ「そろった」と知らせる（同時に降参して食い違った時は記録しない）', async () => {
    const x = await pair();
    const got: boolean[][] = [[], []];
    x.a.s.onResult = (v) => got[0].push(v);
    x.b.s.onResult = (v) => got[1].push(v);
    x.a.s.sendResult('p2');
    x.b.s.sendResult('p2');
    await settle(x.hub);
    expect(got).toEqual([[true], [true]]);

    const y = await pair(5, 6);
    const got2: boolean[] = [];
    y.a.s.onResult = (v) => got2.push(v);
    y.b.s.onResult = (v) => got2.push(v);
    y.a.s.sendResult('p2'); // a は「自分の降参で p2 の勝ち」
    y.b.s.sendResult('p1'); // b は「自分の降参で p1 の勝ち」
    await settle(y.hub);
    expect(got2).toEqual([false, false]);
  });

  it('deck より先に reveal が届いても、種を決めて始まる', async () => {
    const hub = new MemoryHub();
    const clock = new FakeClock();
    const a = makePeer(hub, clock, 'peer-a');
    const b = makePeer(hub, clock, 'peer-b');
    // b の deck だけ、b の reveal より後に届くようにする
    const send = b.t.send.bind(b.t);
    let heldDeck: Parameters<typeof send> | null = null;
    b.t.send = (m, to) => {
      if (m.t === 'deck' && !heldDeck) {
        heldDeck = [m, to];
        return;
      }
      send(m, to);
      if (m.t === 'reveal' && heldDeck) send(...heldDeck);
    };
    a.s.join('3333');
    b.s.join('3333');
    await matchUp(hub, clock);
    expect(a.starts).toHaveLength(1);
    expect(b.starts).toHaveLength(1);
    expect(a.starts[0].seed).toBe(b.starts[0].seed);
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
