import { describe, expect, it } from 'vitest';
import { applyAction, hashState } from '../src/engine';
import type { Action, GameEvent, GameState } from '../src/engine/types';
import { arrange, deckOf, eventsOf, forceDice, ok, patchCard, startMain, type Layout } from './helpers';

/**
 * v2.6 自爆で両方が気絶する時の順番（確認 ①〜⑤）
 * 技で相手を倒し、同じ技の「自分に○○」で自分もHP0 → 相手が先に次を出し、そのあとで自爆した側が気絶する
 */

function game(p1: [string, number][], p2: [string, number][], l1: Layout, l2: Layout): GameState {
  let s = startMain({ decks: { p1: deckOf(p1), p2: deckOf(p2) } });
  s = arrange(s, 'p1', l1);
  return arrange(s, 'p2', l2);
}
const end = (s: GameState, ...dice: number[]) => ok(forceDice(s, ...dice), { type: 'END_TURN', player: s.currentPlayer });
const act = (s: GameState, side: 'p1' | 'p2') => s.players[side].active!;
/** 気絶・くりだし・ダメージ・決着の順（だれの何か） */
const flow = (s: GameState, events: GameEvent[]) =>
  events
    .filter((e) => ['Damaged', 'Fainted', 'NeedPromote', 'Promoted', 'GameOver', 'TurnStarted'].includes(e.type))
    .map((e) => {
      if (e.type === 'Damaged') return `Damaged:${s.cards[e.uid].owner}:${e.hpAfter}`;
      if (e.type === 'Fainted') return `Fainted:${s.cards[e.uid].owner}`;
      if (e.type === 'Promoted' || e.type === 'NeedPromote' || e.type === 'TurnStarted') return `${e.type}:${e.player}`;
      if (e.type === 'GameOver') return `GameOver:${e.winner}`;
      return e.type;
    });

/** ばけあげ（1-2：相手に300・自分に50。HP50）で、むつあしを倒す。p2 のベンチは2体（選ぶ） */
function bakeage(p1Bench = ['mutsuashi', 'mutsuashi'], p2Bench = ['mutsuashi', 'mutsuashi']) {
  const s = game([['bakeage', 5], ['mutsuashi', 10]], [['mutsuashi', 15]], { active: 'bakeage', bench: p1Bench }, { active: 'mutsuashi', bench: p2Bench });
  return { s, me: act(s, 'p1'), hit: act(s, 'p2') };
}

describe('① 自爆で両方HP0になると、攻撃された側が先に次を出す', () => {
  it('相手が気絶 → 相手のくりだし待ち。自爆した側はHP0のままバトル場に残る', () => {
    const { s, me } = bakeage();
    const r = end(s, 1);
    expect(flow(r.state, r.events)).toEqual(['Damaged:p2:0', 'Fainted:p2', 'NeedPromote:p2', 'Damaged:p1:0']);
    expect(r.state.phase).toBe('promote');
    expect(r.state.pendingPromote).toEqual(['p2']);
    expect(r.state.players.p1.active).toBe(me);
    expect(r.state.cards[me].hp).toBe(0);
    expect(r.state.deferredFaint).toEqual({ uid: me, by: 'p2' });
    // 自爆した側は、まだ くりだせない（相手が先）
    expect(applyAction(r.state, { type: 'PROMOTE', player: 'p1', benchUid: r.state.players.p1.bench[0] }).rejected).toBe('notPending');
  });
});

