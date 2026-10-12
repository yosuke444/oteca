import { describe, expect, it } from 'vitest';
import { cardById } from '../src/data/cards';
import { moveDamage } from '../src/engine/effects';
import type { GameEvent, GameState, RuleSet, Side } from '../src/engine/types';
import { ENEMY, PLAYER, STORY, stageRules } from '../src/story/story';
import { arrange, deckOf, eventsOf, forceDice, ok, startMain, type Layout } from './helpers';

/**
 * v2.7 カードの数値の変更と、おてあげザムライのステージのボスルール（確認 ①〜⑥）
 * ボスルール：ボス側のおてあげが相手に与えるダメージ +10（RuleSet.attackBonus）。
 * 相手へのダメージが1以上の時だけ・持続ダメージは1回ごと・自分へのダメージ・回復・ばくだんには付けない。
 * 計算の順番：技のダメージ → きみょうなドリンク +50 → ひみつのやいば +20 → ボス +10
 */

type Rules = Partial<Record<Side, Partial<RuleSet>>>;
const zamurai = STORY.stages.find((s) => s.boss === 'zamurai')!;
const bossRules = stageRules(zamurai);

function game(p1: [string, number][], p2: [string, number][], l1: Layout, l2: Layout, rules?: Rules): GameState {
  let s = startMain({ decks: { p1: deckOf(p1), p2: deckOf(p2) }, rules });
  s = arrange(s, 'p1', l1);
  return arrange(s, 'p2', l2);
}
const end = (s: GameState, ...dice: number[]) => ok(forceDice(s, ...dice), { type: 'END_TURN', player: s.currentPlayer });
const act = (s: GameState, side: Side) => s.players[side].active!;
const hits = (s: GameState, events: GameEvent[], side: Side) =>
  eventsOf(events, 'Damaged')
    .filter((e) => s.cards[e.uid].owner === side)
    .map((e) => ({ amount: e.amount, bonus: e.bonus ?? 0 }));
/** 持続効果の発動（LastingFired）のすぐ後の Damaged だけ */
const lastingHits = (events: GameEvent[], seqs?: number[]) =>
  events.flatMap((e, i) => {
    const prev = events[i - 1];
    return e.type === 'Damaged' && prev?.type === 'LastingFired' && prev.lasting.kind === 'damage' && (!seqs || seqs.includes(prev.lasting.seq)) ? [{ amount: e.amount, bonus: e.bonus ?? 0 }] : [];
  });
const moves = (id: string) => {
  const d = cardById(id)!;
  if (d.kind !== 'otege') throw new Error(id);
  return d.moves.map((m) => [m.faces, m.effects]);
};

