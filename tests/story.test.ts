import { describe, expect, it } from 'vitest';
import { CARD_DB, cardById } from '../src/data/cards';
import { PACK_DATA } from '../src/data/packs';
import { applyAction, createGame, validateDeck } from '../src/engine';
import { moveDamage } from '../src/engine/effects';
import type { GameEvent, GameState, Side } from '../src/engine/types';
import { ECONOMY } from '../src/economy/rewards';
import { encodeSave } from '../src/save/binary';
import { decodeSave } from '../src/save/migrate';
import { decodeTransferCode, encodeTransferCode } from '../src/save/transferCode';
import { createDefaultSave, normalizeSave } from '../src/save/saveData';
import { ENEMY, PLAYER, STORY, applyStoryResult, childrenOf, isUnlocked, opensAfter, parseStory, stageByNo, stageDeckNos, stageLevel, stageRules, stageState, storyReward } from '../src/story/story';
import storyRaw from '../src/data/story.json';
import { mapEdges, mapLayout } from '../src/scenes/Story/StoryMap';

const no = (id: string) => cardById(id)!.no;
/** ボスのステージ番号（v2.1-N で番号が変わったので、ボスの id で探す） */
const bossNo = (id: string) => STORY.stages.find((s) => s.boss === id)!.no;
const clear = (save: ReturnType<typeof createDefaultSave>, ...stages: number[]) => {
  for (const s of stages) applyStoryResult(save, s, true);
};

describe('F01 story.json の15ステージと敵デッキ（v2.1-N の並び。UPDATE_v2_1 §4-2）', () => {
  it('15ステージ（ボス4・雑魚11）。番号・位置・前のステージ・敵は §4-2 の表のとおり', () => {
    expect(STORY.stages.map((s) => s.no)).toEqual(Array.from({ length: 15 }, (_, i) => i + 1));
    const table: [number, number, number, string, number[]][] = [
      [1, 0, 0, 'らくがき こぞう', []],
      [2, 0, 1, 'けしかす', [1]],
      [3, 0, 2, 'おてあげニンゲン', [2]],
      [4, -2, 3, 'おしゃべり ペン', [3]],
      [5, 0, 3, 'ぶあつい じしょ', [3]],
      [6, 2, 3, 'えんぴつ けずり', [3]],
      [7, -3, 4, 'まいごの ふせん', [4]],
      [8, -1, 4, 'よふかし ノート', [4, 5]],
      [9, 1, 4, 'こおりの のり', [5, 6]],
      [10, 3, 4, 'あかペン せんせい', [6]],
      [11, -5, 4, 'おてあげウサギ', [7]],
      [12, 0, 5, 'てつの ふでばこ', [8, 9]],
      [13, 3, 5, 'はんこ やさん', [9, 10, 12]],
      [14, 5, 5, 'おてあげザムライ', [13]],
      [15, 0, 6, 'おてあげドラゴン', [12]],
    ];
    expect(STORY.stages.map((s) => [s.no, s.pos.x, s.pos.y, s.name, s.parents])).toEqual(table);
    expect(STORY.stages.filter((s) => s.kind === 'boss').map((s) => [s.no, s.boss])).toEqual([
      [3, 'ningen'],
      [11, 'usagi'],
      [14, 'zamurai'],
      [15, 'dragon'],
    ]);
    // 形のおかしい story.json はエラー
    const bad = (patch: (d: { stages: { no: number; parents: number[]; pos: { x: number; y: number } }[] }) => void) => {
      const d = structuredClone(storyRaw) as unknown as { stages: { no: number; parents: number[]; pos: { x: number; y: number } }[] };
      patch(d);
      return () => parseStory(d);
    };
    expect(bad((d) => (d.stages[1].parents = [99]))).toThrow('前のステージ');
    expect(bad((d) => (d.stages[1].no = 1))).toThrow('重複');
    expect(bad((d) => (d.stages[1].pos = { x: 0, y: 0 }))).toThrow('同じ位置');
    expect(bad((d) => (d.stages[1].parents = [2]))).toThrow('前のステージ');
  });

  it('どの敵デッキも、デッキのルール（15枚・おてあげ1枚以上・スーパーは1枚まで）を満たす', () => {
    for (const s of STORY.stages) {
      const deck = stageDeckNos(s);
      expect(deck.length, `ステージ ${s.no}`).toBe(15);
      expect(validateDeck(deck, CARD_DB), `ステージ ${s.no}`).toEqual([]);
    }
  });

  it('K01 ステージ1・2（らくがき こぞう・けしかす）は よわい、ほかの雑魚は ふつう、ボスは つよい。ボスは限定カードとボスルールを持ち、限定カードはパックから出ない', () => {
    expect(STORY.stages.filter((s) => s.no <= 2).map((s) => s.name)).toEqual(['らくがき こぞう', 'けしかす']);
    for (const s of STORY.stages) {
      expect(stageLevel(s)).toBe(s.no <= 2 ? 'weak' : s.kind === 'boss' ? 'strong' : 'normal');
      if (s.kind === 'boss') {
        expect(s.bossRule?.text.hira, `${s.no}`).toBeTruthy();
        expect(s.bossRule?.text.kanji, `${s.no}`).toBeTruthy();
        expect(PACK_DATA.limited).toContain(s.card);
        for (const p of PACK_DATA.packs) expect([...p.normal, ...p.super]).not.toContain(s.card);
      } else expect(s.card).toBeUndefined();
      expect(s.theme.hira && s.theme.kanji).toBeTruthy();
    }
  });
});

