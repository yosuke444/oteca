import { describe, expect, it } from 'vitest';
import type { Action } from '../src/engine/types';
import { INVITE_MS, PICK_AFTER_MS, ROOM_MAX, type InviteState } from '../src/net/session';
import { MemoryHub } from '../src/net/transport';
import { FakeClock, type Peer, makePeer, matchUp, settle } from './net.helpers';

/** 部屋に n 人を入れる（チケットの順＝並びの順） */
async function room(n: number, roomNo = '424242') {
  const hub = new MemoryHub();
  const clock = new FakeClock();
  const peers: (Peer & { invites: InviteState[]; got: Action[]; backs: number })[] = [];
  for (let i = 0; i < n; i++) {
    const p = makePeer(hub, clock, `peer-${String.fromCharCode(97 + i)}`, { name: `人${i + 1}`, seed: i + 11 });
    const q = Object.assign(p, { invites: [] as InviteState[], got: [] as Action[], backs: 0 });
    q.s.onInvite = (s) => q.invites.push(s);
    q.s.onRemoteAction = (a) => q.got.push(a);
    q.s.onOpponentBack = () => (q.backs += 1);
    peers.push(q);
    q.s.join(roomNo);
    clock.advance(5);
  }
  await matchUp(hub, clock);
  return { hub, clock, peers };
}

const idOf = (p: Peer) => p.s.selfId;