describe('① 5枚の新しい数値（v2.7）', () => {
  it('カードの数値が新しい値になっている', () => {
    expect(cardById('bunbunbun')).toMatchObject({ hp: 30 });
    expect(moves('bunbunbun')).toEqual([
      [[1], [{ type: 'damage', amount: 20 }]],
      [[2, 3, 4, 5, 6], [{ type: 'damage', amount: 50 }, { type: 'switchWithBench' }]],
    ]);
    expect(cardById('hosoage')).toMatchObject({ hp: 60 });
    expect(moves('hosoage')).toEqual([
      [[1, 2, 3, 4, 5], [{ type: 'damage', amount: 10 }, { type: 'heal', amount: 999 }]],
      [[6], [{ type: 'selfDamage', amount: 999 }]],
    ]);
    expect(cardById('hon777')).toMatchObject({ hp: 300 });
    expect(moves('hon777')).toEqual([
      [[1], [{ type: 'damage', amount: 20 }, { type: 'selfDamage', amount: 50 }]],
      [[2, 3, 4, 5], [{ type: 'damage', amount: 30 }, { type: 'selfDamage', amount: 20 }]],
      [[6], [{ type: 'damage', amount: 30 }, { type: 'selfDamage', amount: 10 }]],
    ]);
    expect(moves('moyasu')).toEqual([
      [[1, 2, 3], [{ type: 'damage', amount: 60 }, { type: 'discard', count: 1, deckIfNoHand: true }]],
      [[4, 5, 6], [{ type: 'damage', amount: 80 }, { type: 'discard', count: 1, deckIfNoHand: true }]],
    ]);
    expect(cardById('oteage_zamurai')).toMatchObject({ hp: 120 });
    expect(moves('oteage_zamurai')).toEqual([
      [[1, 2], [{ type: 'damage', amount: 30 }]],
      [[3, 4], [{ type: 'damage', amount: 50 }]],
      [[5, 6], [{ type: 'damage', amount: 70 }]],
    ]);
  });

  it('ぶんぶんぶん：1 は相手に20だけ／2-6 は相手に50とベンチと交代', () => {
    const s = game([['bunbunbun', 5], ['mutsuashi', 10]], [['mutsuashi', 15]], { active: 'bunbunbun', bench: ['mutsuashi'] }, { active: 'mutsuashi' });
    const me = act(s, 'p1');
    let r = end(s, 1);
    expect(hits(r.state, r.events, 'p2')).toEqual([{ amount: 20, bonus: 0 }]);
    expect(eventsOf(r.events, 'Swapped')).toEqual([]);
    for (const face of [2, 6]) {
      r = end(s, face);
      expect(hits(r.state, r.events, 'p2')).toEqual([{ amount: 50, bonus: 0 }]);
      expect(eventsOf(r.events, 'Swapped')).toMatchObject([{ player: 'p1', toBench: me, byEffect: true }]);
    }
  });

  it('ほそあげ：HP60。999回復で60まで戻る', () => {
    let s = game([['hosoage', 15]], [['mutsuashi', 15]], { active: 'hosoage' }, { active: 'mutsuashi' });
    expect(s.cards[act(s, 'p1')].maxHp).toBe(60);
    s = structuredClone(s);
    s.cards[act(s, 'p1')].hp = 5;
    const r = end(s, 1);
    expect(eventsOf(r.events, 'Healed')[0]).toMatchObject({ amount: 55, hpAfter: 60 });
  });

  it('777ほん：1 は相手に20・自分に50／2-5 は相手に30・自分に20／6 は相手に30・自分に10', () => {
    const s = game([['hon777', 15]], [['mutsuashi', 15]], { active: 'hon777' }, { active: 'mutsuashi' });
    for (const [face, opp, self] of [[1, 20, 50], [2, 30, 20], [5, 30, 20], [6, 30, 10]]) {
      const r = end(s, face);
      expect(hits(r.state, r.events, 'p2'), `目${face}`).toEqual([{ amount: opp, bonus: 0 }]);
      expect(hits(r.state, r.events, 'p1'), `目${face}`).toEqual([{ amount: self, bonus: 0 }]);
    }
  });

  it('もやす：4-6 は相手に80と手札を1枚捨てる（1-3 は60のまま）', () => {
    const s = game([['moyasu', 5], ['kusuri', 10]], [['mutsuashi', 15]], { active: 'moyasu', hand: ['kusuri'] }, { active: 'mutsuashi' });
    for (const [face, dmg] of [[1, 60], [4, 80], [6, 80]]) {
      const r = end(s, face);
      expect(hits(r.state, r.events, 'p2'), `目${face}`).toEqual([{ amount: dmg, bonus: 0 }]);
      expect(eventsOf(r.events, 'Discarded'), `目${face}`).toHaveLength(1);
      expect(r.state.players.p1.hand).toEqual([]);
    }
  });

  it('おてあげザムライ：30／50／70（ボスルールの無い対戦では +10 されない）', () => {
    const s = game([['oteage_zamurai', 1], ['oteage', 14]], [['mutsuashi', 15]], { active: 'oteage_zamurai' }, { active: 'mutsuashi' });
    for (const [face, dmg] of [[1, 30], [3, 50], [5, 70]]) {
      const r = end(s, face);
      expect(hits(r.state, r.events, 'p2'), `目${face}`).toEqual([{ amount: dmg, bonus: 0 }]);
    }
  });
});

