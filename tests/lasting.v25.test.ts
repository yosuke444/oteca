import { describe, expect, it } from 'vitest';
import { CARD_DB } from '../src/data/cards';
import type { CardDb, GameEvent, GameState, OtegeCardDef, Side } from '../src/engine/types';
import { lastingInEffect } from '../src/fx/lastingContext';
import { applyEventToView } from '../src/fx/viewReducer';
import { benchBombs, drawTags, lastingRows, rowFit, TAG_MIN } from '../src/ui/card/lastingLayout';
import { arrange, deckOf, eventsOf, forceDice, ok, patchCard, startMain, type Layout } from './helpers';

/**
 * v2.5 持続効果の新しい決まりと見た目（確認 ①〜⑪）
 * - 持ち主のターンの終わり1回を「1ターン」と数える。同じターンに来るものは、新しく受けたものから1つずつ発動
 * - 気絶したら残りは消える。ベンチに戻ると持続ダメージ・持続回復は消え、ばくだんは残る
 * - 遅延ドローはプレイヤーに付き、持続ダメージ・回復の後に引く
 * - 見た目：カードの横の表（行＝何ターン後、3ターン先まで、古いものが左）・山札の青い札
 */

function game(p1: [string, number][], p2: [string, number][], l1: Layout, l2: Layout): GameState {
  let s = startMain({ decks: { p1: deckOf(p1), p2: deckOf(p2) } });
  s = arrange(s, 'p1', l1);
  return arrange(s, 'p2', l2);
}

/** 手番の人が、サイコロの目を決めてターンを終える */
function end(s: GameState, ...dice: number[]): { state: GameState; events: GameEvent[] } {
  return ok(forceDice(s, ...dice), { type: 'END_TURN', player: s.currentPlayer });
}

/** 操作のイベントを、表示用の状態に1つずつ当てる（画面と同じ動き） */
function viewAfter(before: GameState, events: GameEvent[]): GameState {
  let v = before;
  for (const e of events) v = applyEventToView(v, e);
  return v;
}

const act = (s: GameState, side: Side) => s.players[side].active!;
const seqs = (rows: { seq: number }[][]) => rows.map((r) => r.map((l) => l.seq));

function withCards(...defs: OtegeCardDef[]): CardDb {
  const db: CardDb = { ...CARD_DB };
  for (const d of defs) db[d.no] = d;
  return db;
}
const testCard = (no: number, effects: OtegeCardDef['moves'][number]['effects']): OtegeCardDef => ({
  no,
  id: `test_${no}`,
  name: 'テスト',
  kind: 'otege',
  rarity: 'normal',
  hp: 200,
  image: '',
  flavor: '',
  moves: [{ faces: [1, 2, 3, 4, 5, 6], effects }],
});

/**
 * どくさげ（10 + 10+10+10）で かみ を2回たたいた状態：
 * 1行目 [seq2, seq4]、2行目 [seq3, seq5]、3行目 [seq6]（p2 のターンの終わりで数える）
 */
function twoPoisons() {
  let s = game([['dokusage', 15]], [['kami', 15]], { active: 'dokusage' }, { active: 'kami' });
  const kami = act(s, 'p2');
  let r = end(s, 1); // p1：どく 10+10+10（seq1〜3）
  const before = r.state;
  r = end(r.state, 1); // p2：かみ 1 は回復。ターンの終わりに seq1 が発動、残りが1つ上がる
  let view = viewAfter(before, r.events);
  r = end(r.state, 1); // p1：もう一度 どく（seq4〜6）
  view = viewAfter(view, r.events);
  s = r.state;
  return { s, view, kami };
}

