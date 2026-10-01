import { describe, expect, it } from 'vitest';
import { type GameState, applyAction, getLegalActions } from '../src/engine';
import { arrange, deckOf, eventsOf, forceDice, ok, startMain } from './helpers';

/** やいば2枚・ドリンク2枚 */
const DECK = deckOf([
  ['oteage', 1],
  ['mitsume', 1],
  ['otesage', 1],
  ['himitsu_yaiba', 2],
  ['kimyou_drink', 2],
  ['kusuri', 8],
]);

const p1Active = (s: GameState) => s.players.p1.active!;
const use = (s: GameState, item: string, target: string) => applyAction(s, { type: 'USE_ITEM', player: 'p1', uid: item, targetUid: target });
function endTurn(state: GameState, die: number) {
  return ok(forceDice(state, die), { type: 'END_TURN', player: state.currentPlayer });
}

/** p1 のバトル場おてあげ・ベンチみつめ、手札 やいば2・ドリンク2 */
function setup() {
  let s = startMain({ decks: { p1: DECK } });
  s = arrange(s, 'p1', { active: 'oteage', bench: ['mitsume'], hand: ['himitsu_yaiba', 'himitsu_yaiba', 'kimyou_drink', 'kimyou_drink'] });
  s = arrange(s, 'p2', { active: 'mutsuashi' });
  const [y1, y2, d1, d2] = s.players.p1.hand;
  return { s, y1, y2, d1, d2, active: p1Active(s), bench: s.players.p1.bench[0] };
}

/** 弾かれて、状態がそのまま（アイテムは手札に残る） */
function blocked(s: GameState, item: string, target: string) {
  const r = use(s, item, target);
  expect(r.rejected).toBe('stackBlocked');
  expect(r.state).toBe(s);
  expect(r.state.players.p1.hand).toContain(item);
  // 合法手にも出ない（E21）
  expect(getLegalActions(s, 'p1')).not.toContainEqual({ type: 'USE_ITEM', player: 'p1', uid: item, targetUid: target });
}

describe('E19 ドリンクとやいばの重ねがけ禁止（v1.4）', () => {
  it('ドリンク → やいば は使えない', () => {
    const t = setup();
    const s = ok(t.s, { type: 'USE_ITEM', player: 'p1', uid: t.d1, targetUid: t.active }).state;
    blocked(s, t.y1, t.active);
  });

  it('やいば → ドリンク は使えない', () => {
    const t = setup();
    const s = ok(t.s, { type: 'USE_ITEM', player: 'p1', uid: t.y1, targetUid: t.active }).state;
    blocked(s, t.d1, t.active);
  });

  it('ドリンク → ドリンク は使えない', () => {
    const t = setup();
    const s = ok(t.s, { type: 'USE_ITEM', player: 'p1', uid: t.d1, targetUid: t.active }).state;
    blocked(s, t.d2, t.active);
  });

  it('やいば → やいば は使える（+40）', () => {
    const t = setup();
    let s = ok(t.s, { type: 'USE_ITEM', player: 'p1', uid: t.y1, targetUid: t.active }).state;
    s = ok(s, { type: 'USE_ITEM', player: 'p1', uid: t.y2, targetUid: t.active }).state;
    expect(s.cards[t.active].attackAdd).toBe(40);
    expect(eventsOf(endTurn(s, 1).events, 'Damaged')[0].amount).toBe(70);
  });

  it('別のおてあげになら使える', () => {
    const t = setup();
    let s = ok(t.s, { type: 'USE_ITEM', player: 'p1', uid: t.d1, targetUid: t.active }).state;
    s = ok(s, { type: 'USE_ITEM', player: 'p1', uid: t.y1, targetUid: t.bench }).state;
    expect(s.cards[t.active].attackAdd).toBe(50);
    expect(s.cards[t.bench].attackAdd).toBe(20);
  });

  it('次の自分のターンなら使える', () => {
    const t = setup();
    let s = ok(t.s, { type: 'USE_ITEM', player: 'p1', uid: t.d1, targetUid: t.active }).state;
    s = endTurn(s, 1).state; // p1 → p2
    s = endTurn(s, 1).state; // p2 → p1
    expect(s.currentPlayer).toBe('p1');
    expect(s.cards[t.active].itemsThisTurn).toEqual([]);
    s = ok(s, { type: 'USE_ITEM', player: 'p1', uid: t.y1, targetUid: t.active }).state;
    s = ok(s, { type: 'USE_ITEM', player: 'p1', uid: t.d2, targetUid: t.bench }).state;
    expect(s.cards[t.active].attackAdd).toBe(20);
  });

  it('使ったアイテムの記録は、ターン終了で消え、きぜつした後にも残らない', () => {
    const t = setup();
    // p1 がベンチのみつめにドリンク（HP10）→ 交代して、p1 のターン終わり → p2 の攻撃できぜつ
    let s = ok(t.s, { type: 'USE_ITEM', player: 'p1', uid: t.d1, targetUid: t.bench }).state;
    expect(s.cards[t.bench].itemsThisTurn).toHaveLength(1);
    s = ok(s, { type: 'SWAP', player: 'p1', benchUid: t.bench }).state;
    s = ok(forceDice(s, 4), { type: 'END_TURN', player: 'p1' }).state; // 交代したので攻撃なし
    const r = ok(forceDice(s, 4), { type: 'END_TURN', player: 'p2' }); // むつあし 目4：20ダメージ → HP10 のみつめは きぜつ
    expect(eventsOf(r.events, 'Fainted')[0]?.uid).toBe(t.bench);
    expect(r.state.cards[t.bench].itemsThisTurn).toEqual([]);
  });

  it('使えない時も、ほかの使える手は合法手に残る', () => {
    const t = setup();
    const s = ok(t.s, { type: 'USE_ITEM', player: 'p1', uid: t.d1, targetUid: t.active }).state;
    const legal = getLegalActions(s, 'p1');
    expect(legal).toContainEqual({ type: 'USE_ITEM', player: 'p1', uid: t.y1, targetUid: t.bench });
    expect(legal).toContainEqual({ type: 'USE_ITEM', player: 'p1', uid: t.d2, targetUid: t.bench });
  });
});
