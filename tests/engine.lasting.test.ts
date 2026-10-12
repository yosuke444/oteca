import { describe, expect, it } from 'vitest';
import { CARD_DB, CARD_LIST } from '../src/data/cards';
import { applyAction, createGame, getLegalActions, hashState } from '../src/engine';
import type { CardDb, GameEvent, GameState, OtegeCardDef, Side } from '../src/engine/types';
import { arrange, deckOf, eventsOf, forceDice, ok, patchCard, startMain, type Layout } from './helpers';

/**
 * v2.0 の新しい決まり（UPDATE_v2 §4-1・§4-2・§4-4、SPEC §4-4・§4-5・§4-7、テスト E22〜E34）
 */

/** 両者のデッキ（id と枚数）とカードの並びを決めて、p1 のメインから始める */
function game(
  p1: [string, number][],
  p2: [string, number][],
  l1: Layout,
  l2: Layout,
  opts: { cardDb?: CardDb; firstTurnRule?: boolean } = {},
): GameState {
  let s = startMain({ decks: { p1: deckOf(p1), p2: deckOf(p2) }, cardDb: opts.cardDb, firstTurnRule: opts.firstTurnRule });
  s = arrange(s, 'p1', l1);
  s = arrange(s, 'p2', l2);
  return s;
}

/** 手番の人が、サイコロの目を決めてターンを終える */
function end(s: GameState, ...dice: number[]): { state: GameState; events: GameEvent[] } {
  return ok(forceDice(s, ...dice), { type: 'END_TURN', player: s.currentPlayer });
}

const act = (s: GameState, side: Side) => s.players[side].active!;
const hp = (s: GameState, uid: string) => s.cards[uid].hp;
const types = (events: GameEvent[]) => events.map((e) => e.type);

/** テスト専用のカードを足したカード表 */
function withCards(...defs: OtegeCardDef[]): CardDb {
  const db: CardDb = { ...CARD_DB };
  for (const d of defs) db[d.no] = d;
  return db;
}

describe('E07b 全48種のデータ', () => {
  it('全48種で、サイコロの目1〜6が過不足なく割り当てられている（技の無いアイテムを除く）', () => {
    expect(CARD_LIST).toHaveLength(48);
    for (const c of CARD_LIST) {
      if (c.kind !== 'otege') continue;
      const faces = c.moves.flatMap((m) => m.faces).sort((a, b) => a - b);
      expect(faces, `${c.no} ${c.name}`).toEqual([1, 2, 3, 4, 5, 6]);
      for (const m of c.moves) expect(m.effects.length, `${c.name} の技に効果が無い`).toBeGreaterThan(0);
    }
  });
});

describe('E22 先攻は1ターン目に攻撃できない', () => {
  it('先攻の1ターン目はサイコロを振らない。後攻の1ターン目・先攻の2ターン目は攻撃する', () => {
    let s = startMain({ firstTurnRule: true });
    expect(s.firstPlayer).toBe('p1');
    const r1 = end(s, 6);
    expect(eventsOf(r1.events, 'DiceRolled')).toEqual([]);
    expect(eventsOf(r1.events, 'TurnEnded')).toEqual([{ type: 'TurnEnded', player: 'p1', attacked: false, firstTurn: true }]);
    // 出したサイコロの目は使われずに残る（振っていない）
    expect(r1.state.forcedDice).toEqual([6]);
    s = { ...r1.state, forcedDice: [] };
    const r2 = end(s, 2);
    expect(eventsOf(r2.events, 'DiceRolled')).toEqual([{ type: 'DiceRolled', purpose: 'attack', player: 'p2', value: 2 }]);
    const r3 = end(r2.state, 2);
    expect(eventsOf(r3.events, 'DiceRolled')).toHaveLength(1);
    expect(eventsOf(r3.events, 'TurnEnded')[0]).toEqual({ type: 'TurnEnded', player: 'p1', attacked: true });
  });

  it('1ターン目でも、ベンチに出す・アイテム・交代はできる', () => {
    let s = game([['oteage', 10], ['kusuri', 5]], [['oteage', 15]], { active: 'oteage', bench: ['oteage'], hand: ['oteage', 'kusuri'] }, { active: 'oteage' }, { firstTurnRule: true });
    s = patchCard(s, act(s, 'p1'), { hp: 50 });
    s = ok(s, { type: 'PLACE_BENCH', player: 'p1', uid: s.players.p1.hand[0] }).state;
    s = ok(s, { type: 'USE_ITEM', player: 'p1', uid: s.players.p1.hand[0], targetUid: act(s, 'p1') }).state;
    s = ok(s, { type: 'SWAP', player: 'p1', benchUid: s.players.p1.bench[0] }).state;
    expect(s.players.p1.bench).toHaveLength(2);
  });

  it('ルールは RuleSet の firstPlayerFirstTurnNoAttack で切り替えられる（プレイヤー別）', () => {
    const s = startMain({ firstTurnRule: true, rules: { p1: { firstPlayerFirstTurnNoAttack: false } } });
    expect(eventsOf(end(s, 2).events, 'DiceRolled')).toHaveLength(1);
  });
});