describe('② 自爆した側は、相手が次を出したあとに気絶する', () => {
  it('相手のくりだし → 自爆した側の気絶 → 自爆した側のくりだし → 相手のターン', () => {
    const { s, me } = bakeage();
    const r = end(s, 1);
    const r2 = ok(r.state, { type: 'PROMOTE', player: 'p2', benchUid: r.state.players.p2.bench[0] });
    expect(flow(r2.state, r2.events)).toEqual(['Promoted:p2', 'Fainted:p1', 'NeedPromote:p1']);
    expect(eventsOf(r2.events, 'Fainted')).toEqual([{ type: 'Fainted', uid: me, by: 'p2', koCount: 1 }]);
    expect(r2.state.pendingPromote).toEqual(['p1']);
    expect(r2.state.deferredFaint).toBeNull();
    const r3 = ok(r2.state, { type: 'PROMOTE', player: 'p1', benchUid: r2.state.players.p1.bench[0] });
    expect(flow(r3.state, r3.events)).toEqual(['Promoted:p1', 'TurnStarted:p2']);
    expect(r3.state.players.p1.koCount).toBe(1);
    expect(r3.state.players.p2.koCount).toBe(1);
  });

  it('自爆した側のベンチが1体なら、相手のくりだしのあと すぐ自動で出る', () => {
    const { s } = bakeage(['mutsuashi']);
    const r = end(s, 1);
    const r2 = ok(r.state, { type: 'PROMOTE', player: 'p2', benchUid: r.state.players.p2.bench[1] });
    expect(flow(r2.state, r2.events)).toEqual(['Promoted:p2', 'Fainted:p1', 'Promoted:p1', 'TurnStarted:p2']);
  });

  it('相手のベンチが1体（自動で出る）なら、同じ操作の中で 相手の気絶 → 相手のくりだし → 自分の気絶', () => {
    const { s } = bakeage(['mutsuashi', 'mutsuashi'], ['mutsuashi']);
    const r = end(s, 1);
    expect(flow(r.state, r.events)).toEqual(['Damaged:p2:0', 'Fainted:p2', 'Promoted:p2', 'Damaged:p1:0', 'Fainted:p1', 'NeedPromote:p1']);
  });

  it('自爆した側が気絶して、相手の倒した数がそろえば相手の勝ち', () => {
    let { s } = bakeage();
    s = { ...s, players: { ...s.players, p2: { ...s.players.p2, koCount: 2 } } };
    const r = end(s, 1);
    const r2 = ok(r.state, { type: 'PROMOTE', player: 'p2', benchUid: r.state.players.p2.bench[0] });
    expect(flow(r2.state, r2.events)).toEqual(['Promoted:p2', 'Fainted:p1', 'GameOver:p2']);
  });
});

describe('③ 相手に出せるおてあげが無ければ、自爆した側の勝ち', () => {
  it('相手のベンチが空：その時点で勝ち。自爆のダメージ・気絶は数えない', () => {
    const { s, me } = bakeage(['mutsuashi'], []);
    const r = end(s, 1);
    expect(flow(r.state, r.events)).toEqual(['Damaged:p2:0', 'Fainted:p2', 'GameOver:p1']);
    expect(r.state.winner).toBe('p1');
    expect(r.state.cards[me].hp).toBe(50);
    expect(r.state.players.p2.koCount).toBe(0);
  });
});

describe('④ 自爆した側だけ気絶した時は、すぐ気絶する', () => {
  it('相手が生きている時（とりあし 自分に20）', () => {
    let s = game([['toriashi', 5], ['mutsuashi', 10]], [['mutsuashi', 15]], { active: 'toriashi', bench: ['mutsuashi', 'mutsuashi'] }, { active: 'mutsuashi', bench: ['mutsuashi'] });
    s = patchCard(s, act(s, 'p1'), { hp: 20 });
    const r = end(s, 1);
    expect(flow(r.state, r.events)).toEqual(['Damaged:p1:0', 'Fainted:p1', 'NeedPromote:p1']);
    expect(r.state.deferredFaint).toBeNull();
  });

  it('自爆技で相手が倒れなかった時（相手のHPを999にして試す）も、すぐ気絶する', () => {
    let { s } = bakeage();
    s = patchCard(s, act(s, 'p2'), { hp: 999, maxHp: 999 });
    const r = end(s, 1);
    expect(flow(r.state, r.events)).toEqual(['Damaged:p2:699', 'Damaged:p1:0', 'Fainted:p1', 'NeedPromote:p1']);
  });
});

