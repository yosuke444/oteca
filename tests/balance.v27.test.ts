import { describe, expect, it } from 'vitest';
import { cardById } from '../src/data/cards';
import { getLegalActions, validateAction } from '../src/engine';
import type { Action, GameState, Side } from '../src/engine/types';
import { decide } from '../src/cpu/brains';
import { seededRand } from '../src/cpu/random';
import { protocolVersion } from '../src/config/version';
import { arrange, deckOf, eventsOf, forceDice, ok, patchCard, startMain, type Layout } from './helpers';

/**
 * v2.7 バランス調整（企画者の指示）：4枚の数値（①②）と、きみょうなドリンクを使ったおてあげは回復できない（③〜⑥）
 */

function game(p1: [string, number][], p2: [string, number][], l1: Layout, l2: Layout): GameState {
  let s = startMain({ decks: { p1: deckOf(p1), p2: deckOf(p2) } });
  s = arrange(s, 'p1', l1);
  return arrange(s, 'p2', l2);
}
const end = (s: GameState, ...dice: number[]) => ok(forceDice(s, ...dice), { type: 'END_TURN', player: s.currentPlayer });
const act = (s: GameState, side: Side) => s.players[side].active!;
const hand = (s: GameState, side: Side, id: string) => s.players[side].hand.filter((u) => s.cardDefs[s.cards[u].no].id === id);
const hits = (r: { state: GameState; events: ReturnType<typeof end>['events'] }, side: Side) =>
  eventsOf(r.events, 'Damaged')
    .filter((d) => r.state.cards[d.uid].owner === side)
    .map((d) => d.amount);

describe('① 4枚の新しい数値どおりに、ダメージ・HP・交代が起きる', () => {
  it('777ほん（HP250）：1 相手に10・自分に70／2-5 相手に20・自分に40／6 相手に20・自分に30', () => {
    const s = game([['hon777', 15]], [['mutsuashi', 15]], { active: 'hon777' }, { active: 'mutsuashi' });
    expect(s.cards[act(s, 'p1')].maxHp).toBe(250);
    for (const [face, opp, self] of [[1, 10, 70], [2, 20, 40], [3, 20, 40], [4, 20, 40], [5, 20, 40], [6, 20, 30]]) {
      const r = end(s, face);
      expect(hits(r, 'p2'), `目${face}`).toEqual([opp]);
      expect(hits(r, 'p1'), `目${face}`).toEqual([self]);
      expect(r.state.cards[act(s, 'p1')].hp, `目${face}`).toBe(250 - self);
    }
  });

  it('もやす HP60・おてさげ HP60', () => {
    expect(cardById('moyasu')).toMatchObject({ hp: 60 });
    expect(cardById('otesage')).toMatchObject({ hp: 60 });
    const s = game([['moyasu', 5], ['otesage', 5], ['oteage', 5]], [['mutsuashi', 15]], { active: 'moyasu', bench: ['otesage'] }, { active: 'mutsuashi' });
    expect(s.cards[act(s, 'p1')].maxHp).toBe(60);
    expect(s.cards[s.players.p1.bench[0]].maxHp).toBe(60);
  });

  it('ぶんぶんぶん HP10：1 相手に20だけ／2-6 相手に40・ベンチと交代', () => {
    const s = game([['bunbunbun', 5], ['mutsuashi', 10]], [['mutsuashi', 15]], { active: 'bunbunbun', bench: ['mutsuashi'] }, { active: 'mutsuashi' });
    const me = act(s, 'p1');
    expect(s.cards[me].maxHp).toBe(10);
    let r = end(s, 1);
    expect(hits(r, 'p2')).toEqual([20]);
    expect(eventsOf(r.events, 'Swapped')).toEqual([]);
    for (const face of [2, 3, 4, 5, 6]) {
      r = end(s, face);
      expect(hits(r, 'p2'), `目${face}`).toEqual([40]);
      expect(eventsOf(r.events, 'Swapped'), `目${face}`).toMatchObject([{ player: 'p1', toBench: me, byEffect: true }]);
    }
  });
});