/** ザムライのステージ：自分が p1（むつあし。目1は回復だけ）、ボスが p2 */
function bossGame(boss: string, opts: { hand?: string[]; rules?: Rules } = {}) {
  const s = game([['mutsuashi', 15]], [[boss, 5], ['oteage', 4], ['himitsu_yaiba', 3], ['kimyou_drink', 3]], { active: 'mutsuashi' }, { active: boss, hand: opts.hand }, opts.rules ?? bossRules);
  // 自分のターン（回復だけ）を終えて、ボスのターンにする
  return end(s, 1).state;
}

describe('② ザムライのステージでは、ボス側のダメージだけ +10', () => {
  it('ボスルールは RuleSet（ボス側 attackBonus 10）。プレイヤー側には無い', () => {
    expect(bossRules?.[ENEMY]).toEqual({ attackBonus: 10 });
    expect(bossRules?.[PLAYER]).toEqual({});
  });

  it('ボスの技：ザムライ 30 → 40・50 → 60・70 → 80（Damaged に bonus 10）', () => {
    for (const [face, dmg] of [[1, 40], [3, 60], [5, 80]]) {
      const s = bossGame('oteage_zamurai');
      const r = end(s, face);
      expect(hits(r.state, r.events, PLAYER), `目${face}`).toEqual([{ amount: dmg, bonus: 10 }]);
    }
  });

  it('プレイヤーの攻撃には付かない', () => {
    const s = game([['oteage', 15]], [['mutsuashi', 15]], { active: 'oteage' }, { active: 'mutsuashi' }, bossRules);
    const r = end(s, 1);
    expect(hits(r.state, r.events, ENEMY)).toEqual([{ amount: 30, bonus: 0 }]);
    expect(eventsOf(r.events, 'Damaged')[0]).not.toHaveProperty('bonus');
  });

  it('自分へのダメージ・回復には付かない（777ほん 目1：相手に 20 → 30、自分に50 のまま）', () => {
    const s = bossGame('hon777');
    const r = end(s, 1);
    expect(hits(r.state, r.events, PLAYER)).toEqual([{ amount: 30, bonus: 10 }]);
    expect(hits(r.state, r.events, ENEMY)).toEqual([{ amount: 50, bonus: 0 }]);
    // 回復（むつあし 目1：10）も +10 されない
    let m = bossGame('mutsuashi');
    m = structuredClone(m);
    m.cards[act(m, ENEMY)].hp = 100;
    const h = end(m, 1);
    expect(eventsOf(h.events, 'Healed')).toMatchObject([{ amount: 10, hpAfter: 110 }]);
    expect(hits(h.state, h.events, PLAYER)).toEqual([]);
  });

  it('ばくだんの気絶には付かない（HPぶんのダメージだけ）', () => {
    let s = bossGame('bakudan');
    // ボス 目6：相手に 20 → 30、3ターン後のばくだん
    let r = end(s, 6);
    expect(hits(r.state, r.events, PLAYER)).toEqual([{ amount: 30, bonus: 10 }]);
    s = r.state;
    const target = act(s, PLAYER);
    for (let i = 0; i < 6 && s.lasting.length > 0; i++) {
      r = end(s, 1);
      s = r.state;
    }
    expect(s.lasting).toEqual([]);
    const boom = eventsOf(r.events, 'Damaged').find((e) => e.uid === target);
    expect(boom, 'ばくだんが発動しない').toBeDefined();
    expect(eventsOf(r.events, 'Fainted')).toMatchObject([{ uid: target, by: ENEMY }]);
    expect(boom?.bonus).toBeUndefined();
  });
});

describe('③「相手に0」は0のまま', () => {
  it('ばくだん 目1（相手に0）：ボスでもダメージは出ない', () => {
    const r = end(bossGame('bakudan'), 1);
    expect(eventsOf(r.events, 'Damaged')).toEqual([]);
  });

  it('計算でも0のまま（やいば・ドリンクがあっても）', () => {
    const s = bossGame('oteage_zamurai');
    const boss = s.cards[act(s, ENEMY)];
    expect(moveDamage(s, boss, 0)).toBe(0);
    expect(moveDamage(s, { ...boss, attackAdd: 70 }, 0)).toBe(0);
  });
});