describe('R03 部屋の まちあい と申し込み（v2.0-G。UPDATE_v2 §8-2）', () => {
  it('3〜4人で、全員の一覧（名前・まちあい）がそろう。自動では始まらない', async () => {
    const { peers } = await room(4);
    for (const p of peers) {
      expect(p.s.members.map((m) => m.name)).toEqual(['人1', '人2', '人3', '人4']);
      expect(p.s.members.every((m) => m.state === 'waiting')).toBe(true);
      expect(p.starts).toHaveLength(0);
    }
  });

  it('申し込み → あそぶ で2人の対戦が始まり、ほかの人には たいせんちゅう と出る', async () => {
    const { hub, peers } = await room(3);
    const [a, b, c] = peers;
    expect(a.s.inviteTo(idOf(b))).toBe(true);
    await settle(hub);
    expect(b.invites.at(-1)).toMatchObject({ kind: 'received', from: idOf(a), name: '人1' });
    expect(a.invites.at(-1)).toMatchObject({ kind: 'sent', to: idOf(b) });
    b.s.answerInvite(true);
    await settle(hub);
    expect(a.starts).toHaveLength(1);
    expect(b.starts).toHaveLength(1);
    expect(a.starts[0].seed).toBe(b.starts[0].seed);
    expect(c.starts).toHaveLength(0);
    const states = Object.fromEntries(c.s.members.map((m) => [m.name, m.state]));
    expect(states).toEqual({ 人1: 'playing', 人2: 'playing', 人3: 'waiting' });
  });

  it('4人で2試合が同時に進み、操作は対戦相手にだけ届く', async () => {
    const { hub, peers } = await room(4);
    const [a, b, c, d] = peers;
    a.s.inviteTo(idOf(b));
    c.s.inviteTo(idOf(d));
    await settle(hub);
    b.s.answerInvite(true);
    d.s.answerInvite(true);
    await settle(hub);
    for (const p of peers) expect(p.starts).toHaveLength(1);
    expect(a.starts[0].seed).toBe(b.starts[0].seed);
    expect(c.starts[0].seed).toBe(d.starts[0].seed);
    expect(a.starts[0].seed).not.toBe(c.starts[0].seed);
    a.s.sendAction({ type: 'END_TURN', player: a.starts[0].me });
    c.s.sendAction({ type: 'SURRENDER', player: c.starts[0].me });
    await settle(hub);
    expect(b.got.map((x) => x.type)).toEqual(['END_TURN']);
    expect(d.got.map((x) => x.type)).toEqual(['SURRENDER']);
    expect(a.got).toEqual([]);
    expect(c.got).toEqual([]);
  });

  it('いまは やめとく → 申し込んだ人に「ことわられた」。だれも始まらない', async () => {
    const { hub, peers } = await room(3);
    const [a, b] = peers;
    a.s.inviteTo(idOf(b));
    await settle(hub);
    b.s.answerInvite(false);
    await settle(hub);
    expect(a.invites.at(-1)).toMatchObject({ kind: 'declined', name: '人2' });
    expect(peers.every((p) => p.starts.length === 0)).toBe(true);
  });

  it('とりけす・15秒の時間切れ で申し込みが消える。時間切れの後に あそぶ を押しても始まらない', async () => {
    const { hub, clock, peers } = await room(3);
    const [a, b, c] = peers;
    a.s.inviteTo(idOf(b));
    await settle(hub);
    a.s.cancelInvite();
    await settle(hub);
    expect(b.invites.at(-1)).toMatchObject({ kind: 'expired' });
    // 時間切れ
    c.s.inviteTo(idOf(b));
    await settle(hub);
    expect(b.invites.at(-1)).toMatchObject({ kind: 'received', from: idOf(c) });
    clock.advance(INVITE_MS + 300);
    await settle(hub);
    expect(c.invites.at(-1)?.kind === 'expired' || b.invites.at(-1)?.kind === 'none').toBe(true);
    b.s.answerInvite(true); // もう消えている
    await settle(hub);
    expect(peers.every((p) => p.starts.length === 0)).toBe(true);
  });

  it('申し込み中・申し込まれ中の人への申し込みは、自動で ことわられる', async () => {
    const { hub, peers } = await room(3);
    const [a, b, c] = peers;
    a.s.inviteTo(idOf(b));
    await settle(hub);
    c.s.inviteTo(idOf(b));
    await settle(hub);
    expect(c.invites.at(-1)).toMatchObject({ kind: 'declined' });
    b.s.answerInvite(true);
    await settle(hub);
    expect(a.starts).toHaveLength(1);
    expect(b.starts).toHaveLength(1);
    expect(c.starts).toHaveLength(0);
  });

  it('「ほかの ひとと あそぶ」：相手も まちあい に戻り、相手に知らせが届く。そのあと別の人と組める（試合の番号は前より大きい）', async () => {
    const { hub, peers } = await room(3);
    const [a, b, c] = peers;
    a.s.inviteTo(idOf(b));
    await settle(hub);
    b.s.answerInvite(true);
    await settle(hub);
    expect(a.s.othersWaiting).toBe(true);
    a.s.backToRoom();
    await settle(hub);
    expect(a.s.status.kind).toBe('waiting');
    expect(b.s.status.kind).toBe('waiting');
    expect(b.backs).toBe(1);
    expect(c.s.members.every((m) => m.state === 'waiting')).toBe(true);
    a.s.inviteTo(idOf(c));
    await settle(hub);
    c.s.answerInvite(true);
    await settle(hub);
    expect(a.starts).toHaveLength(2);
    expect(c.starts).toHaveLength(1);
    expect(a.starts[1].seed).toBe(c.starts[0].seed);
    expect(a.starts[1].game).toBeGreaterThan(a.starts[0].game);
  });

  it(`部屋は ${ROOM_MAX}人まで。${ROOM_MAX + 1}人目は「まんいん」`, async () => {
    const { peers } = await room(ROOM_MAX + 1);
    expect(peers.slice(0, ROOM_MAX).every((p) => !p.statuses.includes('full'))).toBe(true);
    expect(peers[ROOM_MAX].statuses).toContain('full');
  });

  it('3人の部屋から1人出ていって2人になり、2人とも まちあい なら自動で始まる', async () => {
    const { hub, clock, peers } = await room(3);
    const [a, b, c] = peers;
    c.s.leave();
    await settle(hub);
    clock.advance(PICK_AFTER_MS + 300);
    await settle(hub);
    expect(a.starts).toHaveLength(1);
    expect(b.starts).toHaveLength(1);
  });

  it('人の出入りを知らせる', async () => {
    const { hub, peers } = await room(3);
    const notes: string[] = [];
    peers[0].s.onJoinLeave = (e) => notes.push(`${e.kind}:${e.name}`);
    peers[2].s.leave();
    await settle(hub);
    expect(notes).toEqual(['leave:人3']);
  });

  it('対戦の始めに、同じ相手との再戦で相手がデッキを変えたか分かる', async () => {
    const { hub, peers } = await room(2);
    const [a, b] = peers;
    expect(a.starts).toHaveLength(1);
    expect(a.starts[0].oppDeckChanged).toBe(false);
    expect(a.starts[0].oppPlayerId).toBe('player-peer-b');
    b.s.setDeck([1, 1, 1, 2, 2, 2, 3, 3, 3, 9, 9, 10, 10, 1, 2], 'あたらしい');
    a.s.requestRematch();
    b.s.requestRematch();
    await settle(hub);
    expect(a.starts).toHaveLength(2);
    expect(a.starts[1].oppDeckChanged).toBe(true);
    expect(b.starts[1].oppDeckChanged).toBe(false);
  });

  it('申し込みが行き違っても（2人が同時に申し込む）、ことわられずに2人の対戦が始まる', async () => {
    const { hub, peers } = await room(3);
    const [a, b] = peers;
    a.s.inviteTo(idOf(b));
    b.s.inviteTo(idOf(a));
    await settle(hub);
    expect(a.starts).toHaveLength(1);
    expect(b.starts).toHaveLength(1);
    expect(a.invites.some((x) => x.kind === 'declined')).toBe(false);
    expect(b.invites.some((x) => x.kind === 'declined')).toBe(false);
  });

  it('組み合わせ（pairStart）が届かなくても、相手の deck が届けば始まる', async () => {
    const { hub, peers } = await room(3);
    const [a, b] = peers;
    // b への pairStart だけ落とす
    const send = a.t.send.bind(a.t);
    a.t.send = (m, to) => {
      if (m.t === 'pairStart') return;
      send(m, to);
    };
    a.s.inviteTo(idOf(b));
    await settle(hub);
    b.s.answerInvite(true);
    await settle(hub);
    expect(a.starts).toHaveLength(1);
    expect(b.starts).toHaveLength(1);
    expect(a.starts[0].seed).toBe(b.starts[0].seed);
  });

  it('2人が同時に「ほかの ひとと あそぶ」を押しても、次に組んだ時に古い back で止まらない', async () => {
    const { hub, peers } = await room(3);
    const [a, b] = peers;
    a.s.inviteTo(idOf(b));
    await settle(hub);
    b.s.answerInvite(true);
    await settle(hub);
    a.s.backToRoom();
    b.s.backToRoom();
    await settle(hub);
    expect(a.s.status.kind).toBe('waiting');
    expect(b.s.status.kind).toBe('waiting');
    a.s.inviteTo(idOf(b));
    await settle(hub);
    b.s.answerInvite(true);
    await settle(hub);
    expect(a.starts).toHaveLength(2);
    expect(b.starts).toHaveLength(2);
    expect(a.s.status.kind).toBe('playing');
    expect(b.s.status.kind).toBe('playing');
  });

  it('3人以上の部屋で相手が部屋を出ても、自分は部屋に残って まちあい に戻る', async () => {
    const { hub, peers } = await room(3);
    const [a, b, c] = peers;
    a.s.inviteTo(idOf(b));
    await settle(hub);
    b.s.answerInvite(true);
    await settle(hub);
    b.s.leave();
    await settle(hub);
    expect(a.statuses).not.toContain('aborted');
    expect(a.s.status.kind).toBe('waiting');
    expect(a.backs).toBe(1);
    expect(a.s.members.map((m) => m.name)).toEqual(['人1', '人3']);
    void c;
  });
});