describe('① 同じターンに発動するものは横に並び、古いものが左', () => {
  it('1行目に [古い, 新しい]、2行目・3行目も古い順。エンジンの状態と表示用の状態のどちらでも同じ', () => {
    const { s, view, kami } = twoPoisons();
    expect(seqs(lastingRows(s, kami))).toEqual([[2, 4], [3, 5], [6]]);
    expect(seqs(lastingRows(view, kami))).toEqual([[2, 4], [3, 5], [6]]);
    // 受けた順番は1つずつ増える
    expect(s.lasting.map((l) => [l.seq, l.turns])).toEqual([[2, 1], [3, 2], [4, 1], [5, 2], [6, 3]]);
  });
});

describe('② 右から（新しいものから）1つずつ発動する', () => {
  it('1行目の seq4 → seq2 の順。発動ごとにダメージが続く（まとめない）', () => {
    const { s } = twoPoisons();
    const r = end(s, 1);
    const order = r.events.filter((e) => e.type === 'LastingFired' || e.type === 'Damaged').map((e) => (e.type === 'LastingFired' ? `F${e.lasting.seq}` : `D${e.amount}`));
    expect(order).toEqual(['F4', 'D10', 'F2', 'D10']);
  });
});

describe('③ ターンが進むと、行が1つ上がる', () => {
  it('発動のあとに LastingTicked。2行目 → 1行目、3行目 → 2行目', () => {
    const { s, view, kami } = twoPoisons();
    const r = end(s, 1);
    const tick = eventsOf(r.events, 'LastingTicked');
    expect(tick).toEqual([{ type: 'LastingTicked', player: 'p2', seqs: [3, 5, 6] }]);
    // 1行目の発動 → 行が上がる の順
    const types = r.events.map((e) => e.type);
    expect(types.lastIndexOf('LastingFired')).toBeLessThan(types.indexOf('LastingTicked'));
    expect(seqs(lastingRows(r.state, kami))).toEqual([[3, 5], [6], []]);
    expect(seqs(lastingRows(viewAfter(view, r.events), kami))).toEqual([[3, 5], [6], []]);
  });

  it('相手のターンの終わりには進まない（持ち主のターンの終わりだけを数える）', () => {
    const { s } = twoPoisons();
    const r = end(s, 1); // p2 の終わり
    const r2 = end(r.state, 1); // p1 の終わり：p2 に付いた分は進まない
    expect(eventsOf(r2.events, 'LastingTicked').filter((e) => e.player === 'p2')).toEqual([]);
    expect(r2.state.lasting.filter((l) => l.holder === 'p2' && l.seq <= 6).map((l) => l.turns)).toEqual([1, 1, 2]);
  });
});

describe('④ 3ターンより先のものは、3行以内に入ってきた時に出る', () => {
  it('4ターン後のダメージは表に出ず、1ターン進むと3行目に出る', () => {
    const FAR = testCard(911, [{ type: 'damage', amount: 0, then: [0, 0, 0, 20] }]);
    let s = startMain({ cardDb: withCards(FAR), decks: { p1: Array(15).fill(911), p2: deckOf([['kami', 15]]) } });
    const kami = act(s, 'p2');
    let r = end(s, 1);
    expect(r.state.lasting.map((l) => l.turns)).toEqual([4]);
    expect(lastingRows(r.state, kami).flat()).toEqual([]);
    const before = r.state;
    r = end(r.state, 1); // p2 の終わり：4 → 3
    const view = viewAfter(before, r.events);
    expect(seqs(lastingRows(view, kami))).toEqual([[], [], [1]]);
  });
});

describe('⑤ 途中で気絶したら、残りはすべて消える', () => {
  it('1行目の新しいほうで気絶 → 古いほうは発動しない。2行目・3行目・ばくだんも消える', () => {
    const { s, kami } = twoPoisons();
    const r2 = end(patchCard(s, kami, { hp: 10 }), 3); // かみ 3 は相手に40（回復しない）。新しい seq4 の10で気絶
    expect(eventsOf(r2.events, 'LastingFired').map((e) => e.lasting.seq)).toEqual([4]);
    expect(eventsOf(r2.events, 'Fainted').map((e) => e.uid)).toEqual([kami]);
    expect(r2.state.lasting.filter((l) => l.targetUid === kami)).toEqual([]);
    expect(eventsOf(r2.events, 'LastingTicked')).toEqual([]);
  });
});

