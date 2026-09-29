import { describe, expect, it } from 'vitest';
import { CARD_DB, CARD_LIST } from '../src/data/cards';
import { starterDeckNos } from '../src/data/starterDeck';
import {
  type Action,
  type GameState,
  type Side,
  applyAction,
  createGame,
  getLegalActions,
  hashState,
  seedRng,
  validateDeck,
} from '../src/engine';
import { nextInt } from '../src/engine/rng';
import { deckOf, eventsOf, noOf } from './helpers';

/** 合法手からランダムに選んで1試合進める。選んだ操作の列と、各手のあとのハッシュを返す */
function randomPlay(seed: string, chooserSeed: string, { maxSteps = 3000, withHash = true } = {}) {
  let { state } = createGame({ seed, decks: { p1: starterDeckNos(), p2: starterDeckNos() }, cardDb: CARD_DB });
  const chooser = seedRng(chooserSeed);
  const actions: Action[] = [];
  const hashes: string[] = [];
  for (let step = 0; step < maxSteps && state.phase !== 'over'; step++) {
    const legal = [...getLegalActions(state, 'p1'), ...getLegalActions(state, 'p2')];
    if (legal.length === 0) break;
    const action = legal[nextInt(chooser, legal.length)];
    const r = applyAction(state, action);
    if (r.rejected) throw new Error(`合法手が弾かれた: ${JSON.stringify(action)} ${r.rejected}`);
    if (withHash) checkInvariants(r.state);
    state = r.state;
    actions.push(action);
    if (withHash) hashes.push(hashState(state));
  }
  return { state, actions, hashes };
}

/** どの時点でも成り立つはずのこと */
function checkInvariants(s: GameState) {
  for (const side of ['p1', 'p2'] as Side[]) {
    const ps = s.players[side];
    const zones = [...ps.deck, ...ps.hand, ...ps.bench, ...ps.discard, ...(ps.active ? [ps.active] : [])];
    expect(zones.length).toBe(15);
    expect(new Set(zones).size).toBe(15);
    expect(ps.bench.length).toBeLessThanOrEqual(s.rules[side].benchMax);
  }
  for (const c of Object.values(s.cards)) {
    expect(c.hp).toBeGreaterThanOrEqual(0);
    expect(c.hp).toBeLessThanOrEqual(c.maxHp);
  }
}