describe('⑤ オンライン対戦で、両方の画面の順番が同じになる', () => {
  it('2台が同じ操作を順に受け取ると、イベントの順番と状態ハッシュが毎回同じ', () => {
    const { s } = bakeage();
    const start = forceDice(s, 1);
    // 通信で送るのは操作だけ。それぞれの端末が自分でエンジンを動かす
    const plan = (st: GameState): Action | null => {
      if (st.phase === 'promote') return { type: 'PROMOTE', player: st.pendingPromote[0], benchUid: st.players[st.pendingPromote[0]].bench[0] };
      if (st.phase === 'main' && st.turnNumber === 1) return { type: 'END_TURN', player: 'p1' };
      return null;
    };
    const run = () => {
      let st = start;
      const log: string[] = [];
      for (let a = plan(st); a; a = plan(st)) {
        const r = applyAction(st, a);
        expect(r.rejected).toBeUndefined();
        log.push(...flow(r.state, r.events), hashState(r.state));
        st = r.state;
      }
      return log;
    };
    const p1Screen = run();
    const p2Screen = run();
    expect(p1Screen).toEqual(p2Screen);
    expect(p1Screen.filter((x) => !/^[0-9a-f]{8}$/.test(x))).toEqual([
      'Damaged:p2:0', 'Fainted:p2', 'NeedPromote:p2', 'Damaged:p1:0',
      'Promoted:p2', 'Fainted:p1', 'NeedPromote:p1',
      'Promoted:p1', 'TurnStarted:p2',
    ]);
  });

  it('自爆した側の端末から先に くりだし を送っても弾かれる（順番が入れかわらない）', () => {
    const { s } = bakeage();
    const r = end(s, 1);
    const early = applyAction(r.state, { type: 'PROMOTE', player: 'p1', benchUid: r.state.players.p1.bench[0] });
    expect(early.rejected).toBe('notPending');
    expect(early.state).toBe(r.state);
  });
});

describe('持続効果・ばくだんの気絶は今までどおり', () => {
  it('HP0で残っている間、自爆した側の持続効果は発動しない（気絶で消える）', () => {
    const { s, me } = bakeage();
    const withHeal: GameState = { ...s, lasting: [{ seq: 1, owner: 'p1', holder: 'p1', kind: 'heal', amount: 30, targetUid: me, turns: 1, sourceUid: me, createdTurn: 0 }], lastingSeq: 1 };
    const r = end(withHeal, 1);
    expect(eventsOf(r.events, 'LastingFired')).toEqual([]);
    expect(r.state.cards[me].hp).toBe(0);
    const r2 = ok(r.state, { type: 'PROMOTE', player: 'p2', benchUid: r.state.players.p2.bench[0] });
    expect(r2.state.lasting).toEqual([]);
  });
});


describe('CPU も この順番どおりに くりだす', () => {
  it('どの強さでも：先に攻撃された側（p2）が選び、そのあとで自爆した側（p1）が選ぶ。決着まで止まらない', async () => {
    const { decide } = await import('../src/cpu/brains');
    const { seedRng } = await import('../src/engine');
    const { nextInt } = await import('../src/engine/rng');
    for (const level of ['weak', 'normal', 'strong'] as const) {
      const { s } = bakeage();
      let st = end(s, 1).state;
      const order: string[] = [];
      const rng = seedRng(`cpu-${level}`);
      const rand = () => nextInt(rng, 1_000_000) / 1_000_000;
      for (let i = 0; i < 2 && st.phase === 'promote'; i++) {
        const who = st.pendingPromote[0];
        const a = decide(level, st, who, rand);
        expect(a?.type, level).toBe('PROMOTE');
        order.push(who);
        st = ok(st, a!).state;
      }
      expect(order, level).toEqual(['p2', 'p1']);
      expect(st.phase).toBe('main');
      expect(st.currentPlayer).toBe('p2');
    }
  });
});
