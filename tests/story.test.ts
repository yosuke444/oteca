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
import { ENEMY, PLAYER, STORY, applyStoryResult, isUnlocked, opensAfter, stageByNo, stageDeckNos, stageLevel, stageRules, stageState, storyReward } from '../src/story/story';

const no = (id: string) => cardById(id)!.no;
const clear = (save: ReturnType<typeof createDefaultSave>, ...stages: number[]) => {
  for (const s of stages) applyStoryResult(save, s, true);
};

describe('F01 story.json の15ステージと敵デッキ', () => {
  it('15ステージ（ボス4・雑魚11）。番号は1〜15、前のステージの つながりが正しい', () => {
    expect(STORY.stages.map((s) => s.no)).toEqual(Array.from({ length: 15 }, (_, i) => i + 1));
    expect(STORY.stages.filter((s) => s.kind === 'boss').map((s) => s.no)).toEqual([3, 7, 11, 15]);
    expect(new Set(STORY.stages.filter((s) => s.kind === 'boss').map((s) => s.boss))).toEqual(new Set(['ningen', 'usagi', 'zamurai', 'dragon']));
    for (const s of STORY.stages) for (const a of s.after) expect(stageByNo(a), `${s.no} の前 ${a}`).toBeDefined();
    // 3つ ＋ 分かれ道3本×4（UPDATE_v2 §7-1）
    expect(stageByNo(1)!.after).toEqual([]);
    expect(stageByNo(2)!.after).toEqual([1]);
    expect(stageByNo(3)!.after).toEqual([2]);
    expect(STORY.stages.filter((s) => s.after.includes(3)).map((s) => s.no)).toEqual([4, 8, 12]);
    expect([5, 6, 7].map((n) => stageByNo(n)!.after[0])).toEqual([4, 5, 6]);
    expect([9, 10, 11].map((n) => stageByNo(n)!.after[0])).toEqual([8, 9, 10]);
    expect([13, 14, 15].map((n) => stageByNo(n)!.after[0])).toEqual([12, 13, 14]);
  });

  it('どの敵デッキも、デッキのルール（15枚・おてあげ1枚以上・スーパーは1枚まで）を満たす', () => {
    for (const s of STORY.stages) {
      const deck = stageDeckNos(s);
      expect(deck.length, `ステージ ${s.no}`).toBe(15);
      expect(validateDeck(deck, CARD_DB), `ステージ ${s.no}`).toEqual([]);
    }
  });

  it('雑魚は ふつう、ボスは つよい。ボスは限定カードとボスルールを持ち、限定カードはパックから出ない', () => {
    for (const s of STORY.stages) {
      expect(stageLevel(s)).toBe(s.kind === 'boss' ? 'strong' : 'normal');
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

describe('F02 分かれ道の解放', () => {
  it('最初は1だけ。1 → 2 → 3。3 をクリアすると 4・8・12 が同時に開く。どれからでも進める', () => {
    const save = createDefaultSave();
    expect(STORY.stages.filter((s) => isUnlocked(save, s.no)).map((s) => s.no)).toEqual([1]);
    expect(opensAfter(save, 1)).toEqual([2]);
    clear(save, 1);
    expect(stageState(save, 1)).toBe('cleared');
    expect(stageState(save, 2)).toBe('open');
    expect(stageState(save, 3)).toBe('locked');
    clear(save, 2);
    expect(opensAfter(save, 3)).toEqual([4, 8, 12]);
    clear(save, 3);
    expect([4, 8, 12].map((n) => stageState(save, n))).toEqual(['open', 'open', 'open']);
    expect([5, 9, 13].map((n) => stageState(save, n))).toEqual(['locked', 'locked', 'locked']);
    // 右の道から進んでもよい
    clear(save, 12, 13, 14);
    expect(stageState(save, 15)).toBe('open');
    expect(stageState(save, 5)).toBe('locked');
    clear(save, 8);
    expect(stageState(save, 9)).toBe('open');
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
    const st = stageByNo(7)!;
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
    const s = sandboxGame(stageRules(stageByNo(11)!), { p1: 'oteage', p2: 'oteage' }, []);
    const boss = s.cards[s.players[ENEMY].active!];
    const me = s.cards[s.players[PLAYER].active!];
    expect(moveDamage(s, boss, 30)).toBe(50);
    expect(moveDamage(s, boss, 0)).toBe(0);
    expect(moveDamage(s, me, 30)).toBe(30);
    // 実際に攻撃しても +20：自分の攻撃（目1：30ダメ）→ ボスの攻撃（目2：30 → 50）
    const g = sandboxGame(stageRules(stageByNo(11)!), { p1: 'oteage', p2: 'oteage' }, [1, 2]);
    const r1 = applyAction(g, { type: 'END_TURN', player: PLAYER });
    expect(r1.events.find((e) => e.type === 'Damaged')).toMatchObject({ amount: 30 });
    const r2 = applyAction(r1.state, { type: 'END_TURN', player: ENEMY });
    const dmg = r2.events.find((e): e is Extract<GameEvent, { type: 'Damaged' }> => e.type === 'Damaged' && r2.state.cards[e.uid].owner === PLAYER);
    expect(dmg?.amount).toBe(50);
  });

  it('おてあげドラゴン：プレイヤーはボスのおてあげを4体倒さないと勝てない。ボスは3体で勝ち', () => {
    const st = stageByNo(15)!;
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
    for (const n of [3, 7, 11, 15]) {
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
    clear(save, 1, 2, 3, 8);
    applyStoryResult(save, 1, true);
    const back = normalizeSave(decodeSave(encodeSave(normalizeSave(save))));
    expect(back.story).toEqual(normalizeSave(save).story);
    expect(stageState(back, 9)).toBe('open');
    expect(stageState(back, 4)).toBe('open');
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