describe('準備と決定論', () => {
  it('E01 同じ種・同じ操作列 → 同じ状態ハッシュになる', () => {
    const a = randomPlay('seed-A', 'chooser-1');
    const b = randomPlay('seed-A', 'chooser-1');
    expect(a.hashes).toEqual(b.hashes);
    expect(a.actions.length).toBeGreaterThan(10);

    // 記録した操作の列を、最初の状態から流し直しても同じになる（ロックステップの前提）
    let { state } = createGame({ seed: 'seed-A', decks: { p1: starterDeckNos(), p2: starterDeckNos() }, cardDb: CARD_DB });
    for (const action of a.actions) state = applyAction(state, action).state;
    expect(hashState(state)).toBe(a.hashes[a.hashes.length - 1]);

    // 種が違えば結果も変わる
    const c = randomPlay('seed-B', 'chooser-1');
    expect(c.hashes).not.toEqual(a.hashes);
  });

  it('E01 たくさんの試合をランダムに進めても、エラーや矛盾が起きない', () => {
    let finished = 0;
    for (let i = 0; i < 60; i++) {
      const r = randomPlay(`fuzz-${i}`, `pick-${i}`, { withHash: false });
      checkInvariants(r.state);
      if (r.state.phase === 'over') finished++;
    }
    expect(finished).toBeGreaterThan(50);
  });

  it('E02 先攻決めで同じ目なら振り直す', () => {
    const decks = { p1: starterDeckNos(), p2: starterDeckNos() };
    const a = createGame({ seed: 's', decks, cardDb: CARD_DB, forcedDice: [3, 3, 5, 2] });
    expect(eventsOf(a.events, 'DiceRolled').map((e) => [e.player, e.value])).toEqual([
      ['p1', 3],
      ['p2', 3],
      ['p1', 5],
      ['p2', 2],
    ]);
    expect(a.state.firstPlayer).toBe('p1');

    const b = createGame({ seed: 's', decks, cardDb: CARD_DB, forcedDice: [2, 2, 4, 4, 1, 6] });
    expect(eventsOf(b.events, 'DiceRolled')).toHaveLength(6);
    expect(b.state.firstPlayer).toBe('p2');
    expect(b.state.currentPlayer).toBe('p2');

    // 乱数でも、同じ目のまま終わることはない
    for (let i = 0; i < 100; i++) {
      const g = createGame({ seed: `order-${i}`, decks, cardDb: CARD_DB });
      const rolls = eventsOf(g.events, 'DiceRolled');
      const [x, y] = rolls.slice(-2);
      expect(x.value).not.toBe(y.value);
      expect(g.state.firstPlayer).toBe(x.value > y.value ? 'p1' : 'p2');
      for (let k = 0; k < rolls.length - 2; k += 2) expect(rolls[k].value).toBe(rolls[k + 1].value);
    }
  });

  it('E03 初手におてあげがいなければ引き直し、最終的に必ずおてあげが1枚以上ある', () => {
    // おてあげ1枚＋アイテム14枚：引き直しが起きやすいデッキ
    const thin = deckOf([
      ['oteage', 1],
      ['kusuri', 14],
    ]);
    let mulligans = 0;
    for (let i = 0; i < 200; i++) {
      const g = createGame({ seed: `mull-${i}`, decks: { p1: thin, p2: starterDeckNos() }, cardDb: CARD_DB });
      mulligans += eventsOf(g.events, 'Mulligan').filter((e) => e.player === 'p1').length;
      for (const side of ['p1', 'p2'] as Side[]) {
        const hand = g.state.players[side].hand;
        expect(hand).toHaveLength(5);
        expect(hand.some((u) => CARD_DB[g.state.cards[u].no].kind === 'otege')).toBe(true);
        expect(g.state.players[side].deck).toHaveLength(10);
      }
    }
    expect(mulligans).toBeGreaterThan(0);
  });

  it('E07 技の目の割り当てが全カードで1〜6を過不足なく覆っている', () => {
    const oteges = CARD_LIST.filter((c) => c.kind === 'otege');
    expect(oteges.length).toBe(8);
    for (const c of oteges) {
      if (c.kind !== 'otege') continue;
      const faces = c.moves.flatMap((m) => m.faces).sort((a, b) => a - b);
      expect(faces, c.id).toEqual([1, 2, 3, 4, 5, 6]);
    }
  });

  it('E16 デッキ検証：15枚ちょうど／おてあげ1枚以上／スーパー合計1枚まで', () => {
    expect(validateDeck(starterDeckNos(), CARD_DB)).toEqual([]);

    const short = starterDeckNos().slice(0, 14);
    expect(validateDeck(short, CARD_DB)).toEqual([{ code: 'size', count: 14, need: 15 }]);
    expect(validateDeck([...starterDeckNos(), noOf('kusuri')], CARD_DB)).toEqual([{ code: 'size', count: 16, need: 15 }]);

    const noOtege = deckOf([['kusuri', 15]]);
    expect(validateDeck(noOtege, CARD_DB)).toEqual([{ code: 'noOtege' }]);

    // レボリューションとかみを両方入れることはできない
    const both = deckOf([
      ['revolution', 1],
      ['kami', 1],
      ['oteage', 13],
    ]);
    expect(validateDeck(both, CARD_DB)).toEqual([{ code: 'tooManySuper', count: 2, max: 1 }]);
    const twoKami = deckOf([
      ['kami', 2],
      ['oteage', 13],
    ]);
    expect(validateDeck(twoKami, CARD_DB)).toEqual([{ code: 'tooManySuper', count: 2, max: 1 }]);

    // 通常おてあげ・アイテムは同じカードを何枚でも
    expect(validateDeck(deckOf([['oteage', 15]]), CARD_DB)).toEqual([]);
    expect(validateDeck(deckOf([['oteage', 1], ['supodori', 14]]), CARD_DB)).toEqual([]);

    const unknown = [...starterDeckNos().slice(0, 14), 999];
    expect(validateDeck(unknown, CARD_DB)).toContainEqual({ code: 'unknownCard', no: 999 });
  });
});

describe('デバッグ用の設定', () => {
  it('山札の上を指定できる（配ったあとの山札の上から順）', () => {
    const decks = { p1: starterDeckNos(), p2: starterDeckNos() };
    const want = [noOf('kami'), noOf('supodori'), noOf('kusuri')];
    for (let i = 0; i < 20; i++) {
      const g = createGame({ seed: `stack-${i}`, decks, cardDb: CARD_DB, stackTop: { p1: want } });
      const deck = g.state.players.p1.deck;
      const handNos = g.state.players.p1.hand.map((u) => g.state.cards[u].no);
      // 手札に来てしまったカードは山札に無いので飛ばされる
      const expected = want.filter((no, k) => {
        const inHand = handNos.filter((h) => h === no).length;
        const total = decks.p1.filter((d) => d === no).length;
        const wantedBefore = want.slice(0, k).filter((w) => w === no).length;
        return total - inHand - wantedBefore > 0;
      });
      expect(deck.slice(0, expected.length).map((u) => g.state.cards[u].no)).toEqual(expected);
      expect(deck.length + g.state.players.p1.hand.length).toBe(15);
    }
  });
});

describe('デバッグ用の設定（サイコロ）', () => {
  it('サイコロの目を固定すると、攻撃の目は毎回その目になる（先攻決めは乱数のまま）', () => {
    const decks = { p1: starterDeckNos(), p2: starterDeckNos() };
    let { state } = createGame({ seed: 'fixed', decks, cardDb: CARD_DB, fixedDie: 6 });
    expect(state.fixedDie).toBe(6);
    for (const side of ['p1', 'p2'] as Side[]) {
      const uid = state.players[side].hand.find((u) => CARD_DB[state.cards[u].no].kind === 'otege')!;
      state = applyAction(state, { type: 'SETUP_ACTIVE', player: side, uid }).state;
    }
    for (let i = 0; i < 4 && state.phase === 'main'; i++) {
      const r = applyAction(state, { type: 'END_TURN', player: state.currentPlayer });
      for (const e of eventsOf(r.events, 'DiceRolled')) expect(e.value).toBe(6);
      state = r.state;
    }
  });
});
