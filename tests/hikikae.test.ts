import { describe, expect, it } from 'vitest';
import { CPU_LEVELS, decide } from '../src/cpu/brains';
import { seededRand } from '../src/cpu/random';
import { applyAction, getLegalActions } from '../src/engine';
import type { GameState } from '../src/engine/types';
import { arrange, deckOf, ok, startMain, type Layout } from './helpers';

/**
 * H01〜H03 ひきかえカードでスーパーおてあげを選べない（v2.4）。
 * 山札から選ぶ時、スーパーおてあげは選べない。使える条件は「山札に選べるカードが無い時は使えない」。CPU も選ばない
 */
function game(p1: [string, number][], l1: Layout): GameState {
  let s = startMain({ decks: { p1: deckOf(p1), p2: deckOf([['mutsuashi', 15]]) } });
  s = arrange(s, 'p1', l1);
  s = arrange(s, 'p2', { active: 'mutsuashi' });
  return s;
}
const noOf = (s: GameState, uid: string) => s.cards[uid].no;
const isSuper = (s: GameState, uid: string) => {
  const d = s.cardDefs[noOf(s, uid)];
  return d.kind === 'otege' && d.rarity === 'super';
};

describe('H01 スーパーおてあげは選べない', () => {
  it('選べるカードの中にスーパーおてあげ（すりむ・かみ）が入らない。選ぼうとすると弾く', () => {
    const s = game([['oteage', 8], ['surimu', 1], ['kami', 1], ['hikikae', 5]], { active: 'oteage', hand: ['hikikae'] });
    const supers = s.players.p1.deck.filter((u) => isSuper(s, u));
    expect(supers).toHaveLength(2);
    const r = ok(s, { type: 'USE_ITEM', player: 'p1', uid: s.players.p1.hand[0] });
    expect(r.state.phase).toBe('choose');
    const opts = r.state.pendingChoice!.options;
    expect(opts.some((u) => isSuper(r.state, u))).toBe(false);
    expect([...opts].sort()).toEqual(s.players.p1.deck.filter((u) => !isSuper(s, u)).sort());
    for (const u of supers) expect(applyAction(r.state, { type: 'CHOOSE', player: 'p1', uids: [u] }).rejected).toBe('badChoice');
    expect(getLegalActions(r.state, 'p1').every((a) => a.type !== 'CHOOSE' || a.uids.every((u) => !isSuper(r.state, u)))).toBe(true);
  });

  it('山札が「スーパー1枚と選べるカード1枚」でも、自動では取らず選ばせる（灰色のカードを見せるため）', () => {
    let s = game([['oteage', 12], ['kami', 1], ['hikikae', 2]], { active: 'oteage', hand: ['hikikae'] });
    s = structuredClone(s);
    const keep = [s.players.p1.deck.find((u) => isSuper(s, u))!, s.players.p1.deck.find((u) => !isSuper(s, u) && s.cardDefs[noOf(s, u)].kind === 'otege')!];
    s.players.p1.discard.push(...s.players.p1.deck.filter((u) => !keep.includes(u)));
    s.players.p1.deck = keep;
    const r = ok(s, { type: 'USE_ITEM', player: 'p1', uid: s.players.p1.hand[0] });
    expect(r.state.pendingChoice?.options).toEqual([keep[1]]);
  });
});

describe('H02 山札がスーパーおてあげだけなら使えない', () => {
  it('「やまふだに えらべる カードが ない」で弾く。合法手にも出ない。山札0枚は今までどおり', () => {
    let s = game([['oteage', 12], ['kami', 1], ['hikikae', 2]], { active: 'oteage', hand: ['hikikae'] });
    s = structuredClone(s);
    const sup = s.players.p1.deck.find((u) => isSuper(s, u))!;
    s.players.p1.discard.push(...s.players.p1.deck.filter((u) => u !== sup));
    s.players.p1.deck = [sup];
    const item = s.players.p1.hand[0];
    expect(applyAction(s, { type: 'USE_ITEM', player: 'p1', uid: item }).rejected).toBe('noSearchable');
    expect(getLegalActions(s, 'p1').some((a) => a.type === 'USE_ITEM' && a.uid === item)).toBe(false);
    s.players.p1.deck = [];
    expect(applyAction(s, { type: 'USE_ITEM', player: 'p1', uid: item }).rejected).toBe('deckEmpty');
  });
});

describe('H03 CPU もスーパーおてあげを選ばない', () => {
  it('どの強さの CPU も、山札から選ぶ時にスーパーおてあげを選ばない（いろいろな乱数で）', () => {
    const s = game([['oteage', 4], ['otesage', 3], ['surimu', 1], ['kami', 1], ['revolution', 1], ['hikikae', 5]], { active: 'oteage', hand: ['hikikae'] });
    const r = ok(s, { type: 'USE_ITEM', player: 'p1', uid: s.players.p1.hand[0] });
    for (const level of CPU_LEVELS) {
      for (let seed = 1; seed <= 6; seed++) {
        const a = decide(level, r.state, 'p1', seededRand(seed), { maxRollouts: 30 });
        expect(a?.type).toBe('CHOOSE');
        if (a?.type === 'CHOOSE') expect(a.uids.some((u) => isSuper(r.state, u)), level).toBe(false);
        if (a) expect(applyAction(r.state, a).rejected).toBeUndefined();
      }
    }
  });

  it('山札がスーパーおてあげだけの時、CPU は ひきかえカード を使わない', () => {
    let s = game([['oteage', 12], ['kami', 1], ['hikikae', 2]], { active: 'oteage', hand: ['hikikae'] });
    s = structuredClone(s);
    const sup = s.players.p1.deck.find((u) => isSuper(s, u))!;
    s.players.p1.discard.push(...s.players.p1.deck.filter((u) => u !== sup));
    s.players.p1.deck = [sup];
    for (const level of CPU_LEVELS) {
      const a = decide(level, s, 'p1', seededRand(3), { maxRollouts: 30 });
      expect(a?.type === 'USE_ITEM' && a.uid === s.players.p1.hand[0], level).toBe(false);
    }
  });
});
