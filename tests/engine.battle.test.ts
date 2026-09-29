import { describe, expect, it } from 'vitest';
import { type GameState, applyAction, getLegalActions } from '../src/engine';
import { arrange, deckOf, eventsOf, forceDice, ok, patchCard, startMain } from './helpers';

/** p1 用：スーパーはレボリューション、やいば2枚・ドリンク入り */
const BUFF_DECK = deckOf([
  ['oteage', 1],
  ['mitsume', 1],
  ['revolution', 1],
  ['himitsu_yaiba', 2],
  ['kimyou_drink', 1],
  ['kusuri', 9],
]);

/** p1 用：スポドリ・くすりの確認 */
const ITEM_DECK = deckOf([
  ['oteage', 1],
  ['mitsume', 1],
  ['kami', 1],
  ['supodori', 3],
  ['kusuri', 2],
  ['otesage', 7],
]);

function endTurn(state: GameState, die: number) {
  return ok(forceDice(state, die), { type: 'END_TURN', player: state.currentPlayer });
}

const p1Active = (s: GameState) => s.players.p1.active!;
const p2Active = (s: GameState) => s.players.p2.active!;

describe('技・アイテム・きぜつ', () => {
  it('E08 回復は最大HPを超えない', () => {
    let s = startMain();
    s = arrange(s, 'p1', { active: 'mitsume', hand: ['kusuri'] });
    s = arrange(s, 'p2', { active: 'mutsuashi' });

    // 技の回復（みつめ 目1：30回復）：110/120 → 120
    s = patchCard(s, p1Active(s), { hp: 110 });
    const r = endTurn(s, 1);
    expect(eventsOf(r.events, 'Healed')).toEqual([{ type: 'Healed', uid: p1Active(s), amount: 10, hpAfter: 120 }]);

    // アイテムの回復（くすり +30）：100/120 → 120
    s = patchCard(s, p1Active(s), { hp: 100 });
    const r2 = ok(s, { type: 'USE_ITEM', player: 'p1', uid: s.players.p1.hand[0], targetUid: p1Active(s) });
    expect(eventsOf(r2.events, 'Healed')).toEqual([{ type: 'Healed', uid: p1Active(s), amount: 20, hpAfter: 120 }]);
    expect(r2.state.players.p1.discard).toContain(s.players.p1.hand[0]);
  });

  it('E09 やいば2枚 → +40', () => {
    let s = startMain({ decks: { p1: BUFF_DECK } });
    s = arrange(s, 'p1', { active: 'oteage', hand: ['himitsu_yaiba', 'himitsu_yaiba'] });
    s = arrange(s, 'p2', { active: 'mutsuashi' });
    const [y1, y2] = s.players.p1.hand;
    const a = ok(s, { type: 'USE_ITEM', player: 'p1', uid: y1, targetUid: p1Active(s) });
    expect(eventsOf(a.events, 'BuffChanged')[0]).toMatchObject({ attackAdd: 20, attackOverride: null });
    const b = ok(a.state, { type: 'USE_ITEM', player: 'p1', uid: y2, targetUid: p1Active(s) });
    expect(eventsOf(b.events, 'BuffChanged')[0]).toMatchObject({ attackAdd: 40 });

    const r = endTurn(b.state, 1); // おてあげ 目1：30ダメージ
    expect(eventsOf(r.events, 'Damaged')).toEqual([
      { type: 'Damaged', uid: p2Active(s), amount: 70, hpAfter: 90, big: true },
    ]);
  });

  it('E09 ドリンク＋やいば1枚 → 50+20=70（元が50より大きくても50に置き換え）', () => {
    let s = startMain({ decks: { p1: BUFF_DECK } });
    s = arrange(s, 'p1', { active: 'revolution', hand: ['kimyou_drink', 'himitsu_yaiba'] });
    s = arrange(s, 'p2', { active: 'mutsuashi' });
    const [drink, yaiba] = s.players.p1.hand;

    const d = ok(s, { type: 'USE_ITEM', player: 'p1', uid: drink, targetUid: p1Active(s) });
    expect(eventsOf(d.events, 'HpSet')).toEqual([{ type: 'HpSet', uid: p1Active(s), hpAfter: 10 }]);
    expect(eventsOf(d.events, 'BuffChanged')[0]).toMatchObject({ attackAdd: 0, attackOverride: 50 });

    // ドリンクだけ：レボリューション 目6（90）→ 50
    const only = endTurn(d.state, 6);
    expect(eventsOf(only.events, 'Damaged')[0]).toMatchObject({ amount: 50, big: false });

    // ドリンク＋やいば：50 + 20 = 70
    const y = ok(d.state, { type: 'USE_ITEM', player: 'p1', uid: yaiba, targetUid: p1Active(s) });
    const both = endTurn(y.state, 6);
    expect(eventsOf(both.events, 'Damaged')[0]).toMatchObject({ uid: p2Active(s), amount: 70 });
  });

  it('E09 ドリンク中の回復技は回復のまま', () => {
    let s = startMain({ decks: { p1: BUFF_DECK } });
    s = arrange(s, 'p1', { active: 'mitsume', hand: ['kimyou_drink', 'himitsu_yaiba'] });
    s = arrange(s, 'p2', { active: 'mutsuashi' });
    const [drink, yaiba] = s.players.p1.hand;
    s = ok(s, { type: 'USE_ITEM', player: 'p1', uid: drink, targetUid: p1Active(s) }).state;
    s = ok(s, { type: 'USE_ITEM', player: 'p1', uid: yaiba, targetUid: p1Active(s) }).state;

    const r = endTurn(s, 1); // みつめ 目1：30回復
    expect(eventsOf(r.events, 'Damaged')).toEqual([]);
    expect(eventsOf(r.events, 'Healed')).toEqual([{ type: 'Healed', uid: p1Active(s), amount: 30, hpAfter: 40 }]);
  });

  it('E10 やいば・ドリンクの効果はターン終了で消える', () => {
    let s = startMain({ decks: { p1: BUFF_DECK } });
    s = arrange(s, 'p1', { active: 'oteage', bench: ['mitsume'], hand: ['himitsu_yaiba', 'kimyou_drink'] });
    s = arrange(s, 'p2', { active: 'mutsuashi' });
    const [yaiba, drink] = s.players.p1.hand;
    const bench = s.players.p1.bench[0];
    s = ok(s, { type: 'USE_ITEM', player: 'p1', uid: yaiba, targetUid: p1Active(s) }).state;
    s = ok(s, { type: 'USE_ITEM', player: 'p1', uid: drink, targetUid: bench }).state; // ベンチにも使える

    const r = endTurn(s, 1);
    expect(eventsOf(r.events, 'Damaged')[0].amount).toBe(50); // 30 + 20
    expect(eventsOf(r.events, 'BuffChanged')).toEqual([
      { type: 'BuffChanged', uid: p1Active(s), attackAdd: 0, attackOverride: null },
      { type: 'BuffChanged', uid: bench, attackAdd: 0, attackOverride: null },
    ]);
    for (const c of Object.values(r.state.cards)) {
      expect(c.attackAdd).toBe(0);
      expect(c.attackOverride).toBeNull();
    }

    // 次の自分ターンは元の30ダメージに戻る
    const next = endTurn(endTurn(r.state, 1).state, 1);
    expect(eventsOf(next.events, 'Damaged')[0].amount).toBe(30);
  });

  it('E11 スポドリはバトル場・スーパー・HP満タンには使えない。くすりはHP満タンに使えない', () => {
    let s = startMain({ decks: { p1: ITEM_DECK } });
    s = arrange(s, 'p1', { active: 'oteage', bench: ['mitsume', 'kami'], hand: ['supodori', 'kusuri'] });
    s = arrange(s, 'p2', { active: 'mutsuashi' });
    const [supodori, kusuri] = s.players.p1.hand;
    const [mitsume, kami] = s.players.p1.bench;
    const oteage = p1Active(s);
    s = patchCard(s, oteage, { hp: 20 });
    s = patchCard(s, kami, { hp: 100 });

    expect(applyAction(s, { type: 'USE_ITEM', player: 'p1', uid: supodori, targetUid: oteage }).rejected).toBe('badTarget');
    expect(applyAction(s, { type: 'USE_ITEM', player: 'p1', uid: supodori, targetUid: kami }).rejected).toBe('badTarget');
    expect(applyAction(s, { type: 'USE_ITEM', player: 'p1', uid: supodori, targetUid: mitsume }).rejected).toBe('fullHp');

    const full = patchCard(s, oteage, { hp: 90 });
    expect(applyAction(full, { type: 'USE_ITEM', player: 'p1', uid: kusuri, targetUid: oteage }).rejected).toBe('fullHp');

    // 合法手にも出てこない
    const legalItem = getLegalActions(s, 'p1').filter((a) => a.type === 'USE_ITEM' && a.uid === supodori);
    expect(legalItem).toEqual([]);

    // ベンチの通常おてあげで、HPが減っていれば使える（最大HPまで）
    const hurt = patchCard(s, mitsume, { hp: 20 });
    const r = ok(hurt, { type: 'USE_ITEM', player: 'p1', uid: supodori, targetUid: mitsume });
    expect(eventsOf(r.events, 'Healed')).toEqual([{ type: 'Healed', uid: mitsume, amount: 70, hpAfter: 90 }]);
    const nearly = patchCard(s, mitsume, { hp: 100 });
    const r2 = ok(nearly, { type: 'USE_ITEM', player: 'p1', uid: supodori, targetUid: mitsume });
    expect(eventsOf(r2.events, 'Healed')[0]).toMatchObject({ amount: 20, hpAfter: 120 });

    // くすりはスーパー・ベンチにも使える
    expect(applyAction(s, { type: 'USE_ITEM', player: 'p1', uid: kusuri, targetUid: kami }).rejected).toBeUndefined();
  });

  it('E12 3体倒したら勝ち', () => {
    let s = startMain();
    s = arrange(s, 'p1', { active: 'oteage' });
    s = arrange(s, 'p2', { active: 'otesage', bench: ['mitsume'] });
    s = structuredClone(s);
    s.players.p1.koCount = 2;
    s = patchCard(s, p2Active(s), { hp: 10 });

    const r = endTurn(s, 1);
    expect(eventsOf(r.events, 'Fainted')).toEqual([{ type: 'Fainted', uid: p2Active(s), by: 'p1', koCount: 3 }]);
    expect(eventsOf(r.events, 'GameOver')).toEqual([{ type: 'GameOver', winner: 'p1', reason: 'ko' }]);
    expect(eventsOf(r.events, 'Promoted')).toEqual([]);
    expect(r.state.phase).toBe('over');
    expect(r.state.winner).toBe('p1');
    expect(r.state.players.p2.discard).toContain(p2Active(s));
  });

  it('E13 きぜつ時にベンチが空なら負け', () => {
    let s = startMain();
    s = arrange(s, 'p1', { active: 'oteage' });
    s = arrange(s, 'p2', { active: 'otesage' });
    s = patchCard(s, p2Active(s), { hp: 10 });

    const r = endTurn(s, 1);
    expect(eventsOf(r.events, 'Fainted')[0]).toMatchObject({ by: 'p1', koCount: 1 });
    expect(eventsOf(r.events, 'GameOver')).toEqual([{ type: 'GameOver', winner: 'p1', reason: 'noBench' }]);
    expect(r.state.phase).toBe('over');
  });

  it('E14 ベンチ2体の時はくりだしを選ぶ', () => {
    let s = startMain();
    s = arrange(s, 'p1', { active: 'oteage' });
    s = arrange(s, 'p2', { active: 'otesage', bench: ['mitsume', 'sanbon'] });
    const [mitsume, sanbon] = s.players.p2.bench;
    s = patchCard(s, p2Active(s), { hp: 10 });

    const r = endTurn(s, 1);
    expect(eventsOf(r.events, 'NeedPromote')).toEqual([{ type: 'NeedPromote', player: 'p2' }]);
    expect(eventsOf(r.events, 'TurnStarted')).toEqual([]);
    expect(r.state.phase).toBe('promote');
    expect(r.state.players.p2.active).toBeNull();

    // くりだし待ちの間、ほかの操作は受け付けない
    expect(applyAction(r.state, { type: 'END_TURN', player: 'p2' }).rejected).toBe('wrongPhase');
    expect(applyAction(r.state, { type: 'PROMOTE', player: 'p1', benchUid: mitsume }).rejected).toBe('notPending');
    expect(getLegalActions(r.state, 'p2')).toEqual([
      { type: 'PROMOTE', player: 'p2', benchUid: mitsume },
      { type: 'PROMOTE', player: 'p2', benchUid: sanbon },
    ]);

    const p = ok(r.state, { type: 'PROMOTE', player: 'p2', benchUid: sanbon });
    expect(p.events.map((e) => e.type)).toEqual(['Promoted', 'TurnStarted']);
    expect(p.state.players.p2.active).toBe(sanbon);
    expect(p.state.players.p2.bench).toEqual([mitsume]);
    expect(p.state.phase).toBe('main');
    expect(p.state.currentPlayer).toBe('p2');
  });

  it('E14 ベンチ1体なら自動でくりだす', () => {
    let s = startMain();
    s = arrange(s, 'p1', { active: 'oteage' });
    s = arrange(s, 'p2', { active: 'otesage', bench: ['mitsume'] });
    const mitsume = s.players.p2.bench[0];
    s = patchCard(s, p2Active(s), { hp: 10 });

    const r = endTurn(s, 1);
    expect(eventsOf(r.events, 'Promoted')).toEqual([{ type: 'Promoted', player: 'p2', uid: mitsume }]);
    expect(eventsOf(r.events, 'NeedPromote')).toEqual([]);
    expect(r.state.players.p2.active).toBe(mitsume);
    expect(r.state.phase).toBe('main');
    expect(r.state.currentPlayer).toBe('p2');
  });

  it('E15 くりだしたおてあげは次の自分ターンに攻撃できる', () => {
    let s = startMain();
    s = arrange(s, 'p1', { active: 'mutsuashi' });
    s = arrange(s, 'p2', { active: 'otesage', bench: ['mitsume', 'sanbon'] });
    const sanbon = s.players.p2.bench[1];
    s = patchCard(s, p2Active(s), { hp: 10 });
    s = endTurn(s, 4).state; // むつあし 目4：20ダメージ → きぜつ
    s = ok(s, { type: 'PROMOTE', player: 'p2', benchUid: sanbon }).state;
    expect(s.players.p2.swappedThisTurn).toBe(false);

    const r = endTurn(s, 5); // さんぼん 目5：70ダメージ
    expect(eventsOf(r.events, 'DiceRolled')).toEqual([{ type: 'DiceRolled', purpose: 'attack', player: 'p2', value: 5 }]);
    expect(eventsOf(r.events, 'MoveSelected')).toEqual([{ type: 'MoveSelected', uid: sanbon, moveIndex: 1 }]);
    expect(eventsOf(r.events, 'Damaged')[0]).toMatchObject({ uid: p1Active(s), amount: 70, big: true });
    expect(eventsOf(r.events, 'TurnEnded')[0].attacked).toBe(true);
  });
});