describe('② もやす 4-6 は手札を2枚捨てる（自分で選ぶ）。手札が1枚なら1枚だけ、0枚なら今までどおり山札の上', () => {
  it('手札3枚：2枚を選んで捨てる', () => {
    const s = game([['moyasu', 5], ['kusuri', 10]], [['mutsuashi', 15]], { active: 'moyasu', hand: ['kusuri', 'kusuri', 'kusuri'] }, { active: 'mutsuashi' });
    const r = end(s, 4);
    expect(hits(r, 'p2')).toEqual([80]);
    expect(r.state.pendingChoice).toMatchObject({ player: 'p1', kind: 'discard', count: 2 });
    const pick = r.state.pendingChoice!.options.slice(0, 2);
    const c = ok(r.state, { type: 'CHOOSE', player: 'p1', uids: pick });
    expect(eventsOf(c.events, 'Discarded')).toMatchObject([{ player: 'p1', uids: pick, fromDeck: false }]);
    expect(c.state.players.p1.hand).toHaveLength(1);
    // 1-3 は1枚
    const r1 = end(s, 2);
    expect(r1.state.pendingChoice).toMatchObject({ kind: 'discard', count: 1 });
  });

  it('手札1枚：その1枚だけ（選ばない）。手札0枚：山札の一番上を1枚', () => {
    const s1 = game([['moyasu', 5], ['kusuri', 10]], [['mutsuashi', 15]], { active: 'moyasu', hand: ['kusuri'] }, { active: 'mutsuashi' });
    const r1 = end(s1, 5);
    expect(r1.state.pendingChoice).toBeNull();
    expect(eventsOf(r1.events, 'Discarded')).toMatchObject([{ uids: [s1.players.p1.hand[0]], fromDeck: false }]);
    expect(r1.state.players.p1.hand).toEqual([]);
    const s0 = game([['moyasu', 5], ['kusuri', 10]], [['mutsuashi', 15]], { active: 'moyasu', hand: [] }, { active: 'mutsuashi' });
    const top = s0.players.p1.deck[0];
    const r0 = end(s0, 6);
    expect(eventsOf(r0.events, 'Discarded')).toMatchObject([{ uids: [top], fromDeck: true }]);
  });
});

/** みつめ（目1：30回復）をバトル場、ゆきだるま（目4-6：10回復＋あとから10回復）をベンチ。手札にドリンク・くすり・スポドリ */
function drinkGame(): GameState {
  let s = game(
    [['mitsume', 3], ['yukidaruma', 3], ['kimyou_drink', 3], ['kusuri', 3], ['supodori', 3]],
    [['mutsuashi', 15]],
    { active: 'mitsume', bench: ['yukidaruma'], hand: ['kimyou_drink', 'kusuri', 'supodori'] },
    { active: 'mutsuashi' },
  );
  s = patchCard(s, s.players.p1.bench[0], { hp: 50 });
  return s;
}
const use = (s: GameState, id: string, target: string) => ok(s, { type: 'USE_ITEM', player: 'p1', uid: hand(s, 'p1', id)[0], targetUid: target });

describe('③ ドリンクを使ったおてあげは、技・持続回復・くすり・スポドリのどれでも回復しない', () => {
  it('技の回復：数字の代わりに HealBlocked（HP は 10 のまま）', () => {
    const s = drinkGame();
    const me = act(s, 'p1');
    const d = use(s, 'kimyou_drink', me);
    expect(d.state.cards[me].hp).toBe(10);
    const r = end(d.state, 1); // みつめ 目1：30回復
    expect(eventsOf(r.events, 'Healed')).toEqual([]);
    expect(eventsOf(r.events, 'HealBlocked')).toEqual([{ type: 'HealBlocked', uid: me }]);
    expect(r.state.cards[me].hp).toBe(10);
  });

  it('くすり・スポドリ：使えない（healBlocked）。合法手にも出ない。ほかのおてあげには使える', () => {
    let s = drinkGame();
    const yuki = s.players.p1.bench[0];
    s = use(s, 'kimyou_drink', yuki).state;
    expect(s.cards[yuki].hp).toBe(10);
    expect(validateAction(s, { type: 'USE_ITEM', player: 'p1', uid: hand(s, 'p1', 'kusuri')[0], targetUid: yuki })).toBe('healBlocked');
    expect(validateAction(s, { type: 'USE_ITEM', player: 'p1', uid: hand(s, 'p1', 'supodori')[0], targetUid: yuki })).toBe('healBlocked');
    const legal = getLegalActions(s, 'p1').filter((a): a is Extract<Action, { type: 'USE_ITEM' }> => a.type === 'USE_ITEM');
    expect(legal.some((a) => a.targetUid === yuki)).toBe(false);
    // バトル場の みつめ（ドリンクを使っていない）には くすりが使える
    const me = act(s, 'p1');
    s = patchCard(s, me, { hp: 40 });
    expect(validateAction(s, { type: 'USE_ITEM', player: 'p1', uid: hand(s, 'p1', 'kusuri')[0], targetUid: me })).toBeNull();
  });

  it('持続回復：回復の技を使っても、あとから くる回復は付かない', () => {
    let s = drinkGame();
    const yuki = s.players.p1.bench[0];
    s = ok(s, { type: 'SWAP', player: 'p1', benchUid: yuki }).state;
    s = use(s, 'kimyou_drink', yuki).state;
    // 交代したターンは攻撃しない。相手のターン → 自分のターンで ゆきだるま 目4（10回復＋あとから10）
    s = end(s).state;
    s = end(s, 1).state;
    const r = end(s, 4);
    expect(eventsOf(r.events, 'HealBlocked')).toEqual([{ type: 'HealBlocked', uid: yuki }]);
    expect(eventsOf(r.events, 'LastingAdded')).toEqual([]);
    expect(r.state.lasting.filter((l) => l.kind === 'heal')).toEqual([]);
  });
});