describe('④ 持続ダメージにも、1回発動するごとに +10', () => {
  it('どくさげ 目1（相手に10、あとから10・10・10）：今すぐ 20、あとから毎回 20', () => {
    let s = structuredClone(bossGame('dokusage'));
    // 何回も受けても倒れないように、自分のHPを多くしておく
    Object.assign(s.cards[act(s, PLAYER)], { hp: 999, maxHp: 999 });
    let r = end(s, 1);
    expect(hits(r.state, r.events, PLAYER)).toEqual([{ amount: 20, bonus: 10 }]);
    s = r.state;
    const later: { amount: number; bonus: number }[] = [];
    // 付いている札の数は元の値（10）のまま
    expect(s.lasting.filter((l) => l.kind === 'damage').map((l) => l.amount)).toEqual([10, 10, 10]);
    // ボスのターンも攻撃が続くので、最初に付いた3つ（seq）だけ数える
    const first = s.lasting.map((l) => l.seq);
    for (let i = 0; i < 3; i++) {
      r = end(s, 1); // 自分のターンの終わり：持続ダメージ
      later.push(...lastingHits(r.events, first));
      // あとから付いた分（目5：あとから20）は 20 + 10 = 30
      for (const x of lastingHits(r.events)) expect([20, 30]).toContain(x.amount);
      s = r.state;
      r = end(s, 5); // ボスのターン（目5：20 → 30。新しい持続ダメージは次に回る）
      s = r.state;
    }
    expect(later).toEqual([{ amount: 20, bonus: 10 }, { amount: 20, bonus: 10 }, { amount: 20, bonus: 10 }]);
  });

  it('おおとろ 目1（相手に0、2回あとに60）：今すぐは0、あとから 70', () => {
    let s = bossGame('ootoro');
    let r = end(s, 1);
    expect(eventsOf(r.events, 'Damaged')).toEqual([]);
    s = r.state;
    expect(s.lasting.map((l) => l.amount)).toEqual([60]);
    const later: { amount: number; bonus: number }[] = [];
    for (let i = 0; i < 4; i++) {
      r = end(s, i % 2 === 0 ? 1 : 4); // ボスは 目4（ドロー）で、新しい持続ダメージを付けない
      later.push(...hits(r.state, r.events, PLAYER));
      s = r.state;
    }
    expect(later).toEqual([{ amount: 70, bonus: 10 }]);
  });

  it('プレイヤーが付けた持続ダメージには付かない', () => {
    let s = game([['dokusage', 15]], [['mutsuashi', 15]], { active: 'dokusage' }, { active: 'mutsuashi' }, bossRules);
    let r = end(s, 1);
    expect(hits(r.state, r.events, ENEMY)).toEqual([{ amount: 10, bonus: 0 }]);
    s = r.state;
    r = end(s, 1); // ボスのターン（むつあし 目1：回復）の終わりに、ボスに付いた持続ダメージが来る
    expect(hits(r.state, r.events, ENEMY)).toEqual([{ amount: 10, bonus: 0 }]);
  });
});

describe('⑤ ドリンク・やいばと重なった時の計算順：技 → ドリンク +50 → やいば +20 → ボス +10', () => {
  const useItem = (s: GameState, id: string) => {
    const uid = s.players[ENEMY].hand.find((u) => s.cardDefs[s.cards[u].no].id === id)!;
    return ok(s, { type: 'USE_ITEM', player: ENEMY, uid, targetUid: act(s, ENEMY) }).state;
  };

  it('ひみつのやいば：30 + 20 + 10 = 60（2枚なら 30 + 40 + 10 = 80）', () => {
    let s = useItem(bossGame('oteage_zamurai', { hand: ['himitsu_yaiba', 'himitsu_yaiba'] }), 'himitsu_yaiba');
    let r = end(s, 1);
    expect(hits(r.state, r.events, PLAYER)).toEqual([{ amount: 60, bonus: 10 }]);
    s = useItem(s, 'himitsu_yaiba');
    r = end(s, 1);
    expect(hits(r.state, r.events, PLAYER)).toEqual([{ amount: 80, bonus: 10 }]);
  });

  it('きみょうなドリンク：30 + 50 + 10 = 90（70 の目なら 70 + 50 + 10 = 130）', () => {
    const s = useItem(bossGame('oteage_zamurai', { hand: ['kimyou_drink'] }), 'kimyou_drink');
    let r = end(s, 1);
    expect(hits(r.state, r.events, PLAYER)).toEqual([{ amount: 90, bonus: 10 }]);
    r = end(s, 5);
    expect(hits(r.state, r.events, PLAYER)).toEqual([{ amount: 130, bonus: 10 }]);
  });

  it('画面の「このターン出る数値」も同じ計算（moveDamage）', () => {
    const s = bossGame('oteage_zamurai');
    const boss = s.cards[act(s, ENEMY)];
    expect(moveDamage(s, boss, 30)).toBe(40);
    expect(moveDamage(s, { ...boss, attackAdd: 20 }, 30)).toBe(60);
    expect(moveDamage(s, { ...boss, attackAdd: 50 }, 30)).toBe(90);
  });
});

