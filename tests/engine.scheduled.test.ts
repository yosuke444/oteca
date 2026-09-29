import { describe, expect, it } from 'vitest';
import { CARD_DB } from '../src/data/cards';
import type { CardDb, GameState, OtegeCardDef } from '../src/engine';
import { deckOf, eventsOf, forceDice, ok, startMain } from './helpers';

/** テスト専用カード：どの目でも「次の相手ターン終わりに10ダメージ」を予約する */
const TIMER: OtegeCardDef = {
  no: 9001,
  id: 'test_timer',
  name: 'テストタイマー',
  kind: 'otege',
  rarity: 'normal',
  hp: 100,
  moves: [
    {
      faces: [1, 2, 3, 4, 5, 6],
      effects: [{ type: 'scheduled', timing: 'opponentTurnEnd', effect: { type: 'damage', amount: 10 } }],
    },
  ],
  image: '',
  flavor: '',
};

const DB: CardDb = { ...CARD_DB, [TIMER.no]: TIMER };

function endTurn(state: GameState, die: number) {
  return ok(forceDice(state, die), { type: 'END_TURN', player: state.currentPlayer });
}

describe('タイミング付き効果キュー', () => {
  it('E17 テスト専用カードで「次の相手ターン終わりに10ダメージ」が正しく発動する', () => {
    // p1：テストタイマーだけのデッキ。p2：むつあし（目1は回復なのでダメージが出ない）だけのデッキ
    let s = startMain({
      cardDb: DB,
      decks: { p1: Array(15).fill(TIMER.no), p2: deckOf([['mutsuashi', 15]]) },
    });
    const p2active = s.players.p2.active!;

    // p1 のターン終わり：予約されるだけで、まだダメージは出ない
    const r1 = endTurn(s, 3);
    expect(eventsOf(r1.events, 'Damaged')).toEqual([]);
    expect(r1.state.scheduled).toEqual([
      {
        owner: 'p1',
        timing: 'opponentTurnEnd',
        effect: { type: 'damage', amount: 10 },
        sourceUid: s.players.p1.active,
        createdTurn: 1,
      },
    ]);

    // p2 のターン開始時にも発動しない
    expect(eventsOf(r1.events, 'TurnStarted')).toEqual([{ type: 'TurnStarted', player: 'p2', turn: 1 }]);
    expect(r1.state.cards[p2active].hp).toBe(160);

    // p2 のターン終わり：p2 の攻撃のあとに発動し、p2 のバトル場に10ダメージ
    const r2 = endTurn(r1.state, 1);
    const types = r2.events.map((e) => e.type);
    expect(types.indexOf('Damaged')).toBeGreaterThan(types.indexOf('MoveSelected'));
    expect(types.indexOf('Damaged')).toBeLessThan(types.indexOf('TurnEnded'));
    expect(eventsOf(r2.events, 'Damaged')).toEqual([
      { type: 'Damaged', uid: p2active, amount: 10, hpAfter: 150, big: false },
    ]);

    // 1回だけ発動してキューから消える。p1 がまた攻撃すれば新しく積まれる
    const r3 = endTurn(r2.state, 2);
    expect(eventsOf(r3.events, 'Damaged')).toEqual([]);
    expect(r3.state.scheduled).toHaveLength(1);
    expect(r3.state.scheduled[0].createdTurn).toBe(3);
    const r4 = endTurn(r3.state, 4); // 目4は回復ではなく攻撃（p2 のHPが増えないように）
    expect(eventsOf(r4.events, 'Damaged').filter((e) => e.uid === p2active)).toEqual([
      { type: 'Damaged', uid: p2active, amount: 10, hpAfter: 140, big: false },
    ]);
    expect(r4.state.scheduled).toEqual([]);
  });

  it('E17 予約ダメージでも、きぜつ・勝ち負けの判定が行われる', () => {
    let s = startMain({
      cardDb: DB,
      decks: { p1: Array(15).fill(TIMER.no), p2: deckOf([['mutsuashi', 15]]) },
    });
    const p2active = s.players.p2.active!;
    s = endTurn(s, 1).state;
    s = structuredClone(s);
    s.cards[p2active].hp = 10;

    const r = endTurn(s, 4); // p2 は 20ダメージ技。そのあと予約の10ダメージできぜつ
    expect(eventsOf(r.events, 'Fainted')).toEqual([{ type: 'Fainted', uid: p2active, by: 'p1', koCount: 1 }]);
    expect(eventsOf(r.events, 'GameOver')).toEqual([{ type: 'GameOver', winner: 'p1', reason: 'noBench' }]);
  });
});
