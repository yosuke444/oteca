import { describe, expect, it } from 'vitest';
import { CpuController, decideCpuAction } from '../src/controllers/cpu';
import { Match } from '../src/controllers/match';
import { CARD_DB } from '../src/data/cards';
import { starterDeckNos } from '../src/data/starterDeck';
import { applyAction, validateDeck } from '../src/engine';
import { autoFill } from '../src/scenes/DeckEdit/deckOps';
import { DEFAULT_RULES } from '../src/engine';
import { arrange, eventsOf, patchCard, startMain } from './helpers';
import { makeRandom } from './save.helpers';

/** CPU 同士で1試合。すぐに操作する scheduler を使い、演出の代わりに毎回 notifyIdle を呼ぶ */
function cpuVsCpu(seed: string, decks = { p1: starterDeckNos(), p2: starterDeckNos() }) {
  const pending: (() => void)[] = [];
  const sched = (fn: () => void) => {
    pending.push(fn);
    return null;
  };
  const match = new Match({ seed, decks, cardDb: CARD_DB }, { p1: new CpuController('p1', sched), p2: new CpuController('p2', sched) });
  let steps = 0;
  match.notifyIdle();
  while (pending.length > 0 && steps < 5000) {
    pending.shift()!();
    steps += 1;
    match.notifyIdle();
  }
  return { match, steps };
}

describe('かんたんCPU', () => {
  it('CPU 同士の自動対戦：10試合すべて決着する（不正な操作をしない）', () => {
    for (let i = 0; i < 10; i++) {
      const r = makeRandom(1000 + i);
      const deck = (seed: number) => autoFill([], CARD_DB, DEFAULT_RULES, () => Infinity, makeRandom(seed).next);
      const decks = i < 5 ? { p1: starterDeckNos(), p2: starterDeckNos() } : { p1: deck(i * 7 + 1), p2: deck(i * 7 + 2) };
      expect(validateDeck(decks.p1, CARD_DB)).toEqual([]);
      const { match } = cpuVsCpu(`cpu-${i}-${r.int(0, 9999)}`, decks);
      expect(match.state.phase, `試合 ${i}`).toBe('over');
      expect(match.state.winner).not.toBeNull();
      expect(match.rejected).toEqual([]);
    }
  });

  it('ベンチが空いていれば出す（HPが大きいおてあげから）', () => {
    let s = startMain();
    s = arrange(s, 'p1', { active: 'oteage', hand: ['otesage', 'mutsuashi', 'kusuri'] });
    const a = decideCpuAction(s, 'p1');
    expect(a?.type).toBe('PLACE_BENCH');
    expect(a && 'uid' in a && s.cardDefs[s.cards[a.uid].no].id).toBe('mutsuashi');
  });

  it('HPが半分以下で回復アイテムがあれば使う。半分より多ければ使わずに攻撃', () => {
    let s = startMain();
    s = arrange(s, 'p1', { active: 'mitsume', hand: ['kusuri'] });
    const active = s.players.p1.active!;
    const low = patchCard(s, active, { hp: 60 });
    expect(decideCpuAction(low, 'p1')).toEqual({ type: 'USE_ITEM', player: 'p1', uid: s.players.p1.hand[0], targetUid: active });
    const high = patchCard(s, active, { hp: 61 });
    expect(decideCpuAction(high, 'p1')).toEqual({ type: 'END_TURN', player: 'p1' });
  });

  it('交代・やいば・ドリンクは使わない', () => {
    let s = startMain();
    s = arrange(s, 'p1', { active: 'oteage', bench: ['mitsume', 'otesage'], hand: ['himitsu_yaiba', 'kimyou_drink'] });
    expect(decideCpuAction(s, 'p1')).toEqual({ type: 'END_TURN', player: 'p1' });
  });

  it('手番でない時・決着後は何もしない。くりだしは今のHPが大きいおてあげ', () => {
    let s = startMain();
    expect(decideCpuAction(s, 'p2')).toBeNull();
    s = arrange(s, 'p1', { active: 'oteage' });
    s = arrange(s, 'p2', { active: 'otesage', bench: ['mitsume', 'sanbon'] });
    s = patchCard(s, s.players.p2.active!, { hp: 10 });
    s = patchCard(s, s.players.p2.bench[0], { hp: 20 });
    const next = structuredClone(s);
    next.forcedDice.push(1);
    const r = applyAction(next, { type: 'END_TURN', player: 'p1' });
    expect(eventsOf(r.events, 'NeedPromote')).toHaveLength(1);
    const promote = decideCpuAction(r.state, 'p2');
    expect(promote).toEqual({ type: 'PROMOTE', player: 'p2', benchUid: s.players.p2.bench[1] });
  });
});