describe('F02・N01 分かれ道と合流の解放（v2.1-N）', () => {
  it('最初は1だけ。1 → 2 → 3 は真っすぐ。3 をクリアすると 4・5・6 が同時に開く', () => {
    const save = createDefaultSave();
    expect(STORY.stages.filter((s) => isUnlocked(save, s.no)).map((s) => s.no)).toEqual([1]);
    expect(opensAfter(save, 1)).toEqual([2]);
    clear(save, 1);
    expect(stageState(save, 1)).toBe('cleared');
    expect(stageState(save, 2)).toBe('open');
    expect(stageState(save, 3)).toBe('locked');
    clear(save, 2);
    expect(opensAfter(save, 3)).toEqual([4, 5, 6]);
    clear(save, 3);
    expect([4, 5, 6].map((n) => stageState(save, n))).toEqual(['open', 'open', 'open']);
    expect([7, 8, 9, 10].map((n) => stageState(save, n))).toEqual(['locked', 'locked', 'locked', 'locked']);
  });

  it('N01 全15ステージに、スタートから行ける（行き止まりや孤立が無い）', () => {
    // スタートから「前のステージ → 次のステージ」をたどって、全部に届く
    const start = STORY.stages.filter((s) => s.parents.length === 0).map((s) => s.no);
    expect(start).toEqual([1]);
    const seen = new Set(start);
    const queue = [...start];
    while (queue.length) for (const c of childrenOf(queue.shift()!)) if (!seen.has(c)) (seen.add(c), queue.push(c));
    expect([...seen].sort((a, b) => a - b)).toEqual(STORY.stages.map((s) => s.no));
    // 実際にクリアしていっても、全部が開いて全部クリアできる
    const save = createDefaultSave();
    for (let round = 0; round < 20; round++) {
      const open = STORY.stages.filter((s) => stageState(save, s.no) === 'open').map((s) => s.no);
      if (!open.length) break;
      clear(save, ...open);
    }
    expect(STORY.stages.every((s) => stageState(save, s.no) === 'cleared')).toBe(true);
    // 最初の3つは分かれ道なしで真っすぐ上
    expect([1, 2, 3].map((n) => [stageByNo(n)!.pos.x, childrenOf(n).length])).toEqual([
      [0, 1],
      [0, 1],
      [0, 3],
    ]);
  });

  it('N02 ボス11（ウサギ）・14（ザムライ）・15（ドラゴン）は行き止まり（次のステージが無い）。ニンゲンは行き止まりではない', () => {
    for (const id of ['usagi', 'zamurai', 'dragon']) expect(childrenOf(bossNo(id)), id).toEqual([]);
    expect(childrenOf(bossNo('ningen')).length).toBeGreaterThan(0);
    // 行き止まりは ボスだけ
    for (const s of STORY.stages) if (childrenOf(s.no).length === 0) expect(s.kind, `ステージ ${s.no}`).toBe('boss');
    // ウサギは左へ横に、ザムライは右へ横に、ドラゴンは一番上
    expect(stageByNo(11)!.pos).toEqual({ x: -5, y: 4 });
    expect(stageByNo(14)!.pos).toEqual({ x: 5, y: 5 });
    expect(Math.max(...STORY.stages.map((s) => s.pos.y))).toBe(stageByNo(15)!.pos.y);
  });

  it('N03 合流のステージは、どちらの前のステージからでも開く（13 は 9・10・12 のどれからでも）', () => {
    const merges = STORY.stages.filter((s) => s.parents.length >= 2);
    expect(merges.map((s) => s.no)).toEqual([8, 9, 12, 13]);
    for (const m of merges) {
      for (const p of m.parents) {
        const save = createDefaultSave();
        clear(save, p);
        expect(stageState(save, m.no), `${m.no} を ${p} から`).toBe('open');
      }
      // 前のステージでないステージだけをクリアしても開かない（例：8 は 6 だけでは開かない）
      const others = STORY.stages.filter((s) => !m.parents.includes(s.no) && s.no !== m.no).map((s) => s.no);
      for (const o of others) {
        const save = createDefaultSave();
        clear(save, o);
        expect(stageState(save, m.no), `${m.no} を ${o} だけで`).toBe('locked');
      }
    }
  });

  it('マップの大きさと線は story.json から自動で決まる（合流点に線が集まる）', () => {
    const layout = mapLayout();
    const { edges, stubs } = mapEdges(layout);
    // 線は「前のステージ」の数だけ
    expect(edges).toHaveLength(STORY.stages.reduce((n, s) => n + s.parents.length, 0));
    // 下から2本以上来るステージ（8・9・12・13）には、合流点からの1本
    expect(stubs.map((s) => s.to)).toEqual([8, 9, 12, 13]);
    // 上のステージほど紙の上（y が小さい）。左右は pos.x の順
    expect(layout.at(15).y).toBeLessThan(layout.at(12).y);
    expect(layout.at(12).y).toBeLessThan(layout.at(1).y);
    expect(layout.at(11).x).toBeLessThan(layout.at(7).x);
    expect(layout.at(14).x).toBeGreaterThan(layout.at(13).x);
    for (const s of STORY.stages) {
      const p = layout.at(s.no);
      expect(p.x).toBeGreaterThan(0);
      expect(p.x).toBeLessThan(layout.width);
      expect(p.y).toBeGreaterThan(0);
      expect(p.y).toBeLessThan(layout.height);
    }
    // 合流のステージに下から来る線は、同じ1点で終わる
    for (const m of [8, 9, 12, 13]) {
      const ends = edges.filter((e) => e.to === m && stageByNo(e.from)!.pos.y < stageByNo(m)!.pos.y).map((e) => e.d.split(' ').slice(-2).join(' '));
      expect(new Set(ends).size, `${m}`).toBe(1);
    }
  });
});