describe('⑥ ベンチに戻ると赤と緑は消え、ばくだんは残ってベンチで気絶する', () => {
  it('交代で LastingCleared（ダメージ・回復）。ばくだんは回数が来るとベンチでその場で気絶', () => {
    const MIX = testCard(912, [{ type: 'damage', amount: 0, then: [10] }, { type: 'faintLater', after: 2 }]);
    let s = startMain({ cardDb: withCards(MIX), decks: { p1: Array(15).fill(912), p2: deckOf([['yukidaruma', 10], ['mutsuashi', 5]]) } });
    s = arrange(s, 'p2', { active: 'yukidaruma', bench: ['mutsuashi'] });
    const yuki = act(s, 'p2');
    let r = end(s, 1); // p1：どく10（seq1）・ばくだん2ターン後（seq2）
    r = end(r.state, 4); // p2：ゆきだるま 4 は回復10 + あとから回復10（seq3）。終わりに seq1 が発動、seq2 → 1
    r = end(r.state, 1); // p1：どく10（seq4）・ばくだん（seq5）
    const red = r.state.lasting.filter((l) => l.targetUid === yuki && l.kind !== 'faint').map((l) => l.seq);
    expect(red).toEqual([3, 4]);
    // p2 は ゆきだるま をベンチへ
    const sw = ok(r.state, { type: 'SWAP', player: 'p2', benchUid: r.state.players.p2.bench[0] });
    expect(eventsOf(sw.events, 'LastingCleared')).toEqual([{ type: 'LastingCleared', uid: yuki, seqs: [3, 4] }]);
    expect(sw.state.lasting.filter((l) => l.targetUid === yuki).map((l) => [l.kind, l.turns])).toEqual([
      ['faint', 1],
      ['faint', 2],
    ]);
    // ベンチでは、ばくだんの札だけ（表には出ない）
    expect(benchBombs(sw.state, yuki).map((l) => l.seq)).toEqual([2, 5]);
    expect(lastingRows(sw.state, act(sw.state, 'p2')).flat()).toEqual([]);
    // 消える演出は交代より先（バトル場にいるうちに泡になる）
    expect(sw.events.map((e) => e.type).slice(0, 2)).toEqual(['LastingCleared', 'Swapped']);
    const r2 = end(sw.state);
    expect(eventsOf(r2.events, 'LastingFired').map((e) => e.lasting.kind)).toEqual(['faint']);
    expect(eventsOf(r2.events, 'Fainted').map((e) => e.uid)).toEqual([yuki]);
    expect(r2.state.players.p2.bench).not.toContain(yuki);
  });

  it('技の効果での交代（ぶんぶんぶん）でも消える', () => {
    let s = game([['hasami', 15]], [['bunbunbun', 15]], { active: 'hasami' }, { active: 'bunbunbun', bench: ['bunbunbun'] });
    const hit = act(s, 'p2');
    // ぶんぶんぶん は HP10（v2.7）なので、はさみ の攻撃に耐えられるように HP を足しておく
    s = patchCard(s, hit, { hp: 100, maxHp: 100 });
    let r = end(s, 1); // はさみ：20 + どく10
    expect(r.state.lasting).toHaveLength(1);
    r = end(r.state, 3); // ぶんぶんぶん 3：相手に40 → ベンチと交代
    expect(eventsOf(r.events, 'LastingCleared')).toEqual([{ type: 'LastingCleared', uid: hit, seqs: [1] }]);
    expect(eventsOf(r.events, 'LastingFired')).toEqual([]);
    expect(r.state.lasting).toEqual([]);
  });
});