describe('⑥ ほかのステージ・ふつうの対戦では +10 されない', () => {
  it('ザムライ以外のステージのボスルールには attackBonus が無い', () => {
    for (const st of STORY.stages) {
      if (st === zamurai) continue;
      const r = stageRules(st);
      expect(r?.[ENEMY]?.attackBonus ?? 0, `ステージ${st.no}`).toBe(0);
      expect(r?.[PLAYER]?.attackBonus ?? 0, `ステージ${st.no}`).toBe(0);
    }
  });

  it('ほかのステージのルールで、ボスが攻撃しても持続ダメージでも そのまま', () => {
    for (const st of STORY.stages) {
      if (st === zamurai) continue;
      let s = bossGame('dokusage', { rules: stageRules(st) ?? {} });
      let r = end(s, 1);
      expect(hits(r.state, r.events, PLAYER), `ステージ${st.no}`).toEqual([{ amount: 10, bonus: 0 }]);
      s = r.state;
      r = end(s, 1);
      expect(hits(r.state, r.events, PLAYER), `ステージ${st.no}`).toEqual([{ amount: 10, bonus: 0 }]);
    }
  });
});

describe('CPU も新しい数値で考える', () => {
  it('技の見積り（outcomes）：ボスのザムライは 40／60／80、持続ダメージは1回ごとに +10', async () => {
    const { outcomes } = await import('../src/cpu/estimate');
    const z = bossGame('oteage_zamurai');
    expect(outcomes(z, act(z, ENEMY)).map((o) => o.damage)).toEqual([40, 40, 60, 60, 80, 80]);
    const d = bossGame('dokusage');
    expect(outcomes(d, act(d, ENEMY)).map((o) => [o.damage, o.later])).toEqual([[20, 60], [20, 60], [20, 60], [20, 60], [30, 90], [30, 90]]);
    // ルールの無い対戦では元の数値（777ほん：相手に20・自分に50 など）
    const h = game([['hon777', 15]], [['mutsuashi', 15]], { active: 'hon777' }, { active: 'mutsuashi' });
    expect(outcomes(h, act(h, 'p1')).map((o) => [o.damage, o.self])).toEqual([[20, 50], [30, 20], [30, 20], [30, 20], [30, 20], [30, 10]]);
  });

  it('付いている持続ダメージの見積り（threat）にも +10', async () => {
    const { threat } = await import('../src/cpu/estimate');
    let s = structuredClone(end(bossGame('dokusage'), 1).state);
    const me = act(s, PLAYER);
    // HP30：持続ダメージ 10 + 10 = 20 のあと、ボスの次の攻撃（どの目でも 20 以上）で倒れる＝1。+10 が無ければ 10 のあと 20 が要る（目5・6だけ）
    s.cards[me].hp = 30;
    s.lasting = s.lasting.slice(0, 1).map((l) => ({ ...l, turns: 1 }));
    expect(s.lasting.map((l) => [l.kind, l.amount, l.owner])).toEqual([['damage', 10, ENEMY]]);
    expect(threat(s, PLAYER, me)).toBe(1);
    s = structuredClone(s);
    s.rules[ENEMY].attackBonus = 0;
    expect(threat(s, PLAYER, me)).toBeCloseTo(2 / 6);
  });
});
