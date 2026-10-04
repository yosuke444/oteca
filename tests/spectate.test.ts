import { describe, expect, it } from 'vitest';
import { connectLockstep } from '../src/battle/lockstep';
import { isHandHidden } from '../src/battle/spectate';
import { cardName, logLine } from '../src/scenes/Battle/battleText';
import { CpuController } from '../src/controllers/cpu';
import { Match } from '../src/controllers/match';
import { RemoteController } from '../src/controllers/remote';
import { CARD_DB } from '../src/data/cards';
import { hashState } from '../src/engine';
import type { GameEvent, Side } from '../src/engine/types';
import { SPECTATOR_MAX } from '../src/net/session';
import { SpectatorSession, type SpecStart } from '../src/net/spectator';
import { type Peer, pair, settle } from './net.helpers';

/** 観戦（v2.0-J。SPEC §11-10・テスト J08） */

type Side3 = { peer: Peer; match: Match; me: Side };

/** 2人の対戦を進める（CPU 同士。steps 回まで。決着したら止める） */
async function playSome(hub: Awaited<ReturnType<typeof pair>>['hub'], sides: Side3[], pending: (() => void)[], steps: number) {
  for (let i = 0; i < steps; i++) {
    for (const s of sides) s.match.notifyIdle();
    await settle(hub);
    const fn = pending.shift();
    if (!fn) {
      if (sides.every((s) => s.match.state.phase === 'over')) return;
      continue;
    }
    fn();
  }
}

/** 対戦を始めた2人（まだ1手も進めていない） */
async function startedPair() {
  const { hub, clock, a, b } = await pair(11, 12);
  const pending: (() => void)[] = [];
  const sched = (fn: () => void) => {
    pending.push(fn);
    return null;
  };
  const sides: Side3[] = [];
  for (const peer of [a, b]) {
    const g = peer.starts[0];
    const opp: Side = g.me === 'p1' ? 'p2' : 'p1';
    const remote = new RemoteController(opp);
    const cpu = new CpuController(g.me, sched);
    const match = new Match({ seed: g.seed, decks: g.decks, cardDb: CARD_DB }, g.me === 'p1' ? { p1: cpu, p2: remote } : { p1: remote, p2: cpu });
    peer.s.onRemoteAction = (act) => remote.feed(act);
    connectLockstep(match, g.me, {
      sendAction: (act) => peer.s.sendAction(act),
      sendHash: (turn, h) => peer.s.sendHash(turn, h),
      sendResult: (w) => peer.s.sendResult(w),
    });
    sides.push({ peer, match, me: g.me });
  }
  return { hub, clock, a, b, sides, pending };
}

/** 観戦者を部屋に入れる（届いた試合を再現する Match も作る） */
function spectator(hub: Awaited<ReturnType<typeof pair>>['hub'], id: string) {
  const s = new SpectatorSession(hub.create(id), 1);
  const out: { s: SpectatorSession; starts: SpecStart[]; match: Match | null; statuses: string[] } = { s, starts: [], match: null, statuses: [] };
  s.onStatus = (st) => out.statuses.push(st);
  s.onStart = (st) => {
    out.starts.push(st);
    out.match = new Match({ seed: st.seed, decks: st.decks, cardDb: CARD_DB }, { p1: new RemoteController('p1'), p2: new RemoteController('p2') });
  };
  s.onActions = () => {
    if (out.match) s.drain((a) => out.match!.submit(a));
  };
  return out;
}

