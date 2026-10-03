import { describe, expect, it } from 'vitest';
import { RATING } from '../src/config/rating';
import { applyRateResult, expectedScore, nextRate, rateOutcome, resolvePendingRate, safeName, startRateMatch } from '../src/online/rate';
import { createDefaultSave } from '../src/save/saveData';

describe('R01 レートの計算（UPDATE_v2 §8-4）', () => {
  it('表の4例', () => {
    expect([nextRate(100, 100, true) - 100, nextRate(100, 100, false) - 100]).toEqual([10, -10]);
    expect([nextRate(100, 200, true) - 100, nextRate(100, 200, false) - 100]).toEqual([15, -5]);
    expect([nextRate(100, 300, true) - 100, nextRate(100, 300, false) - 100]).toEqual([18, -2]);
    expect([nextRate(200, 100, true) - 200, nextRate(200, 100, false) - 200]).toEqual([5, -15]);
  });
  it('期待勝率は同じレートで 0.5。0 未満にしない。初期値は100', () => {
    expect(expectedScore(150, 150)).toBe(0.5);
    expect(nextRate(2, 100, false)).toBe(0);
    expect(createDefaultSave().rate).toBe(RATING.initial);
  });
  it('勝敗と最高レートを記録する', () => {
    const s = createDefaultSave();
    expect(applyRateResult(s, 100, 'win')).toEqual({ before: 100, after: 110, outcome: 'win' });
    expect(applyRateResult(s, 110, 'lose')).toEqual({ before: 110, after: 100, outcome: 'lose' });
    expect(s.rateStats).toMatchObject({ wins: 1, losses: 1, best: 110 });
  });
});

describe('R02 途中で終わった試合', () => {
  it('試合の始めに「レート対戦中」の印と直前の相手を保存。結果を書くと印は消える', () => {
    const s = createDefaultSave();
    startRateMatch(s, 'opp-1', 120);
    expect(s.pendingRateMatch).toEqual({ opponentId: 'opp-1', opponentRate: 120 });
    expect(s.lastRateOpponentId).toBe('opp-1');
    applyRateResult(s, 120, 'win');
    expect(s.pendingRateMatch).toBeNull();
  });
  it('ページを閉じた：次に開いた時に負けとして1回だけ計算する', () => {
    const s = createDefaultSave();
    startRateMatch(s, 'opp-2', 100);
    expect(resolvePendingRate(s)).toEqual({ before: 100, after: 90, outcome: 'lose' });
    expect(s.rateStats.losses).toBe(1);
    expect(resolvePendingRate(s)).toBeNull();
    expect(s.rate).toBe(90);
  });
  it('ずれ・食い違いは無効（レートも勝敗も変わらない。印は消える）', () => {
    const s = createDefaultSave();
    startRateMatch(s, 'opp-3', 100);
    expect(applyRateResult(s, 100, 'void')).toEqual({ before: 100, after: 100, outcome: 'void' });
    expect(s.rateStats).toMatchObject({ wins: 0, losses: 0 });
    expect(s.pendingRateMatch).toBeNull();
  });
});

describe('R06 禁止語の名前は「ななし」', () => {
  it('ひらがな・カタカナ・空白のちがいも見る。ふつうの名前はそのまま', () => {
    expect(safeName('バカ', 'ななし')).toBe('ななし');
    expect(safeName('う ん こ', 'ななし')).toBe('ななし');
    expect(safeName('FUCK', 'ななし')).toBe('ななし');
    expect(safeName('かすみ', 'ななし')).toBe('かすみ');
    expect(safeName('たろう', 'ななし')).toBe('たろう');
  });
});

describe('R02b 途中で終わった試合の結果の決め方（rateOutcome）', () => {
  const base = { reason: 'ko', agree: null as boolean | null, win: true, oppGone: false, online: true };
  it('降参・ふつうの決着：2人の結果がそろったら勝ち／負け（コインあり）。食い違いは無効', () => {
    expect(rateOutcome({ ...base, reason: 'surrender', agree: true, win: false })).toEqual({ outcome: 'lose', coins: true });
    expect(rateOutcome({ ...base, agree: true })).toEqual({ outcome: 'win', coins: true });
    expect(rateOutcome({ ...base, agree: false })).toEqual({ outcome: 'void', coins: false });
    expect(rateOutcome(base)).toBeNull();
  });
  it('相手の切断・退室：残った側の勝ち（コインなし）。自分がオフラインなら無効', () => {
    expect(rateOutcome({ ...base, reason: 'disconnect' })).toEqual({ outcome: 'win', coins: false });
    expect(rateOutcome({ ...base, reason: 'disconnect', online: false })).toEqual({ outcome: 'void', coins: false });
  });
  it('決着のあと結果がそろう前に相手が出ていった：自分の画面の勝敗（コインなし）', () => {
    expect(rateOutcome({ ...base, oppGone: true, win: false })).toEqual({ outcome: 'lose', coins: false });
  });
  it('印が別の相手・もう無い時は書かない。印を残したまま次の試合を始めると、前の試合は負け', () => {
    const s = createDefaultSave();
    startRateMatch(s, 'a', 100);
    expect(applyRateResult(s, 100, 'win', 'b')).toBeNull();
    expect(s.rate).toBe(100);
    startRateMatch(s, 'b', 100); // a の印が残っていた → 負け
    expect(s.rate).toBe(90);
    expect(s.pendingRateMatch).toEqual({ opponentId: 'b', opponentRate: 100 });
    expect(applyRateResult(s, 100, 'win', 'b')?.after).toBe(101);
    expect(applyRateResult(s, 100, 'win', 'b')).toBeNull();
  });
});