describe('③ のつづき（レビューで見つけた所）', () => {
  it('今すぐ0回復・あとから回復だけの目（すりむ 目4）でも「×」（HealBlocked）。緑の札は付かない', () => {
    let s = game([['surimu', 1], ['kimyou_drink', 14]], [['mutsuashi', 15]], { active: 'surimu', hand: ['kimyou_drink'] }, { active: 'mutsuashi' });
    const me = act(s, 'p1');
    s = use(s, 'kimyou_drink', me).state;
    s = end(s, 1).state;
    s = end(s, 1).state;
    const r = end(s, 4);
    expect(eventsOf(r.events, 'HealBlocked')).toEqual([{ type: 'HealBlocked', uid: me }]);
    expect(r.state.lasting.filter((l) => l.kind === 'heal')).toEqual([]);
  });

  it('2本目のドリンクでも HP は上がらない（HP5 → 5。下がる時は10になる）', () => {
    let s = game([['mitsume', 5], ['kimyou_drink', 10]], [['mutsuashi', 15]], { active: 'mitsume', hand: ['kimyou_drink', 'kimyou_drink'] }, { active: 'mutsuashi' });
    const me = act(s, 'p1');
    s = use(s, 'kimyou_drink', me).state;
    expect(s.cards[me].hp).toBe(10);
    s = end(s, 2).state;
    s = end(s, 1).state;
    s = patchCard(s, me, { hp: 5 });
    const d = use(s, 'kimyou_drink', me);
    expect(d.state.cards[me].hp).toBe(5);
    expect(eventsOf(d.events, 'HpSet')).toEqual([{ type: 'HpSet', uid: me, hpAfter: 5 }]);
  });

  it('HP が満タンでも、理由は「かいふく できない」（まんたん より先）', () => {
    let s = drinkGame();
    const yuki = s.players.p1.bench[0];
    s = use(s, 'kimyou_drink', yuki).state;
    s = patchCard(s, yuki, { hp: s.cards[yuki].maxHp });
    expect(validateAction(s, { type: 'USE_ITEM', player: 'p1', uid: hand(s, 'p1', 'kusuri')[0], targetUid: yuki })).toBe('healBlocked');
  });
});

describe('④ ドリンクを使った時に、付いている持続回復（緑の札）が消える', () => {
  it('ゆきだるま の あとから回復 が付いた後にドリンク：LastingCleared（noHeal）で消える。持続ダメージは残る', () => {
    let s = game([['yukidaruma', 6], ['kimyou_drink', 9]], [['hasami', 15]], { active: 'yukidaruma', hand: ['kimyou_drink'] }, { active: 'hasami' });
    const yuki = act(s, 'p1');
    s = patchCard(s, yuki, { hp: 80 });
    s = end(s, 4).state; // 10回復＋あとから10
    s = end(s, 1).state; // はさみ：20＋どく10（持続ダメージ）
    const heals = s.lasting.filter((l) => l.targetUid === yuki && l.kind === 'heal');
    const dmgs = s.lasting.filter((l) => l.targetUid === yuki && l.kind === 'damage');
    expect(heals).toHaveLength(1);
    expect(dmgs.length).toBeGreaterThan(0);
    const d = use(s, 'kimyou_drink', yuki);
    expect(eventsOf(d.events, 'LastingCleared')).toEqual([{ type: 'LastingCleared', uid: yuki, seqs: heals.map((l) => l.seq), reason: 'noHeal' }]);
    expect(d.state.lasting.filter((l) => l.targetUid === yuki && l.kind === 'heal')).toEqual([]);
    expect(d.state.lasting.filter((l) => l.targetUid === yuki && l.kind === 'damage')).toHaveLength(dmgs.length);
    // 消える演出は、ドリンクを使った直後（HP が 10 になる前）
    const types = d.events.map((e) => e.type);
    expect(types.indexOf('LastingCleared')).toBeGreaterThan(types.indexOf('ItemUsed'));
    expect(types.indexOf('LastingCleared')).toBeLessThan(types.indexOf('HpSet'));
  });
});

