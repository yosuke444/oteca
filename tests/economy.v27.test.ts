import { describe, expect, it } from 'vitest';
import economyRaw from '../src/data/economy.json';
import storyRaw from '../src/data/story.json';
import { DAILY, cycleKeyAt } from '../src/daily/daily';
import { ECONOMY, applyMatchReward, cpuRewardsLeft, debugNextDay, matchReward, type MatchInfo } from '../src/economy/rewards';
import { createDefaultSave } from '../src/save/saveData';
import { STORY, applyStoryResult } from '../src/story/story';

/**
 * v2.7 報酬の変更（確認 ①〜④）
 * ① ストーリーのボスの初回クリアは150コイン（4体とも。2回目以降は今のまま）
 * ② CPU対戦で勝った時：よわい20・ふつう30・つよい40・さいきょう50
 * ③ コインをもらえるのは1日5回まで。6回目の勝ちは0（対戦はできる）
 * ④ デイリーミッションの入れ替わりの時刻を過ぎると、また5回
 */
const turns = { p1: 3, p2: 3 };
const win = (cpuLevel: MatchInfo['cpuLevel']): MatchInfo => ({ kind: 'cpu', cpuLevel, win: true, turnCounts: turns });
/** 2026-10-12 の、デイリーの入れ替わり（12時）の前と後 */
const at = (day: number, hour: number) => new Date(2026, 9, day, hour, 0, 0).getTime();
const TODAY = 20261012;

describe('① ボスの初回クリアは150コイン', () => {
  it('story.json の値。4体とも同じ。2回目以降は今のまま', () => {
    expect(storyRaw.rewards.boss).toEqual({ first: 150, again: 50 });
    expect(storyRaw.rewards.normal).toEqual({ first: 50, again: 30 });
    const bosses = STORY.stages.filter((s) => s.kind === 'boss');
    expect(bosses).toHaveLength(4);
    for (const st of bosses) {
      const s = createDefaultSave();
      s.coins = 0;
      expect(applyStoryResult(s, st.no, true)?.coins, st.name).toBe(150);
      expect(applyStoryResult(s, st.no, true)?.coins, st.name).toBe(50);
      expect(s.coins).toBe(200);
    }
  });
});

describe('② CPU対戦の強さごとの額', () => {
  it('economy.json の値：よわい20・ふつう30・つよい40・さいきょう50。1日5回', () => {
    expect(economyRaw.cpuWinReward).toEqual({ weak: 20, normal: 30, strong: 40, strongest: 50 });
    expect(ECONOMY.cpuDailyLimit).toBe(5);
  });

  it('勝つと、その額がもらえる。負けは0で、回数にも数えない', () => {
    const cycle = cycleKeyAt(at(12, 13));
    for (const [level, coins] of [['weak', 20], ['normal', 30], ['strong', 40], ['strongest', 50]] as const) {
      const s = createDefaultSave();
      const before = s.coins;
      expect(applyMatchReward(s, win(level), TODAY, cycle)).toEqual({ coins, status: 'ok' });
      expect(s.coins).toBe(before + coins);
      expect(s.cpuReward).toEqual({ cycleKey: cycle, count: 1 });
      expect(applyMatchReward(s, { ...win(level), win: false }, TODAY, cycle)).toEqual({ coins: 0, status: 'lose' });
      expect(s.cpuReward.count).toBe(1);
    }
  });
});

describe('③ 6回目の勝ちではコインが0', () => {
  it('5回までもらえて、6回目からは「おしまい」（limit・0コイン）。回数は5のまま', () => {
    const s = createDefaultSave();
    const cycle = cycleKeyAt(at(12, 13));
    const got: number[] = [];
    for (let i = 0; i < 7; i++) {
      expect(cpuRewardsLeft(s, cycle)).toBe(Math.max(0, 5 - i));
      got.push(applyMatchReward(s, win('strongest'), TODAY, cycle).coins);
    }
    expect(got).toEqual([50, 50, 50, 50, 50, 0, 0]);
    expect(matchReward(s, win('weak'), TODAY, cycle)).toEqual({ coins: 0, status: 'limit' });
    expect(s.cpuReward).toEqual({ cycleKey: cycle, count: 5 });
  });

  it('コインをもらえた勝ちだけ数える（負け・報酬の無い対戦は数えない）。フレンド・レートの1日の数とは別', () => {
    const s = createDefaultSave();
    const cycle = cycleKeyAt(at(12, 13));
    for (let i = 0; i < 10; i++) applyMatchReward(s, { ...win('weak'), win: false }, TODAY, cycle);
    applyMatchReward(s, { kind: 'none', win: true, turnCounts: turns }, TODAY, cycle);
    applyMatchReward(s, { kind: 'friend', win: true, turnCounts: turns }, TODAY, cycle);
    expect(cpuRewardsLeft(s, cycle)).toBe(5);
    expect(s.dailyReward.count).toBe(1);
  });
});

describe('③ コインが上限で増えなかった勝ちは数えない', () => {
  it('コインが 99,999 の時の勝ちは、回数を使わない', () => {
    const s = createDefaultSave();
    const cycle = cycleKeyAt(at(12, 13));
    s.coins = ECONOMY.coinsMax;
    expect(applyMatchReward(s, win('strongest'), TODAY, cycle)).toEqual({ coins: 0, status: 'ok' });
    expect(cpuRewardsLeft(s, cycle)).toBe(5);
    // 少しでも増えれば数える
    s.coins = ECONOMY.coinsMax - 10;
    expect(applyMatchReward(s, win('strongest'), TODAY, cycle)).toEqual({ coins: 10, status: 'ok' });
    expect(cpuRewardsLeft(s, cycle)).toBe(4);
  });
});

describe('④ デイリーミッションの入れ替わりの時刻を過ぎると、また5回', () => {
  it('入れ替わり（daily.json の resetHour）の前は同じ区切り、過ぎたら新しい区切りで5回に戻る', () => {
    const s = createDefaultSave();
    const before = at(12, DAILY.resetHour - 1);
    const after = at(12, DAILY.resetHour);
    expect(cycleKeyAt(before)).not.toBe(cycleKeyAt(after));
    for (let i = 0; i < 5; i++) applyMatchReward(s, win('normal'), TODAY, cycleKeyAt(before));
    expect(cpuRewardsLeft(s, cycleKeyAt(before))).toBe(0);
    // 0時（日付が変わる）では戻らない：入れ替わりの時刻と同じ
    expect(cpuRewardsLeft(s, cycleKeyAt(at(12, 0)))).toBe(0);
    expect(cpuRewardsLeft(s, cycleKeyAt(after))).toBe(5);
    expect(applyMatchReward(s, win('normal'), TODAY, cycleKeyAt(after))).toEqual({ coins: 30, status: 'ok' });
    expect(s.cpuReward).toEqual({ cycleKey: cycleKeyAt(after), count: 1 });
  });

  it('デバッグの「1日 すすめる」でも5回に戻る', () => {
    const s = createDefaultSave();
    const cycle = cycleKeyAt(at(12, 13));
    for (let i = 0; i < 5; i++) applyMatchReward(s, win('weak'), TODAY, cycle);
    debugNextDay(s);
    expect(cpuRewardsLeft(s, cycle)).toBe(5);
  });
});