describe('J08 観戦', () => {
  it('観戦者は、部屋の人（まちあいの一覧）にも、部屋の人数にも入らない。対戦が1つなら、その試合が見える', async () => {
    const { hub, a, b } = await startedPair();
    const sp = spectator(hub, 'spec-1');
    sp.s.join('123456');
    await settle(hub);
    expect(a.s.members.map((m) => m.name).sort()).toEqual(['あ', 'い']);
    expect(b.s.members).toHaveLength(2);
    expect(sp.s.matches).toHaveLength(1);
    expect(Object.values(sp.s.matches[0].names).sort()).toEqual(['あ', 'い']);
  });

  it('対戦の途中から入っても、それまでの操作から今の場面を再現し、そのあとも2人と同じ場面で進む（決着まで）', async () => {
    const { hub, sides, pending, a, b } = await startedPair();
    await playSome(hub, sides, pending, 60);
    expect(sides[0].match.log.length).toBeGreaterThan(5);
    let watching = 0;
    a.s.onSpectators = (n) => (watching = n);
    const sp = spectator(hub, 'spec-2');
    sp.s.join('123456');
    await settle(hub);
    sp.s.watch(sp.s.matches[0]);
    await settle(hub);
    expect(sp.starts).toHaveLength(1);
    expect(watching).toBe(1);
    expect(a.s.spectatorCount).toBe(1);
    expect(b.s.spectatorCount).toBe(1);
    // 途中から：今の場面と同じ
    expect(hashState(sp.match!.state)).toBe(hashState(sides[0].match.state));
    // そのあと決着まで
    await playSome(hub, sides, pending, 20000);
    await settle(hub);
    expect(sides[0].match.state.phase).toBe('over');
    expect(sp.match!.state.phase).toBe('over');
    expect(hashState(sp.match!.state)).toBe(hashState(sides[0].match.state));
    expect(sp.match!.state.winner).toBe(sides[0].match.state.winner);
    expect(sp.s.pending).toBe(0);
  });

  it('2人の操作が届く順番が前後しても、通せる方から通して同じ場面になる', async () => {
    const { hub, sides, pending } = await startedPair();
    await playSome(hub, sides, pending, 120);
    // 届いた操作を、役割ごとにわざと逆の順（p2 → p1）で渡す
    const g = sides[0].peer.starts[0];
    const logs: Record<Side, unknown[]> = { p1: [], p2: [] };
    for (const act of sides[0].match.log) logs[act.player].push(act);
    const m = new Match({ seed: g.seed, decks: g.decks, cardDb: CARD_DB }, { p1: new RemoteController('p1'), p2: new RemoteController('p2') });
    const s = new SpectatorSession(hub.create('spec-x'), 1) as unknown as { logs: Record<Side, unknown[]>; applied: Record<Side, number>; drain: SpectatorSession['drain'] };
    s.logs = { p1: [], p2: [] };
    s.applied = { p1: 0, p2: 0 };
    for (const side of ['p2', 'p1'] as Side[]) s.logs[side] = logs[side].map((a) => ({ ...(a as object), player: undefined }));
    const n = s.drain((a) => m.submit(a));
    expect(n).toBe(sides[0].match.log.length);
    expect(hashState(m.state)).toBe(hashState(sides[0].match.state));
  });

  it(`観戦者は ${SPECTATOR_MAX}人まで（4人目は「かんせんは 3にん まで」）`, async () => {
    const { hub } = await startedPair();
    const sps = [1, 2, 3, 4].map((i) => spectator(hub, `spec-f${i}`));
    for (const sp of sps) {
      sp.s.join('123456');
      await settle(hub);
    }
    expect(SPECTATOR_MAX).toBe(3);
    expect(sps.slice(0, 3).every((sp) => !sp.statuses.includes('full'))).toBe(true);
    expect(sps[3].statuses).toContain('full');
  });

  it('だれもいない部屋では「まだ ひとは いません」、対戦の無い部屋では待つ', async () => {
    const { hub } = await startedPair();
    const sp = spectator(hub, 'spec-e');
    sp.s.join('999999');
    await settle(hub);
    expect(sp.s.state).toBe('empty');
    expect(sp.s.matches).toEqual([]);
  });

  it('観戦のログでは、どちらが山札から選んだカードも名前を出さない（ふつうの対戦では自分の分だけ出す）', async () => {
    const { sides } = await startedPair();
    const st = sides[0].match.state;
    const uids = Object.keys(st.cards);
    const uid = uids[0];
    const name = cardName(st, uid);
    // 山札から選ばせたカード（名前が違うもの）
    const src = uids.find((u) => cardName(st, u) !== name)!;
    const names = { p1: 'あ', p2: 'い' };
    for (const player of ['p1', 'p2'] as Side[]) {
      const e = { type: 'Searched', player, uids: [uid], sourceUid: src } as unknown as GameEvent;
      expect(logLine(e, st, names, 'none')).not.toContain(name);
      expect(logLine(e, st, names, player)).toContain(name);
    }
  });

  it('観戦の画面では、両者の手札は裏向き（枚数だけ）。ふつうの対戦では相手の手札だけ裏', () => {
    expect(isHandHidden('spectate', 'p1', 'p1')).toBe(true);
    expect(isHandHidden('spectate', 'p2', 'p1')).toBe(true);
    expect(isHandHidden('online', 'p1', 'p1')).toBe(false);
    expect(isHandHidden('online', 'p2', 'p1')).toBe(true);
    expect(isHandHidden('cpu', 'p1', 'p1')).toBe(false);
  });
});