describe('E23 持続ダメージ（相手のターンの終わり・攻撃を受けたおてあげへ）', () => {
  it('はさみ 20+10：今20、次の相手のターン終わり（相手の攻撃のあと）に10', () => {
    let s = game([['hasami', 15]], [['mutsuashi', 15]], { active: 'hasami' }, { active: 'mutsuashi' });
    const target = act(s, 'p2');
    const r1 = end(s, 1);
    expect(hp(r1.state, target)).toBe(140);
    expect(r1.state.lasting).toEqual([
      { seq: 1, owner: 'p1', holder: 'p2', kind: 'damage', amount: 10, targetUid: target, turns: 1, sourceUid: act(s, 'p1'), createdTurn: 1 },
    ]);
    // 相手のターンの始めには発動しない
    expect(eventsOf(r1.events, 'LastingFired')).toEqual([]);
    s = r1.state;
    const r2 = end(s, 1); // むつあし 1：回復10（140→150）→ そのあと持続の10（150→140）
    const order = types(r2.events).filter((t) => ['Healed', 'LastingFired', 'Damaged'].includes(t));
    expect(order).toEqual(['Healed', 'LastingFired', 'Damaged']);
    expect(hp(r2.state, target)).toBe(140);
    expect(r2.state.lasting).toEqual([]);
  });

  it('おおとろ 0+0+60：今は何も起きず、2回後の相手のターン終わりに60', () => {
    let s = game([['ootoro', 15]], [['mutsuashi', 15]], { active: 'ootoro' }, { active: 'mutsuashi' });
    const target = act(s, 'p2');
    let r = end(s, 1);
    expect(eventsOf(r.events, 'Damaged')).toEqual([]);
    expect(r.state.lasting).toHaveLength(1);
    expect(r.state.lasting[0]).toMatchObject({ amount: 60, turns: 2 });
    r = end(r.state, 4); // 1回後：まだ（4はダメージ20だが、むつあしは自分に打たないので p1 に）
    expect(eventsOf(r.events, 'LastingFired')).toEqual([]);
    expect(r.state.lasting[0].turns).toBe(1);
    r = end(r.state, 4); // p1：おおとろ 4 は1枚ドロー
    r = end(r.state, 1); // 2回後の相手のターン終わり：60
    expect(eventsOf(r.events, 'LastingFired')).toHaveLength(1);
    expect(eventsOf(r.events, 'Damaged').find((d) => d.uid === target)).toMatchObject({ amount: 60 });
  });

  it('どくさげ 10+10+10+10：相手のターン終わりごとに10ずつ3回', () => {
    let s = game([['dokusage', 15]], [['mutsuashi', 15]], { active: 'dokusage', bench: ['dokusage'] }, { active: 'mutsuashi' });
    const target = act(s, 'p2');
    let r = end(s, 1); // 160-10
    expect(r.state.lasting.map((l) => l.turns)).toEqual([1, 2, 3]);
    const fired: number[] = [];
    for (let i = 0; i < 3; i++) {
      r = end(r.state, 1); // p2：むつあし 1 は回復10
      fired.push(eventsOf(r.events, 'LastingFired').length);
      // p1 は交代して攻撃しない（新しい どくを付けない）
      const b = r.state.players.p1.bench[0];
      r = ok(r.state, { type: 'SWAP', player: 'p1', benchUid: b });
      r = end(r.state);
    }
    expect(fired).toEqual([1, 1, 1]);
    expect(r.state.lasting).toEqual([]);
    // 160 -10（今）→ 各回 +10回復 -10どく
    expect(hp(r.state, target)).toBe(150);
  });
});

describe('E24 持続回復・自分への持続ダメージ・持続ドロー（自分のターンの終わり）', () => {
  it('ゆきだるま 10+10回復：今10、次の自分のターン終わりに10（相手のターン終わりには発動しない）', () => {
    let s = game([['yukidaruma', 15]], [['mutsuashi', 15]], { active: 'yukidaruma' }, { active: 'mutsuashi' });
    const me = act(s, 'p1');
    s = patchCard(s, me, { hp: 50 });
    let r = end(s, 4);
    expect(hp(r.state, me)).toBe(60);
    expect(r.state.lasting[0]).toMatchObject({ kind: 'heal', amount: 10, targetUid: me, holder: 'p1', turns: 1 });
    r = end(r.state, 1); // p2 のターン終わり：発動しない
    expect(eventsOf(r.events, 'LastingFired')).toEqual([]);
    r = end(r.state, 1); // p1：ゆきだるま 1 は相手に20 → そのあと持続の回復10
    const order = types(r.events).filter((t) => ['Damaged', 'LastingFired', 'Healed'].includes(t));
    expect(order).toEqual(['Damaged', 'LastingFired', 'Healed']);
    expect(hp(r.state, me)).toBe(70);
  });

  it('自分への持続ダメージ・持続ドローも自分のターンの終わり（テスト用カード）', () => {
    const SELF: OtegeCardDef = {
      no: 901, id: 'test_self_later', name: 'テスト', kind: 'otege', rarity: 'normal', hp: 100, image: '', flavor: '',
      moves: [{ faces: [1, 2, 3, 4, 5, 6], effects: [{ type: 'selfDamage', amount: 0, then: [30] }, { type: 'draw', count: 0, then: [0, 2] }] }],
    };
    const db = withCards(SELF);
    let s = startMain({ cardDb: db, decks: { p1: Array(15).fill(901), p2: deckOf([['mutsuashi', 15]]) } });
    const me = act(s, 'p1');
    let r = end(s, 1);
    expect(r.state.lasting.map((l) => [l.kind, l.holder, l.turns])).toEqual([
      ['selfDamage', 'p1', 1],
      ['draw', 'p1', 2],
    ]);
    r = end(r.state, 1); // p2
    expect(eventsOf(r.events, 'LastingFired')).toEqual([]);
    const hand = r.state.players.p1.hand.length;
    r = end(r.state, 1); // p1：自分に30（新しく30が付き直す前に発動）
    expect(eventsOf(r.events, 'LastingFired').map((e) => e.lasting.kind)).toEqual(['selfDamage']);
    expect(hp(r.state, me)).toBe(70);
    r = end(r.state, 1); // p2
    r = end(r.state, 1); // p1：2回後のドロー2枚（＋2回目の技の自分への30）。持続ダメージが先、ドローは最後（v2.5）
    expect(eventsOf(r.events, 'LastingFired').map((e) => e.lasting.kind)).toEqual(['selfDamage', 'draw']);
    expect(eventsOf(r.events, 'Drew').filter((d) => d.player === 'p1')).toHaveLength(2);
    expect(r.state.players.p1.hand.length).toBeGreaterThanOrEqual(hand + 2);
  });
});