describe('⑦ 遅延ドローは、気絶しても交代しても消えない', () => {
  it('たからばこ：自分に999で気絶。そのあと交代しても、ドローは残る', () => {
    let s = game([['takarabako', 3], ['mutsuashi', 12]], [['mutsuashi', 15]], { active: 'takarabako', bench: ['mutsuashi', 'mutsuashi'] }, { active: 'mutsuashi' });
    let r = end(s, 1);
    expect(eventsOf(r.events, 'Fainted')).toHaveLength(1);
    r = ok(r.state, { type: 'PROMOTE', player: 'p1', benchUid: r.state.players.p1.bench[0] });
    expect(r.state.lasting.map((l) => [l.kind, l.holder, l.turns])).toEqual([['draw', 'p1', 9]]);
    r = end(r.state, 1); // p2
    r = ok(r.state, { type: 'SWAP', player: 'p1', benchUid: r.state.players.p1.bench[0] });
    expect(eventsOf(r.events, 'LastingCleared')).toEqual([]);
    expect(r.state.lasting.map((l) => l.kind)).toEqual(['draw']);
  });
});

describe('⑧ 持続効果では、攻撃の動きが出ない', () => {
  it('持続効果のダメージは「持続効果の結果」と分かる（攻撃の Damaged とは区別する）', () => {
    const { s } = twoPoisons();
    const r = end(s, 3); // かみ 3：相手に40（攻撃）→ ターンの終わりに どく2つ
    const damaged = r.events.map((e, i) => ({ e, i })).filter(({ e }) => e.type === 'Damaged');
    const kinds = damaged.map(({ i }) => (lastingInEffect(r.events, i) ? 'lasting' : 'attack'));
    expect(kinds).toEqual(['attack', 'lasting', 'lasting']);
    // 攻撃の Damaged の前には MoveSelected、持続効果の Damaged の前には LastingFired
    expect(lastingInEffect(r.events, damaged[1].i)?.seq).toBe(4);
  });
});

describe('⑨ 遅延ドローは山札に出て、カードの横には出ない', () => {
  it('drawTags には出て、lastingRows には出ない。古いものが左', () => {
    let s = game([['takarabako', 3], ['mutsuashi', 12]], [['mutsuashi', 15]], { active: 'takarabako', bench: ['takarabako', 'mutsuashi'] }, { active: 'mutsuashi' });
    let r = end(s, 1);
    r = ok(r.state, { type: 'PROMOTE', player: 'p1', benchUid: r.state.players.p1.bench[0] }); // 2つ目のたからばこ
    r = end(r.state, 1);
    r = end(r.state, 1); // 2つ目も 999 で気絶 → ドローが2つ
    expect(drawTags(r.state, 'p1').map((l) => [l.seq, l.turns])).toEqual([
      [1, 8],
      [2, 9],
    ]);
    expect(drawTags(r.state, 'p2')).toEqual([]);
    const a = r.state.players.p1.active;
    expect(lastingRows(r.state, a).flat()).toEqual([]);
  });
});

describe('⑩ 「あと」の数字は持ち主のターンごとに減り、0で引く', () => {
  it('p1 のターンの終わりだけ 9 → 8 → … → 1 → 0 で4枚引く', () => {
    let s = game([['takarabako', 3], ['mutsuashi', 12]], [['mutsuashi', 15]], { active: 'takarabako', bench: ['mutsuashi'] }, { active: 'mutsuashi' });
    let r = end(s, 1);
    let view = r.state;
    const left: number[] = [drawTags(view, 'p1')[0].turns];
    for (let i = 1; i <= 9; i++) {
      r = end(r.state, 1); // p2：数えない
      view = viewAfter(view, r.events);
      expect(drawTags(view, 'p1')[0]?.turns ?? 0).toBe(left[left.length - 1]);
      r = end(r.state, 1); // p1：1つ減る
      const fired = eventsOf(r.events, 'LastingFired');
      view = viewAfter(view, r.events);
      if (i < 9) {
        expect(fired).toEqual([]);
        left.push(drawTags(view, 'p1')[0].turns);
      } else {
        // 0 になったので引く（引いたあとは札が消える）
        expect(fired.map((e) => e.lasting.kind)).toEqual(['draw']);
        expect(eventsOf(r.events, 'LastingTicked')[0].seqs).toContain(1);
        expect(eventsOf(r.events, 'Drew').filter((d) => d.player === 'p1').length).toBeGreaterThanOrEqual(4);
        expect(drawTags(view, 'p1')).toEqual([]);
      }
    }
    expect(left).toEqual([9, 8, 7, 6, 5, 4, 3, 2, 1]);
  });
});