/** 指定の山札・手札の並びで試合を作る（カードを ためす と同じ仕組み） */
function sandboxGame(rules: ReturnType<typeof stageRules>, active: Record<Side, string>, dice: number[]): GameState {
  const side = (id: string) => ({ active: no(id), bench: [], hand: [no('kusuri')], deck: Array.from({ length: 10 }, () => no('kusuri')) });
  return createGame({
    seed: 'f03',
    decks: { p1: [], p2: [] },
    cardDb: CARD_DB,
    sandbox: { p1: side(active.p1), p2: side(active.p2) },
    rules: { p1: { firstPlayerFirstTurnNoAttack: false, ...rules?.p1 }, p2: { firstPlayerFirstTurnNoAttack: false, ...rules?.p2 } },
    forcedDice: dice,
  }).state;
}

describe('F03 ボスルール4種がエンジンで効く', () => {
  it('おてあげニンゲン：ボスだけ最初に7枚引く', () => {
    const st = stageByNo(3)!;
    const s = createGame({ seed: 'n', decks: { p1: stageDeckNos(stageByNo(1)!), p2: stageDeckNos(st) }, cardDb: CARD_DB, rules: stageRules(st) }).state;
    expect(s.players[ENEMY].hand.length).toBe(7);
    expect(s.players[PLAYER].hand.length).toBe(5);
  });

  it('おてあげウサギ：ボスは2ターンに1回ドローする（プレイヤーは3ターンに1回のまま）', () => {
    const st = stageByNo(bossNo('usagi'))!;
    // むつあし どうしで回復の目（1）ばかり出す：だれも倒れない
    let s = sandboxGame(stageRules(st), { p1: 'mutsuashi', p2: 'mutsuashi' }, Array(20).fill(1));
    const draws: Record<Side, number[]> = { p1: [], p2: [] };
    for (let i = 0; i < 12; i++) {
      const r = applyAction(s, { type: 'END_TURN', player: s.currentPlayer });
      expect(r.rejected).toBeUndefined();
      for (const e of r.events) if (e.type === 'Drew') draws[e.player].push(r.state.players[e.player].turnCount);
      s = r.state;
    }
    expect(draws[ENEMY]).toEqual([2, 4, 6]);
    expect(draws[PLAYER]).toEqual([3, 6]);
  });

  it('おてあげザムライ：ボスのダメージ技は +20（0ダメージ・回復には付かない。プレイヤーには付かない）', () => {
    const s = sandboxGame(stageRules(stageByNo(bossNo('zamurai'))!), { p1: 'oteage', p2: 'oteage' }, []);
    const boss = s.cards[s.players[ENEMY].active!];
    const me = s.cards[s.players[PLAYER].active!];
    expect(moveDamage(s, boss, 30)).toBe(50);
    expect(moveDamage(s, boss, 0)).toBe(0);
    expect(moveDamage(s, me, 30)).toBe(30);
    // 実際に攻撃しても +20：自分の攻撃（目1：30ダメ）→ ボスの攻撃（目2：30 → 50）
    const g = sandboxGame(stageRules(stageByNo(bossNo('zamurai'))!), { p1: 'oteage', p2: 'oteage' }, [1, 2]);
    const r1 = applyAction(g, { type: 'END_TURN', player: PLAYER });
    expect(r1.events.find((e) => e.type === 'Damaged')).toMatchObject({ amount: 30 });
    const r2 = applyAction(r1.state, { type: 'END_TURN', player: ENEMY });
    const dmg = r2.events.find((e): e is Extract<GameEvent, { type: 'Damaged' }> => e.type === 'Damaged' && r2.state.cards[e.uid].owner === PLAYER);
    expect(dmg?.amount).toBe(50);
  });

  it('おてあげドラゴン：プレイヤーはボスのおてあげを4体倒さないと勝てない。ボスは3体で勝ち', () => {
    const st = stageByNo(bossNo('dragon'))!;
    const s = createGame({ seed: 'd', decks: { p1: stageDeckNos(stageByNo(1)!), p2: stageDeckNos(st) }, cardDb: CARD_DB, rules: stageRules(st) }).state;
    expect(s.rules[PLAYER].koToWin).toBe(4);
    expect(s.rules[ENEMY].koToWin).toBe(3);
    // 3体目を倒しても決着しない、4体目で勝つ
    const ko = (count: number) => {
      const g = sandboxGame(stageRules(st), { p1: 'oteage', p2: 'oteage' }, [6]);
      g.players[PLAYER].koCount = count;
      g.cards[g.players[ENEMY].active!].hp = 10;
      g.players[ENEMY].bench = [g.players[ENEMY].hand[0]];
      return applyAction(g, { type: 'END_TURN', player: PLAYER });
    };
    const third = ko(2);
    expect(third.events.some((e) => e.type === 'Fainted')).toBe(true);
    expect(third.state.phase).not.toBe('over');
    const fourth = ko(3);
    expect(fourth.state.phase).toBe('over');
    expect(fourth.state.winner).toBe(PLAYER);
  });
});