describe('E25 付く先：ベンチに戻ると消える・きぜつで消える・ドローはプレイヤーに', () => {
  it('持続ダメージを受けたおてあげがベンチに戻ったら、持続ダメージは消える（v2.5）', () => {
    let s = game([['hasami', 15]], [['mutsuashi', 15]], { active: 'hasami' }, { active: 'mutsuashi', bench: ['mutsuashi'] });
    const hit = act(s, 'p2');
    let r = end(s, 1);
    const other = r.state.players.p2.bench[0];
    r = ok(r.state, { type: 'SWAP', player: 'p2', benchUid: other });
    expect(eventsOf(r.events, 'LastingCleared')).toEqual([{ type: 'LastingCleared', uid: hit, seqs: [1] }]);
    expect(r.state.lasting).toEqual([]);
    r = end(r.state);
    expect(eventsOf(r.events, 'Damaged')).toEqual([]);
    expect(hp(r.state, hit)).toBe(140);
    expect(r.state.players.p2.bench).toContain(hit);
  });

  it('付いたおてあげがきぜつしたら、持続効果は消える', () => {
    let s = game([['hasami', 15]], [['mutsuashi', 15]], { active: 'hasami' }, { active: 'mutsuashi', bench: ['mutsuashi'] });
    const hit = act(s, 'p2');
    s = patchCard(s, hit, { hp: 25 });
    let r = end(s, 1); // 20 → HP5、どく10が付く
    expect(r.state.lasting).toHaveLength(1);
    r = end(r.state, 4); // p2：むつあし 4 は相手に20（どくはまだ）→ ターン終わりに どく10 できぜつ
    expect(eventsOf(r.events, 'Fainted')).toEqual([{ type: 'Fainted', uid: hit, by: 'p1', koCount: 1 }]);
    expect(r.state.lasting).toEqual([]);

    // ベンチに戻すと、どくは発動しない（v2.5）
    let t = game([['hasami', 15]], [['mutsuashi', 15]], { active: 'hasami' }, { active: 'mutsuashi', bench: ['mutsuashi'] });
    const hit2 = act(t, 'p2');
    t = patchCard(t, hit2, { hp: 45 });
    let q = end(t, 1); // 45-20=25、どく10（p2 のターン終わり）
    q = ok(q.state, { type: 'SWAP', player: 'p2', benchUid: q.state.players.p2.bench[0] });
    q = end(q.state); // ベンチに戻ったので どくは消えている
    expect(hp(q.state, hit2)).toBe(25);
    expect(q.state.lasting).toEqual([]);
  });

  it('たからばこ：自分に999で必ずきぜつ。ドロー（9回後に4枚）はプレイヤーに付き、きぜつしても続く', () => {
    let s = game([['takarabako', 3], ['mutsuashi', 12]], [['mutsuashi', 15]], { active: 'takarabako', bench: ['mutsuashi'] }, { active: 'mutsuashi' });
    const box = act(s, 'p1');
    let r = end(s, 1);
    expect(eventsOf(r.events, 'Fainted')).toEqual([{ type: 'Fainted', uid: box, by: 'p2', koCount: 1 }]);
    expect(r.state.lasting).toEqual([
      { seq: 1, owner: 'p1', holder: 'p1', kind: 'draw', amount: 4, targetUid: null, turns: 9, sourceUid: box, createdTurn: 1 },
    ]);
    // 自分のターンの終わりを8回見送り、9回目に4枚
    let firedAt = -1;
    for (let i = 1; i <= 9; i++) {
      r = end(r.state, 1); // p2：むつあし 1 は回復
      r = end(r.state, 1); // p1：むつあし 1 は回復
      if (eventsOf(r.events, 'LastingFired').length > 0) {
        firedAt = i;
        expect(eventsOf(r.events, 'Drew').filter((d) => d.player === 'p1').length).toBeGreaterThan(0);
      }
    }
    expect(firedAt).toBe(9);
  });
});

