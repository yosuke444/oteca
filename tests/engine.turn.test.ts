import { describe, expect, it } from 'vitest';
import { type Action, type GameState, type Side, applyAction, getLegalActions, hashState } from '../src/engine';
import { CARD_DB } from '../src/data/cards';
import { starterDeckNos } from '../src/data/starterDeck';
import { createGame } from '../src/engine';
import { arrange, deckOf, eventsOf, forceDice, ok, startMain } from './helpers';

/** 手番の人が、指定の目でターンを終える */
function endTurn(state: GameState, die = 1) {
  return ok(forceDice(state, die), { type: 'END_TURN', player: state.currentPlayer });
}

describe('ターンの流れ', () => {
  it('E04 自分ターン数3・6・9でだけドローする。山札0でもエラー・敗北にならない', () => {
    // p1：山札が2枚しかない。両者とも むつあし（目1〜3は回復）で、ダメージが出ないようにする
    let s = startMain({
      decks: {
        p1: deckOf([
          ['mutsuashi', 1],
          ['kusuri', 14],
        ]),
      },
    });
    s = arrange(s, 'p1', { active: 'mutsuashi', hand: Array(12).fill('kusuri') });
    s = arrange(s, 'p2', { active: 'mutsuashi' });
    expect(s.players.p1.deck).toHaveLength(2);

    const drewAt: Record<Side, number[]> = { p1: [], p2: [] };
    for (let i = 0; i < 24; i++) {
      const r = endTurn(s, 1);
      s = r.state;
      const started = eventsOf(r.events, 'TurnStarted')[0];
      if (eventsOf(r.events, 'Drew').length > 0) drewAt[started.player].push(started.turn);
    }
    expect(drewAt.p2).toEqual([3, 6, 9, 12]);
    expect(drewAt.p1).toEqual([3, 6]); // 9・12 は山札が0なので引けないだけ
    expect(s.players.p1.deck).toHaveLength(0);
    expect(s.players.p1.turnCount).toBe(13);
    expect(s.phase).toBe('main');
    expect(s.winner).toBeNull();
  });

  it('E05 ベンチは1ターン1体、最大2体', () => {
    let s = startMain();
    s = arrange(s, 'p1', { active: 'oteage', hand: ['mitsume', 'otesage', 'sanbon'] });
    s = arrange(s, 'p2', { active: 'mutsuashi' });
    const [mitsume, otesage, sanbon] = s.players.p1.hand;

    s = ok(s, { type: 'PLACE_BENCH', player: 'p1', uid: mitsume }).state;
    expect(applyAction(s, { type: 'PLACE_BENCH', player: 'p1', uid: otesage }).rejected).toBe('benchLimit');
    expect(getLegalActions(s, 'p1').some((a) => a.type === 'PLACE_BENCH')).toBe(false);

    s = endTurn(endTurn(s).state).state; // p1 → p2 → p1 の2ターン目
    s = ok(s, { type: 'PLACE_BENCH', player: 'p1', uid: otesage }).state;
    expect(s.players.p1.bench).toEqual([mitsume, otesage]);

    s = endTurn(endTurn(s).state).state; // p1 の3ターン目
    expect(applyAction(s, { type: 'PLACE_BENCH', player: 'p1', uid: sanbon }).rejected).toBe('benchFull');
    expect(getLegalActions(s, 'p1').some((a) => a.type === 'PLACE_BENCH')).toBe(false);
  });

  it('E06 交代は何回でもできる。交代したターンの END_TURN ではサイコロを振らない', () => {
    let s = startMain();
    s = arrange(s, 'p1', { active: 'oteage', bench: ['mitsume', 'otesage'] });
    s = arrange(s, 'p2', { active: 'mutsuashi' });
    const [oteage, mitsume, otesage] = [s.players.p1.active!, ...s.players.p1.bench];

    s = ok(s, { type: 'SWAP', player: 'p1', benchUid: mitsume }).state;
    s = ok(s, { type: 'SWAP', player: 'p1', benchUid: otesage }).state;
    s = ok(s, { type: 'SWAP', player: 'p1', benchUid: oteage }).state;
    expect(s.players.p1.active).toBe(oteage);
    expect(s.players.p1.swappedThisTurn).toBe(true);

    const p2hp = s.cards[s.players.p2.active!].hp;
    const r = ok(s, { type: 'END_TURN', player: 'p1' });
    expect(eventsOf(r.events, 'DiceRolled')).toHaveLength(0);
    expect(eventsOf(r.events, 'Damaged')).toHaveLength(0);
    expect(eventsOf(r.events, 'TurnEnded')).toEqual([{ type: 'TurnEnded', player: 'p1', attacked: false }]);
    expect(r.state.cards[r.state.players.p2.active!].hp).toBe(p2hp);

    // 次の自分ターンは、交代しなければ普通に攻撃する
    s = endTurn(r.state).state;
    const r2 = endTurn(s, 1);
    expect(eventsOf(r2.events, 'DiceRolled')).toEqual([{ type: 'DiceRolled', purpose: 'attack', player: 'p1', value: 1 }]);
    expect(eventsOf(r2.events, 'TurnEnded')[0].attacked).toBe(true);
  });

  it('E18 手番でない人の操作・不正な操作は無視される', () => {
    let s = startMain();
    s = arrange(s, 'p1', { active: 'oteage', hand: ['mitsume', 'kusuri'] });
    s = arrange(s, 'p2', { active: 'mutsuashi', hand: ['otesage'] });
    const before = hashState(s);
    const [mitsume, kusuri] = s.players.p1.hand;
    const p2hand = s.players.p2.hand[0];
    const p2active = s.players.p2.active!;

    const rejects: [Action, string][] = [
      // 手番でない人
      [{ type: 'PLACE_BENCH', player: 'p2', uid: p2hand }, 'notYourTurn'],
      [{ type: 'END_TURN', player: 'p2' }, 'notYourTurn'],
      [{ type: 'SWAP', player: 'p2', benchUid: p2hand }, 'notYourTurn'],
      // 不正な操作
      [{ type: 'PLACE_BENCH', player: 'p1', uid: p2hand }, 'notInHand'],
      [{ type: 'PLACE_BENCH', player: 'p1', uid: 'p1-999' }, 'notInHand'],
      [{ type: 'PLACE_BENCH', player: 'p1', uid: kusuri }, 'notOtege'],
      [{ type: 'USE_ITEM', player: 'p1', uid: mitsume, targetUid: s.players.p1.active! }, 'notItem'],
      [{ type: 'USE_ITEM', player: 'p1', uid: kusuri, targetUid: p2active }, 'badTarget'],
      [{ type: 'USE_ITEM', player: 'p1', uid: kusuri, targetUid: mitsume }, 'badTarget'], // 手札のおてあげ
      [{ type: 'SWAP', player: 'p1', benchUid: mitsume }, 'notOnBench'],
      [{ type: 'PROMOTE', player: 'p1', benchUid: mitsume }, 'wrongPhase'],
      [{ type: 'SETUP_ACTIVE', player: 'p1', uid: mitsume }, 'wrongPhase'],
    ];
    for (const [action, reason] of rejects) {
      const r = applyAction(s, action);
      expect(r.rejected, JSON.stringify(action)).toBe(reason);
      expect(r.state).toBe(s);
      expect(r.events).toEqual([]);
    }
    expect(hashState(s)).toBe(before);

    // 決着後は何も受け付けない
    const over = ok(s, { type: 'SURRENDER', player: 'p2' });
    expect(eventsOf(over.events, 'GameOver')).toEqual([{ type: 'GameOver', winner: 'p1', reason: 'surrender' }]);
    expect(applyAction(over.state, { type: 'END_TURN', player: 'p1' }).rejected).toBe('gameOver');
    expect(getLegalActions(over.state, 'p1')).toEqual([]);
  });

  it('E18 準備中：選び直し・おてあげ以外・準備中のメイン操作は無視される', () => {
    const created = createGame({ seed: 'setup', decks: { p1: starterDeckNos(), p2: starterDeckNos() }, cardDb: CARD_DB, forcedDice: [6, 1] });
    let s = arrange(created.state, 'p1', { hand: ['oteage', 'kusuri'] });
    s = arrange(s, 'p2', { hand: ['mitsume'] });
    const [oteage, kusuri] = s.players.p1.hand;
    const mitsume = s.players.p2.hand[0];

    expect(applyAction(s, { type: 'SETUP_ACTIVE', player: 'p1', uid: kusuri }).rejected).toBe('notOtege');
    expect(applyAction(s, { type: 'END_TURN', player: 'p1' }).rejected).toBe('wrongPhase');

    const a = ok(s, { type: 'SETUP_ACTIVE', player: 'p1', uid: oteage });
    expect(a.events).toEqual([{ type: 'ActiveChosen', player: 'p1' }]);
    expect(a.state.players.p1.active).toBeNull(); // まだ裏向き
    expect(applyAction(a.state, { type: 'SETUP_ACTIVE', player: 'p1', uid: oteage }).rejected).toBe('alreadyChosen');

    const b = ok(a.state, { type: 'SETUP_ACTIVE', player: 'p2', uid: mitsume });
    expect(eventsOf(b.events, 'ActivesRevealed')).toEqual([{ type: 'ActivesRevealed', p1: oteage, p2: mitsume }]);
    expect(eventsOf(b.events, 'TurnStarted')).toEqual([{ type: 'TurnStarted', player: 'p1', turn: 1 }]);

    // 通信で届く順番が逆でも、同じ状態になる
    const c = ok(s, { type: 'SETUP_ACTIVE', player: 'p2', uid: mitsume });
    const d = ok(c.state, { type: 'SETUP_ACTIVE', player: 'p1', uid: oteage });
    expect(hashState(d.state)).toBe(hashState(b.state));
  });
});