describe('⑤ ベンチに下がっても回復できないまま', () => {
  it('バトル場で使い、交代でベンチへ：くすり・スポドリは使えない。戻っても回復の技は効かない', () => {
    let s = drinkGame();
    const me = act(s, 'p1');
    const yuki = s.players.p1.bench[0];
    s = use(s, 'kimyou_drink', me).state;
    s = end(s, 2).state; // みつめ 目2：攻撃
    s = end(s, 1).state; // 相手
    s = ok(s, { type: 'SWAP', player: 'p1', benchUid: yuki }).state;
    expect(s.players.p1.bench).toContain(me);
    expect(validateAction(s, { type: 'USE_ITEM', player: 'p1', uid: hand(s, 'p1', 'kusuri')[0], targetUid: me })).toBe('healBlocked');
    expect(validateAction(s, { type: 'USE_ITEM', player: 'p1', uid: hand(s, 'p1', 'supodori')[0], targetUid: me })).toBe('healBlocked');
    // もう一度バトル場に戻って、目1（30回復）
    s = end(s).state; // 交代したので攻撃なし
    s = end(s, 1).state;
    s = ok(s, { type: 'SWAP', player: 'p1', benchUid: me }).state;
    s = end(s).state;
    s = end(s, 1).state;
    const r = end(s, 1);
    expect(eventsOf(r.events, 'HealBlocked')).toEqual([{ type: 'HealBlocked', uid: me }]);
    expect(eventsOf(r.events, 'Healed')).toEqual([]);
  });
});

describe('⑥ CPU は回復できないおてあげに くすり・スポドリを使わない', () => {
  it('どの強さでも、回復できないおてあげには回復のアイテムを選ばない', () => {
    let s = drinkGame();
    const me = act(s, 'p1');
    const yuki = s.players.p1.bench[0];
    // 両方にドリンク（バトル場は次のターンに）。どちらも HP が減っている
    s = use(s, 'kimyou_drink', yuki).state;
    s = end(s, 2).state;
    s = end(s, 1).state;
    s = structuredClone(s);
    s.players.p1.hand.push(...s.players.p1.deck.filter((u) => s.cardDefs[s.cards[u].no].id === 'kimyou_drink').slice(0, 1));
    s = use(s, 'kimyou_drink', me).state;
    s = end(s, 2).state;
    s = end(s, 1).state;
    expect(s.currentPlayer).toBe('p1');
    for (const level of ['weak', 'normal', 'strong', 'strongest'] as const) {
      for (let i = 0; i < 5; i++) {
        const a = decide(level, s, 'p1', seededRand(i + 1), { maxRollouts: 30 });
        const healItem = a?.type === 'USE_ITEM' && ['kusuri', 'supodori'].includes(s.cardDefs[s.cards[a.uid].no].id);
        expect(healItem, `${level} ${JSON.stringify(a)}`).toBe(false);
      }
    }
  });

  it('CPU の見積り：回復できないおてあげの回復の技は 0 と数える', async () => {
    const { outcomes } = await import('../src/cpu/estimate');
    let s = drinkGame();
    const me = act(s, 'p1');
    expect(outcomes(s, me)[0].heal).toBe(30);
    s = use(s, 'kimyou_drink', me).state;
    expect(outcomes(s, me)[0].heal).toBe(0);
  });
});

describe('全体', () => {
  it('プロトコル版数を上げた（18）', () => {
    expect(protocolVersion).toBe(18);
  });
});