describe('E26 ばくだん（時限）', () => {
  it('6：相手に20、3回後の相手のターン終わりに、生きていればきぜつ（ベンチでも）。倒した数はばくだんの持ち主に', () => {
    let s = game([['bakudan', 1], ['oteage', 14]], [['mutsuashi', 15]], { active: 'bakudan', bench: ['oteage'] }, { active: 'mutsuashi', bench: ['mutsuashi'] });
    const hit = act(s, 'p2');
    let r = end(s, 6);
    expect(hp(r.state, hit)).toBe(140);
    expect(r.state.lasting).toEqual([
      { seq: 1, owner: 'p1', holder: 'p2', kind: 'faint', amount: 0, targetUid: hit, turns: 3, sourceUid: act(s, 'p1'), createdTurn: 1 },
    ]);
    r = end(r.state, 1); // 1回後（p2 のターン終わり）
    expect(r.state.lasting[0].turns).toBe(2);
    r = end(r.state, 1); // p1：ばくだん 1 は 0（何も起きない）
    expect(eventsOf(r.events, 'Damaged')).toEqual([]);
    r = end(r.state, 1); // 2回後
    expect(r.state.lasting[0].turns).toBe(1);
    r = end(r.state, 1);
    // p2 はばくだんの付いたおてあげをベンチへ下げる
    r = ok(r.state, { type: 'SWAP', player: 'p2', benchUid: r.state.players.p2.bench[0] });
    r = end(r.state); // 3回後：ベンチでもきぜつ
    expect(eventsOf(r.events, 'LastingFired').map((e) => e.lasting.kind)).toEqual(['faint']);
    expect(eventsOf(r.events, 'Fainted')).toEqual([{ type: 'Fainted', uid: hit, by: 'p1', koCount: 1 }]);
    expect(r.state.lasting).toEqual([]);
  });

  it('時限の前にきぜつしていたら何も起きない', () => {
    let s = game([['bakudan', 1], ['oteage', 14]], [['mutsuashi', 15]], { active: 'bakudan' }, { active: 'mutsuashi', bench: ['mutsuashi'] });
    const hit = act(s, 'p2');
    s = patchCard(s, hit, { hp: 30 });
    const r = end(s, 6); // 30-20=10、時限が付く
    s = patchCard(r.state, hit, { hp: 1 });
    const r2 = end(s, 4); // p2 むつあし 4 は相手に20。どくは無い
    expect(r2.state.lasting).toHaveLength(1);
    const r3 = end(r2.state, 5); // p1 ばくだん 5：相手に60 で きぜつ → 時限も消える
    expect(eventsOf(r3.events, 'Fainted')[0].uid).toBe(hit);
    expect(r3.state.lasting).toEqual([]);
  });
});

describe('E27 1つの技の中の処理順', () => {
  it('相手を倒して勝つ時は、自分へのダメージを行わない（からあげ）', () => {
    let s = game([['karaage', 15]], [['mutsuashi', 15]], { active: 'karaage' }, { active: 'mutsuashi', bench: ['mutsuashi'] });
    s = patchCard(s, act(s, 'p2'), { hp: 30 });
    s = structuredClone(s);
    s.players.p1.koCount = 2;
    const r = end(s, 1); // 相手に30（3体目 → 勝ち）、自分に10 は行わない
    expect(eventsOf(r.events, 'GameOver')).toEqual([{ type: 'GameOver', winner: 'p1', reason: 'ko' }]);
    expect(eventsOf(r.events, 'Damaged').map((d) => d.uid)).toEqual([act(s, 'p2')]);
    expect(hp(r.state, act(s, 'p1'))).toBe(10);
  });

  it('データに書いた順に関係なく、相手へのダメージ → 回復 → 自分へのダメージ → ドロー → 捨てる の順（テスト用カード）', () => {
    const MIX: OtegeCardDef = {
      no: 902, id: 'test_mix', name: 'テスト', kind: 'otege', rarity: 'normal', hp: 100, image: '', flavor: '',
      moves: [
        {
          faces: [1, 2, 3, 4, 5, 6],
          effects: [
            { type: 'discard', count: 1, deckIfNoHand: true },
            { type: 'draw', count: 1 },
            { type: 'selfDamage', amount: 10 },
            { type: 'heal', amount: 30 },
            { type: 'damage', amount: 20 },
          ],
        },
      ],
    };
    let s = startMain({ cardDb: withCards(MIX), decks: { p1: Array(15).fill(902), p2: deckOf([['mutsuashi', 15]]) } });
    s = structuredClone(s);
    s.players.p1.deck.push(...s.players.p1.hand);
    s.players.p1.hand = []; // 手札0：ドローの1枚がそのまま捨てられる
    s = patchCard(s, act(s, 'p1'), { hp: 50 });
    const r = end(s, 1);
    const seq = types(r.events).filter((t) => ['Damaged', 'Healed', 'Drew', 'Discarded'].includes(t));
    expect(seq).toEqual(['Damaged', 'Healed', 'Damaged', 'Drew', 'Discarded']);
    expect(eventsOf(r.events, 'Damaged').map((d) => d.uid)).toEqual([act(s, 'p2'), act(s, 'p1')]);
    expect(hp(r.state, act(s, 'p1'))).toBe(70);
  });

  it('はたあげ：相手に15、回復20／777ほん：相手に20 → 自分に100', () => {
    let s = game([['hataage', 15]], [['mutsuashi', 15]], { active: 'hataage' }, { active: 'mutsuashi' });
    s = patchCard(s, act(s, 'p1'), { hp: 30 });
    let r = end(s, 1);
    expect(hp(r.state, act(s, 'p2'))).toBe(145);
    expect(hp(r.state, act(s, 'p1'))).toBe(50);
    s = game([['hon777', 15]], [['mutsuashi', 15]], { active: 'hon777' }, { active: 'mutsuashi' });
    r = end(s, 1);
    expect(eventsOf(r.events, 'Damaged').map((d) => [d.uid, d.amount])).toEqual([
      [act(s, 'p2'), 20],
      [act(s, 'p1'), 100],
    ]);
    // 777ほん 6：自分に10 だけ（相手にはダメージなし）
    r = end(game([['hon777', 15]], [['mutsuashi', 15]], { active: 'hon777' }, { active: 'mutsuashi' }), 6);
    expect(eventsOf(r.events, 'Damaged').map((d) => d.amount)).toEqual([10]);
  });
});