describe('F04 報酬', () => {
  it('雑魚：初クリア50、2回目以降30。負けは0', () => {
    const save = createDefaultSave();
    const c0 = save.coins;
    expect(applyStoryResult(save, 1, false)).toBeNull();
    expect(save.coins).toBe(c0);
    expect(stageState(save, 1)).toBe('open');
    expect(storyReward(save, stageByNo(1)!, ECONOMY.coinsMax)).toEqual({ first: true, coins: 50, cardNo: null });
    expect(applyStoryResult(save, 1, true)).toEqual({ first: true, coins: 50, cardNo: null });
    expect(save.coins).toBe(c0 + 50);
    expect(applyStoryResult(save, 1, true)).toEqual({ first: false, coins: 30, cardNo: null });
    expect(save.coins).toBe(c0 + 80);
  });

  it('ボス：初クリア200 ＋ 限定カード1枚、2回目以降50（カードは増えない）', () => {
    for (const n of [3, 11, 14, 15]) {
      const save = createDefaultSave();
      const st = stageByNo(n)!;
      const card = no(st.card!);
      const own = save.collection[card] ?? 0;
      expect(applyStoryResult(save, n, true)).toEqual({ first: true, coins: 200, cardNo: card });
      expect(save.collection[card]).toBe(own + 1);
      expect(applyStoryResult(save, n, true)).toEqual({ first: false, coins: 50, cardNo: null });
      expect(save.collection[card]).toBe(own + 1);
      expect(save.story.stages.find((s) => s.no === n)).toEqual({ no: n, cleared: true, firstClear: true });
    }
  });

  it('コイン・所持数の上限を超えない（クリアの印は付く）', () => {
    const save = createDefaultSave();
    save.coins = ECONOMY.coinsMax - 10;
    const card = no('oteage_ningen');
    save.collection[card] = 999;
    expect(storyReward(save, stageByNo(3)!, ECONOMY.coinsMax).coins).toBe(10);
    const got = applyStoryResult(save, 3, true)!;
    expect(got.coins).toBe(10);
    // 所持数が上限で増えなかった時は「手に入れた」にしない
    expect(got.cardNo).toBeNull();
    expect(save.coins).toBe(ECONOMY.coinsMax);
    expect(save.collection[card]).toBe(999);
    expect(stageState(save, 3)).toBe('cleared');
  });
});

describe('F05 進み具合が保存・引き継ぎコードで残る', () => {
  it('クリアの印・初クリアの印が、保存の形に変えて戻しても同じ', () => {
    const save = createDefaultSave();
    clear(save, 1, 2, 3, 5);
    applyStoryResult(save, 1, true);
    const back = normalizeSave(decodeSave(encodeSave(normalizeSave(save))));
    expect(back.story).toEqual(normalizeSave(save).story);
    expect(stageState(back, 8)).toBe('open');
    expect(stageState(back, 9)).toBe('open');
    expect(stageState(back, 4)).toBe('open');
    expect(stageState(back, 7)).toBe('locked');
    expect(back.collection[no('oteage_ningen')]).toBe(1);
  });

  it('引き継ぎコードでも残る', async () => {
    const save = createDefaultSave();
    clear(save, 1, 2, 3, 12, 13);
    const r = await decodeTransferCode(await encodeTransferCode(normalizeSave(save)));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.story).toEqual(normalizeSave(save).story);
    expect(stageState(r.data, 14)).toBe('open');
  });
});