describe('⑪ 同じターンなら、持続ダメージ・回復の後に引く', () => {
  it('先に受けたドローでも、回復のあとに引く', () => {
    const BOTH = testCard(913, [{ type: 'draw', count: 0, then: [2] }, { type: 'heal', amount: 0, then: [30] }]);
    let s = startMain({ cardDb: withCards(BOTH), decks: { p1: Array(15).fill(913), p2: deckOf([['mutsuashi', 15]]) } });
    const me = act(s, 'p1');
    s = patchCard(s, me, { hp: 100 });
    let r = end(s, 1);
    expect(r.state.lasting.map((l) => [l.seq, l.kind, l.turns])).toEqual([
      [1, 'draw', 1],
      [2, 'heal', 1],
    ]);
    r = end(r.state, 1); // p2
    r = end(r.state, 1); // p1：回復30 → 2枚引く
    const types = r.events.filter((e) => ['LastingFired', 'Healed', 'Drew', 'LastingTicked'].includes(e.type)).map((e) => (e.type === 'LastingFired' ? `F:${e.lasting.kind}` : e.type));
    // 回復 → 1ターン進む → ドロー（2枚）。この技で新しく付いた分は、このターンは数えない
    expect(types.slice(0, 6)).toEqual(['F:heal', 'Healed', 'LastingTicked', 'F:draw', 'Drew', 'Drew']);
  });
});

describe('表の札の大きさ（入りきらない時）', () => {
  it('3つまではふつうの大きさ、4つは小さく、5つ以上は「+2」', () => {
    expect(rowFit(1)).toEqual({ size: 44, shown: 1 });
    expect(rowFit(3)).toEqual({ size: 44, shown: 3 });
    expect(rowFit(4).shown).toBe(4);
    expect(rowFit(4).size).toBeLessThan(44);
    expect(rowFit(4).size).toBeGreaterThanOrEqual(TAG_MIN);
    const five = rowFit(5);
    expect(five.shown).toBeLessThan(5);
    expect(five.size).toBe(TAG_MIN);
  });
});

describe('表示用の状態（viewReducer）の持続効果は、エンジンと一致する', () => {
  it('持続効果のカードを入れたデッキで、ランダム20試合：操作ごとに lasting（seq・turns）が同じ', async () => {
    const { applyAction, createGame, getLegalActions, seedRng } = await import('../src/engine');
    const { nextInt } = await import('../src/engine/rng');
    const deck = deckOf([['dokusage', 3], ['hasami', 2], ['yukidaruma', 2], ['bakudan', 2], ['takarabako', 2], ['ootoro', 2], ['bunbunbun', 2]]);
    const key = (s: GameState) => s.lasting.map((l) => `${l.seq}:${l.kind}:${l.targetUid}:${l.turns}`).sort();
    let compared = 0;
    for (let g = 0; g < 20; g++) {
      let { state } = createGame({ seed: `lv-${g}`, decks: { p1: deck, p2: deck }, cardDb: CARD_DB });
      const pick = seedRng(`lvp-${g}`);
      for (let step = 0; step < 300 && state.phase !== 'over'; step++) {
        const legal = [...getLegalActions(state, 'p1'), ...getLegalActions(state, 'p2')];
        const r = applyAction(state, legal[nextInt(pick, legal.length)]);
        const view = viewAfter(state, r.events);
        expect(key(view)).toEqual(key(r.state));
        if (r.state.lasting.length > 0) compared++;
        state = r.state;
      }
    }
    expect(compared).toBeGreaterThan(50);
  });
});