describe('E28 自分へのダメージできぜつ', () => {
  it('相手の倒した数が増える。ベンチが空なら負け', () => {
    let s = game([['toriashi', 15]], [['mutsuashi', 15]], { active: 'toriashi' }, { active: 'mutsuashi' });
    s = patchCard(s, act(s, 'p1'), { hp: 20 });
    const r = end(s, 1); // 自分に20
    expect(eventsOf(r.events, 'Fainted')).toEqual([{ type: 'Fainted', uid: act(s, 'p1'), by: 'p2', koCount: 1 }]);
    expect(eventsOf(r.events, 'GameOver')).toEqual([{ type: 'GameOver', winner: 'p2', reason: 'noBench' }]);
  });

  it('ベンチがあれば、くりだしになる（3体目なら相手の勝ち）', () => {
    let s = game([['bakeage', 15]], [['mutsuashi', 15]], { active: 'bakeage', bench: ['bakeage'] }, { active: 'mutsuashi', bench: ['mutsuashi'] });
    // ばけあげ 1：相手に300（倒す）、自分に50（自分もきぜつ）→ 相討ち
    const r = end(s, 1);
    expect(eventsOf(r.events, 'Fainted').map((f) => [f.uid, f.by])).toEqual([
      [act(s, 'p2'), 'p1'],
      [act(s, 'p1'), 'p2'],
    ]);
    expect(r.state.players.p1.koCount).toBe(1);
    expect(r.state.players.p2.koCount).toBe(1);
    expect(r.state.phase).toBe('main');
    s = structuredClone(s);
    s.players.p2.koCount = 2;
    const r2 = end(s, 1);
    expect(eventsOf(r2.events, 'GameOver')).toEqual([{ type: 'GameOver', winner: 'p2', reason: 'ko' }]);
  });
});

describe('E29 ダメージを上げる効果が効く範囲', () => {
  it('やいばは「今すぐ1以上」のダメージだけ：持続の分・0ダメージ・回復には効かない', () => {
    let s = game([['hasami', 10], ['himitsu_yaiba', 5]], [['mutsuashi', 15]], { active: 'hasami', hand: ['himitsu_yaiba'] }, { active: 'mutsuashi' });
    s = ok(s, { type: 'USE_ITEM', player: 'p1', uid: s.players.p1.hand[0], targetUid: act(s, 'p1') }).state;
    const r = end(s, 1); // 20+20=40、持続は10のまま
    expect(hp(r.state, act(s, 'p2'))).toBe(120);
    expect(r.state.lasting[0].amount).toBe(10);

    let t = game([['bakudan', 1], ['oteage', 9], ['himitsu_yaiba', 5]], [['mutsuashi', 15]], { active: 'bakudan', hand: ['himitsu_yaiba'] }, { active: 'mutsuashi' });
    t = ok(t, { type: 'USE_ITEM', player: 'p1', uid: t.players.p1.hand[0], targetUid: act(t, 'p1') }).state;
    expect(eventsOf(end(t, 1).events, 'Damaged')).toEqual([]);

    // ルール補正（ボスの火力アップ）も同じ
    const u = startMain({ decks: { p1: deckOf([['ootoro', 15]]), p2: deckOf([['mutsuashi', 15]]) }, rules: { p1: { attackBonus: 20 } } });
    expect(eventsOf(end(u, 1).events, 'Damaged')).toEqual([]);
    const v = startMain({ decks: { p1: deckOf([['oteage', 15]]), p2: deckOf([['mutsuashi', 15]]) }, rules: { p1: { attackBonus: 20 } } });
    expect(eventsOf(end(v, 1).events, 'Damaged')[0].amount).toBe(50);
  });
});

