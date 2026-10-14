import { describe, expect, it } from 'vitest';
import { cardById } from '../src/data/cards';
import { applyAction, getLegalActions, validateAction } from '../src/engine';
import type { GameState, Side } from '../src/engine/types';
import { arrange, deckOf, eventsOf, forceDice, ok, patchCard, startMain, type Layout } from './helpers';

/**
 * v2.7（4つの直し）：777ほん の数値（④）と、スポドリは同じおてあげに1回の対戦で1回だけ（⑤〜⑧）
 */

function game(p1: [string, number][], p2: [string, number][], l1: Layout, l2: Layout): GameState {
  let s = startMain({ decks: { p1: deckOf(p1), p2: deckOf(p2) } });
  s = arrange(s, 'p1', l1);
  return arrange(s, 'p2', l2);
}
const end = (s: GameState, ...dice: number[]) => ok(forceDice(s, ...dice), { type: 'END_TURN', player: s.currentPlayer });
const act = (s: GameState, side: Side) => s.players[side].active!;
const hand = (s: GameState, side: Side, id: string) => s.players[side].hand.filter((u) => s.cardDefs[s.cards[u].no].id === id);
const SUPODORI = cardById('supodori')!.no;

describe('④ 777ほん の新しい数値どおりにダメージが入る（HP250）', () => {
  it('1：相手に10・自分に60／2-5：相手に20・自分に30／6：相手に20・自分に20', () => {
    const s = game([['hon777', 15]], [['mutsuashi', 15]], { active: 'hon777' }, { active: 'mutsuashi' });
    expect(s.cards[act(s, 'p1')].maxHp).toBe(250);
    for (const [face, opp, self] of [[1, 10, 60], [2, 20, 30], [4, 20, 30], [5, 20, 30], [6, 20, 20]]) {
      const r = end(s, face);
      const dmg = eventsOf(r.events, 'Damaged');
      expect(dmg.map((d) => [r.state.cards[d.uid].owner, d.amount]), `目${face}`).toEqual([['p2', opp], ['p1', self]]);
      expect(r.state.cards[act(s, 'p1')].hp, `目${face}`).toBe(250 - self);
    }
  });
});

/** ベンチに むつあし を2体（HPを減らしておく）、手札にスポドリ2枚 */
function drinkGame(): GameState {
  let s = game([['oteage', 5], ['mutsuashi', 6], ['supodori', 4]], [['mutsuashi', 15]], { active: 'oteage', bench: ['mutsuashi', 'mutsuashi'], hand: ['supodori', 'supodori'] }, { active: 'mutsuashi' });
  for (const u of s.players.p1.bench) s = patchCard(s, u, { hp: 20 });
  return s;
}

describe('⑤ スポドリを同じおてあげに2回使えない', () => {
  it('1回目は使える。2回目は「usedOnce」で弾かれる（HPが満タンでなくても）。ほかのおてあげには使える', () => {
    let s = drinkGame();
    const [b1, b2] = s.players.p1.bench;
    const [d1, d2] = hand(s, 'p1', 'supodori');
    s = ok(s, { type: 'USE_ITEM', player: 'p1', uid: d1, targetUid: b1 }).state;
    expect(s.cards[b1].hp).toBe(90);
    expect(s.cards[b1].itemsUsed).toEqual([SUPODORI]);
    expect(validateAction(s, { type: 'USE_ITEM', player: 'p1', uid: d2, targetUid: b1 })).toBe('usedOnce');
    expect(applyAction(s, { type: 'USE_ITEM', player: 'p1', uid: d2, targetUid: b1 }).rejected).toBe('usedOnce');
    // 次のターンになっても使えない（このターンだけの決まりではない）
    s = end(s, 1).state;
    s = end(s, 1).state;
    expect(validateAction(s, { type: 'USE_ITEM', player: 'p1', uid: d2, targetUid: b1 })).toBe('usedOnce');
    expect(validateAction(s, { type: 'USE_ITEM', player: 'p1', uid: d2, targetUid: b2 })).toBeNull();
  });
});

describe('⑥ 交代してもスポドリずみが残る', () => {
  it('ベンチ → バトル場 → ベンチ と行き来しても、使った記録は消えない', () => {
    let s = drinkGame();
    const [b1] = s.players.p1.bench;
    const [d1, d2] = hand(s, 'p1', 'supodori');
    s = ok(s, { type: 'USE_ITEM', player: 'p1', uid: d1, targetUid: b1 }).state;
    // 交代：b1 がバトル場へ（スポドリはベンチにしか使えないので、戻ってから確かめる）
    s = ok(s, { type: 'SWAP', player: 'p1', benchUid: b1 }).state;
    expect(s.players.p1.active).toBe(b1);
    expect(s.cards[b1].itemsUsed).toEqual([SUPODORI]);
    s = end(s, 1).state;
    s = end(s, 1).state;
    const back = s.players.p1.bench[0];
    s = ok(s, { type: 'SWAP', player: 'p1', benchUid: back }).state;
    expect(s.players.p1.bench).toContain(b1);
    s = patchCard(s, b1, { hp: 10 });
    expect(s.cards[b1].itemsUsed).toEqual([SUPODORI]);
    expect(validateAction(s, { type: 'USE_ITEM', player: 'p1', uid: d2, targetUid: b1 })).toBe('usedOnce');
  });
});

describe('⑦ 使える相手がいなければスポドリを使えない', () => {
  it('ベンチの2体とも使った後は、手札のスポドリに出来る操作が無い', () => {
    let s = drinkGame();
    const [b1, b2] = s.players.p1.bench;
    const drinks = hand(s, 'p1', 'supodori');
    s = ok(s, { type: 'USE_ITEM', player: 'p1', uid: drinks[0], targetUid: b1 }).state;
    s = ok(s, { type: 'USE_ITEM', player: 'p1', uid: drinks[1], targetUid: b2 }).state;
    // 3枚目のスポドリを手札に入れ、HPも減らす
    const third = s.players.p1.deck.find((u) => s.cards[u].no === SUPODORI)!;
    s = structuredClone(s);
    s.players.p1.deck = s.players.p1.deck.filter((u) => u !== third);
    s.players.p1.hand.push(third);
    for (const u of [b1, b2]) s.cards[u].hp = 10;
    expect(getLegalActions(s, 'p1').filter((a) => a.type === 'USE_ITEM' && a.uid === third)).toEqual([]);
  });
});

describe('⑧ CPU が2回目を使わない', () => {
  it('どの強さの CPU も、スポドリずみのおてあげにスポドリを使わない', async () => {
    const { decide } = await import('../src/cpu/brains');
    for (const level of ['weak', 'normal', 'strong', 'strongest'] as const) {
      let s = drinkGame();
      const [b1, b2] = s.players.p1.bench;
      const [d1] = hand(s, 'p1', 'supodori');
      s = ok(s, { type: 'USE_ITEM', player: 'p1', uid: d1, targetUid: b1 }).state;
      // b2 は満タンにして、使える相手がいない（b1 はスポドリずみ）
      s = patchCard(patchCard(s, b2, { hp: s.cards[b2].maxHp }), b1, { hp: 10 });
      for (let i = 0; i < 20; i++) {
        const a = decide(level, s, 'p1', () => (i * 0.37) % 1);
        if (!a || a.type !== 'USE_ITEM') break;
        expect(a.targetUid, level).not.toBe(b1);
        s = ok(s, a).state;
      }
      expect(s.cards[b1].itemsUsed.filter((n) => n === SUPODORI), level).toHaveLength(1);
    }
  });
});