describe('E30 手札を捨てる（もやす）', () => {
  const setup = (hand: string[], deckLeft: number | null) => {
    let s = game([['moyasu', 5], ['oteage', 5], ['kusuri', 5]], [['mutsuashi', 15]], { active: 'moyasu', hand }, { active: 'mutsuashi' });
    if (deckLeft !== null) {
      s = structuredClone(s);
      s.players.p1.discard.push(...s.players.p1.deck.splice(deckLeft));
    }
    return s;
  };

  it('手札が2枚以上なら選ぶ（CHOOSE）。選ぶまで止まり、選んだら続きを行う', () => {
    const s = setup(['oteage', 'kusuri', 'kusuri'], null);
    const r = end(s, 1);
    expect(r.state.phase).toBe('choose');
    expect(r.state.pendingChoice).toMatchObject({ player: 'p1', kind: 'discard', count: 1, options: s.players.p1.hand });
    expect(eventsOf(r.events, 'ChoiceNeeded')).toEqual([{ type: 'ChoiceNeeded', player: 'p1', kind: 'discard', count: 1 }]);
    expect(eventsOf(r.events, 'TurnEnded')).toEqual([]);
    // 選ぶ待ちの間は、ほかの操作はできない
    expect(applyAction(r.state, { type: 'END_TURN', player: 'p1' }).rejected).toBe('wrongPhase');
    expect(applyAction(r.state, { type: 'CHOOSE', player: 'p2', uids: [s.players.p1.hand[0]] }).rejected).toBe('notYourTurn');
    expect(applyAction(r.state, { type: 'CHOOSE', player: 'p1', uids: [] }).rejected).toBe('badChoice');
    expect(applyAction(r.state, { type: 'CHOOSE', player: 'p1', uids: s.players.p1.hand.slice(0, 2) }).rejected).toBe('badChoice');
    expect(applyAction(r.state, { type: 'CHOOSE', player: 'p1', uids: [act(s, 'p2')] }).rejected).toBe('badChoice');
    // 合法手は CHOOSE だけ（手札の数だけ）
    expect(getLegalActions(r.state, 'p1').map((a) => a.type)).toEqual(['CHOOSE', 'CHOOSE', 'CHOOSE']);
    expect(getLegalActions(r.state, 'p2')).toEqual([]);
    const pick = s.players.p1.hand[1];
    const r2 = ok(r.state, { type: 'CHOOSE', player: 'p1', uids: [pick] });
    expect(eventsOf(r2.events, 'Discarded')).toEqual([{ type: 'Discarded', player: 'p1', uids: [pick], fromDeck: false }]);
    expect(eventsOf(r2.events, 'TurnStarted')).toEqual([{ type: 'TurnStarted', player: 'p2', turn: 1 }]);
    expect(r2.state.phase).toBe('main');
    expect(r2.state.players.p1.hand).toHaveLength(2);
    expect(r2.state.players.p1.discard).toContain(pick);
    // 選ぶ待ちをはさんでも決定論（同じ操作 → 同じ状態）
    expect(hashState(ok(r.state, { type: 'CHOOSE', player: 'p1', uids: [pick] }).state)).toBe(hashState(r2.state));
  });

  it('手札が1枚なら選ばずに捨てる。手札0なら山札の一番上。山札も0なら何もしない', () => {
    let r = end(setup(['kusuri'], null), 1);
    expect(r.state.phase).toBe('main');
    expect(eventsOf(r.events, 'Discarded')[0]).toMatchObject({ fromDeck: false });
    const s0 = setup([], null);
    const top = s0.players.p1.deck[0];
    r = end(s0, 1);
    expect(eventsOf(r.events, 'Discarded')).toEqual([{ type: 'Discarded', player: 'p1', uids: [top], fromDeck: true }]);
    r = end(setup([], 0), 1);
    expect(eventsOf(r.events, 'Discarded')).toEqual([]);
    expect(r.state.currentPlayer).toBe('p2');
  });
});

describe('E31 ベンチと交代（ぶんぶんぶん）', () => {
  it('ベンチが2体なら選ぶ。出したばかりでも交代でき、交代したターン扱いにもならない', () => {
    let s = game([['bunbunbun', 15]], [['mutsuashi', 15]], { active: 'bunbunbun', bench: ['bunbunbun'], hand: ['bunbunbun'] }, { active: 'mutsuashi' });
    s = ok(s, { type: 'PLACE_BENCH', player: 'p1', uid: s.players.p1.hand[0] }).state; // 出したばかり
    const fresh = s.players.p1.bench[1];
    const r = end(s, 3);
    expect(r.state.pendingChoice).toMatchObject({ kind: 'switch', count: 1, options: s.players.p1.bench });
    const r2 = ok(r.state, { type: 'CHOOSE', player: 'p1', uids: [fresh] });
    expect(eventsOf(r2.events, 'Swapped')).toEqual([{ type: 'Swapped', player: 'p1', toActive: fresh, toBench: act(s, 'p1'), byEffect: true }]);
    expect(r2.state.players.p1.active).toBe(fresh);
    expect(eventsOf(r2.events, 'TurnEnded')).toEqual([{ type: 'TurnEnded', player: 'p1', attacked: true }]);
  });

  it('1体なら自動、0体なら何もしない', () => {
    let s = game([['bunbunbun', 15]], [['mutsuashi', 15]], { active: 'bunbunbun', bench: ['bunbunbun'] }, { active: 'mutsuashi' });
    let r = end(s, 3);
    expect(r.state.players.p1.active).toBe(s.players.p1.bench[0]);
    s = game([['bunbunbun', 15]], [['mutsuashi', 15]], { active: 'bunbunbun' }, { active: 'mutsuashi' });
    r = end(s, 3);
    expect(eventsOf(r.events, 'Swapped')).toEqual([]);
    expect(r.state.players.p1.active).toBe(act(s, 'p1'));
  });
});

describe('E32 ひきかえカード', () => {
  it('山札0枚では使えない', () => {
    let s = game([['oteage', 10], ['hikikae', 5]], [['mutsuashi', 15]], { active: 'oteage', hand: ['hikikae'] }, { active: 'mutsuashi' });
    s = structuredClone(s);
    s.players.p1.discard.push(...s.players.p1.deck.splice(0));
    expect(applyAction(s, { type: 'USE_ITEM', player: 'p1', uid: s.players.p1.hand[0] }).rejected).toBe('deckEmpty');
    expect(getLegalActions(s, 'p1').some((a) => a.type === 'USE_ITEM')).toBe(false);
  });

  it('おてあげを対象にはできない。使うと山札から選び、選んだ1枚が手札に入り、山札が切られる', () => {
    const s = game([['oteage', 10], ['hikikae', 5]], [['mutsuashi', 15]], { active: 'oteage', hand: ['hikikae'] }, { active: 'mutsuashi' });
    const item = s.players.p1.hand[0];
    expect(applyAction(s, { type: 'USE_ITEM', player: 'p1', uid: item, targetUid: act(s, 'p1') }).rejected).toBe('badTarget');
    const r = ok(s, { type: 'USE_ITEM', player: 'p1', uid: item });
    expect(r.state.phase).toBe('choose');
    expect(r.state.pendingChoice).toMatchObject({ kind: 'search', count: 1 });
    expect([...r.state.pendingChoice!.options].sort()).toEqual([...s.players.p1.deck].sort());
    const pick = s.players.p1.deck[5];
    const r2 = ok(r.state, { type: 'CHOOSE', player: 'p1', uids: [pick] });
    expect(r2.state.players.p1.hand).toEqual([pick]);
    expect(r2.state.players.p1.deck).toHaveLength(s.players.p1.deck.length - 1);
    expect(types(r2.events)).toEqual(['Searched', 'DeckShuffled']);
    expect(r2.state.phase).toBe('main');
    expect(r2.state.players.p1.discard).toContain(item);
  });
});

describe('E33 やばいつぼ', () => {
  it('手札（このカードを含めて）2枚未満では使えない', () => {
    const s = game([['oteage', 10], ['yabaitsubo', 5]], [['mutsuashi', 15]], { active: 'oteage', hand: ['yabaitsubo'] }, { active: 'mutsuashi' });
    expect(applyAction(s, { type: 'USE_ITEM', player: 'p1', uid: s.players.p1.hand[0] }).rejected).toBe('handTooSmall');
  });

  it('2枚引いて、3枚選んで捨てる', () => {
    const s = game([['oteage', 10], ['yabaitsubo', 1], ['kusuri', 4]], [['mutsuashi', 15]], { active: 'oteage', hand: ['yabaitsubo', 'kusuri', 'kusuri'] }, { active: 'mutsuashi' });
    const r = ok(s, { type: 'USE_ITEM', player: 'p1', uid: s.players.p1.hand[0] });
    expect(eventsOf(r.events, 'Drew')).toHaveLength(2);
    expect(r.state.pendingChoice).toMatchObject({ kind: 'discard', count: 3 });
    expect(r.state.pendingChoice!.options).toHaveLength(4);
    const pick = r.state.pendingChoice!.options.slice(0, 3);
    const r2 = ok(r.state, { type: 'CHOOSE', player: 'p1', uids: pick });
    expect(r2.state.players.p1.hand).toHaveLength(1);
    expect(r2.state.phase).toBe('main');
  });

  it('引いた結果、手札が3枚以下なら全部捨てる（選ばない）', () => {
    let s = game([['oteage', 10], ['yabaitsubo', 1], ['kusuri', 4]], [['mutsuashi', 15]], { active: 'oteage', hand: ['yabaitsubo', 'kusuri'] }, { active: 'mutsuashi' });
    s = structuredClone(s);
    s.players.p1.discard.push(...s.players.p1.deck.splice(1)); // 山札1枚：引けるのは1枚だけ
    const r = ok(s, { type: 'USE_ITEM', player: 'p1', uid: s.players.p1.hand[0] });
    expect(eventsOf(r.events, 'Drew')).toHaveLength(1);
    expect(r.state.phase).toBe('main');
    expect(r.state.players.p1.hand).toEqual([]);
    expect(eventsOf(r.events, 'Discarded')[0].uids).toHaveLength(2);
  });
});

describe('E34 999回復・自分に999', () => {
  it('999回復は最大まで、自分に999はHPに関係なく必ずきぜつ', () => {
    let s = game([['hosoage', 15]], [['mutsuashi', 15]], { active: 'hosoage', bench: ['hosoage'] }, { active: 'mutsuashi' });
    s = patchCard(s, act(s, 'p1'), { hp: 1 });
    let r = end(s, 1);
    expect(hp(r.state, act(s, 'p1'))).toBe(50);
    expect(eventsOf(r.events, 'Healed')[0].amount).toBe(49);
    r = end(game([['hosoage', 15]], [['mutsuashi', 15]], { active: 'hosoage', bench: ['hosoage'] }, { active: 'mutsuashi' }), 6);
    expect(eventsOf(r.events, 'Fainted')[0]).toMatchObject({ by: 'p2' });
  });
});

describe('カードを ためす（デバッグ。SPEC §7 S99）', () => {
  it('置いたカードのまま、p1 のメインから始まり、決めた目の順にサイコロが出る', () => {
    const no = (id: string) => CARD_LIST.find((c) => c.id === id)!.no;
    const deck = Array(10).fill(no('oteage'));
    const { state, events } = createGame({
      seed: 'lab',
      decks: { p1: [], p2: [] },
      cardDb: CARD_DB,
      forcedDice: [6, 1],
      rules: { p1: { firstPlayerFirstTurnNoAttack: false }, p2: { firstPlayerFirstTurnNoAttack: false } },
      sandbox: {
        p1: { active: no('bakudan'), bench: [no('hasami')], hand: [no('hikikae')], deck },
        p2: { active: no('mutsuashi'), bench: [], hand: [], deck },
      },
    });
    expect(state.phase).toBe('main');
    expect(state.currentPlayer).toBe('p1');
    expect(state.cards[state.players.p1.active!].no).toBe(no('bakudan'));
    expect(state.players.p1.bench.map((u) => state.cards[u].no)).toEqual([no('hasami')]);
    expect(state.players.p1.hand.map((u) => state.cards[u].no)).toEqual([no('hikikae')]);
    expect(state.players.p1.deck).toHaveLength(10);
    expect(types(events)).toEqual(['ActivesRevealed', 'TurnStarted']);
    const r = end(state);
    expect(eventsOf(r.events, 'DiceRolled')[0].value).toBe(6);
    expect(r.state.lasting[0].kind).toBe('faint');
    expect(eventsOf(end(r.state).events, 'DiceRolled')[0].value).toBe(1);
  });
});

describe('選ぶ・持続効果と くりだし', () => {
  it('もやすで相手を倒し（相手のベンチ2体）、手札を選んで捨てる → 相手のくりだし → 相手のターン', () => {
    let s = game([['moyasu', 5], ['kusuri', 10]], [['mutsuashi', 15]], { active: 'moyasu', hand: ['kusuri', 'kusuri', 'kusuri'] }, { active: 'mutsuashi', bench: ['mutsuashi', 'mutsuashi'] });
    s = patchCard(s, act(s, 'p2'), { hp: 50 });
    const r = end(s, 1);
    expect(eventsOf(r.events, 'Fainted')).toHaveLength(1);
    expect(r.state.phase).toBe('choose');
    expect(r.state.pendingPromote).toEqual(['p2']);
    // 選ぶ待ちの間は、くりだしもできない
    expect(applyAction(r.state, { type: 'PROMOTE', player: 'p2', benchUid: r.state.players.p2.bench[0] }).rejected).toBe('wrongPhase');
    const r2 = ok(r.state, { type: 'CHOOSE', player: 'p1', uids: [s.players.p1.hand[0]] });
    expect(r2.state.phase).toBe('promote');
    expect(eventsOf(r2.events, 'TurnEnded')).toHaveLength(1);
    const r3 = ok(r2.state, { type: 'PROMOTE', player: 'p2', benchUid: r2.state.players.p2.bench[1] });
    expect(eventsOf(r3.events, 'TurnStarted')).toEqual([{ type: 'TurnStarted', player: 'p2', turn: 1 }]);
    expect(r3.state.phase).toBe('main');
  });

  it('どくで倒した時：倒した数は付けた人に。相手のターン終わりなら、くりだしてから自分のターン', () => {
    let s = game([['hasami', 15]], [['mutsuashi', 15]], { active: 'hasami' }, { active: 'mutsuashi', bench: ['mutsuashi', 'mutsuashi'] });
    const hit = act(s, 'p2');
    s = patchCard(s, hit, { hp: 25 });
    const r = end(s, 1); // 25-20=5、どく10
    const r2 = end(r.state, 4); // p2 の攻撃 → ターン終わりに どく10 で きぜつ
    expect(eventsOf(r2.events, 'Fainted')).toEqual([{ type: 'Fainted', uid: hit, by: 'p1', koCount: 1 }]);
    expect(r2.state.phase).toBe('promote');
    expect(r2.state.pendingPromote).toEqual(['p2']);
    const r3 = ok(r2.state, { type: 'PROMOTE', player: 'p2', benchUid: r2.state.players.p2.bench[0] });
    expect(eventsOf(r3.events, 'TurnStarted')).toEqual([{ type: 'TurnStarted', player: 'p1', turn: 2 }]);
  });
});
