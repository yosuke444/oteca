import { describe, expect, it } from 'vitest';
import { cutOutcome, matchBegun, resolvePendingMatches, startFriendMatch } from '../src/online/pendingMatch';
import { applyRateResult, beginRateMatch, rateOutcome, startRateMatch } from '../src/online/rate';
import { decodeUnsent } from '../src/online/ranking';
import { ECONOMY, matchReward, rewardKindFor, todayKey } from '../src/economy/rewards';
import { encodeSave } from '../src/save/binary';
import { decodeSave } from '../src/save/migrate';
import { createDefaultSave } from '../src/save/saveData';
import { decide, SINGLE_REPORT_MS, type MatchInfo, type Report } from '../worker/src/logic/results';
import { PAIR_DAILY_LIMIT, runBatch } from '../worker/src/logic/batch';

/**
 * C01〜C05 オンライン対戦で相手の通信が切れた時（v2.4。SPEC §11-7）。
 * 通信の時間（29秒で戻れば続く・30秒で「きれた」）は tests/net.session.test.ts D01・D02 で確かめる
 */
const OPP = '222223333344444';
const ME = '111112222233333';
const MATCH = '0123456789abcdef';

describe('C01・C02 「まっています」から30秒：残った側の勝ち', () => {
  it('対戦が始まっていて自分がつながっていれば勝ち。自分がオフラインなら（切れたのは自分）勝ちにしない', () => {
    expect(cutOutcome({ begun: true, online: true })).toBe('win');
    expect(cutOutcome({ begun: true, online: false })).toBe('selfCut');
  });

  it('勝った側にはふだんの勝ちと同じコイン（フレンド・レート）。両者2ターン以上の決まりはそのまま', () => {
    const save = createDefaultSave();
    const today = todayKey(new Date(2026, 9, 11, 13));
    const enough = { p1: ECONOMY.minTurnsEach, p2: ECONOMY.minTurnsEach };
    const short = { p1: ECONOMY.minTurnsEach, p2: ECONOMY.minTurnsEach - 1 };
    // フレンド：相手が切れて勝った試合は「結果がそろった」と同じに数える（リザルトで agree の代わりに true を渡す）
    const friend = rewardKindFor({ mode: 'online', record: true }, true);
    expect(friend).toBe('friend');
    const normalWin = matchReward(save, { kind: friend, win: true, turnCounts: enough }, today);
    expect(normalWin.coins).toBeGreaterThan(0);
    expect(matchReward(save, { kind: friend, win: true, turnCounts: short }, today).coins).toBe(0);
    // レート：切断の勝ちもコインあり（v2.4。前は無し）
    expect(rateOutcome({ reason: 'disconnect', agree: null, win: true, oppGone: true, online: true })).toEqual({ outcome: 'win', coins: true });
    expect(matchReward(save, { kind: 'rate', win: true, turnCounts: enough }, today).coins).toBeGreaterThan(0);
    expect(matchReward(save, { kind: 'rate', win: true, turnCounts: short }, today).coins).toBe(0);
  });
});

describe('C03 準備中（最初のおてあげを決める前）に切れたら勝ち負けなし', () => {
  it('準備中は「始まっていない」。始まる前に切れたら noGame（待機画面へ）', () => {
    expect(matchBegun(undefined)).toBe(false);
    expect(matchBegun('setup')).toBe(false);
    expect(matchBegun('main')).toBe(true);
    expect(matchBegun('choose')).toBe(true);
    expect(cutOutcome({ begun: matchBegun('setup'), online: true })).toBe('noGame');
    expect(cutOutcome({ begun: matchBegun('setup'), online: false })).toBe('noGame');
  });

  it('レート対戦：始まる前に切れた側が次に開いても、負けにしない（印だけ消える）', () => {
    const s = createDefaultSave();
    startRateMatch(s, OPP, 120, MATCH);
    const res = resolvePendingMatches(s, { ranking: true, now: 1 });
    expect(res).toEqual({ rate: null, friend: false });
    expect(s.pendingRateMatch).toBeNull();
    expect(s.rateStats).toMatchObject({ wins: 0, losses: 0 });
    expect(s.ranking.unsent).toEqual([]);
  });

  it('残った側：始まる前ならレートは無効（印を消す。勝敗もレートも変わらない）', () => {
    const s = createDefaultSave();
    startRateMatch(s, OPP, 120, MATCH);
    expect(applyRateResult(s, 120, 'void', OPP)).toEqual({ before: 100, after: 100, outcome: 'void' });
    expect(s.pendingRateMatch).toBeNull();
  });
});

describe('C04 切れた側が次に開くと負けが記録される', () => {
  it('フレンド対戦：とちゅうの試合の印がセーブに残り（保存の形に変えても）、次に開くと負け +1。知らせは1回', () => {
    const s = createDefaultSave();
    startFriendMatch(s, OPP);
    const reopened = decodeSave(encodeSave(s));
    expect(reopened.pendingFriendMatch).toEqual({ opponentId: OPP });
    const res = resolvePendingMatches(reopened, { ranking: true, now: 1 });
    expect(res).toEqual({ rate: null, friend: true });
    expect(reopened.stats.losses).toBe(1);
    expect(reopened.pendingFriendMatch).toBeNull();
    expect(resolvePendingMatches(reopened, { ranking: true, now: 2 })).toEqual({ rate: null, friend: false });
    expect(reopened.stats.losses).toBe(1);
  });

  it('レート対戦：始まった後の印なら負け。相手の勝ちを受付係へ報告する（相手の報告と一致する）', () => {
    const s = { ...createDefaultSave(), userId: ME };
    startRateMatch(s, OPP, 100, MATCH);
    beginRateMatch(s, OPP);
    const reopened = decodeSave(encodeSave(s));
    const res = resolvePendingMatches(reopened, { ranking: true, now: 5 });
    expect(res.rate).toEqual({ before: 100, after: 90, outcome: 'lose' });
    expect(reopened.rateStats.losses).toBe(1);
    expect(reopened.ranking.unsent.map(decodeUnsent)).toEqual([{ matchId: MATCH, winner: OPP }]);
    expect(reopened.ranking.provisional).toBe(true);
  });
});

describe('C05 レート対戦のランキング（受付係の突き合わせ）', () => {
  const match: MatchInfo = { matchId: MATCH, a: ME, b: OPP, created: 0 };
  const rep = (playerId: string, winner: string, at: number): Report => ({ matchId: MATCH, playerId, winner, at });

  it('両方の報告が一致したら数える。食い違ったら数えない', () => {
    expect(decide(match, [rep(ME, ME, 10), rep(OPP, ME, 20)], 30).kind).toBe('record');
    // 切れた側が「自分の勝ち」と言っても、残った側の報告と食い違うので数えない
    expect(decide(match, [rep(ME, ME, 10), rep(OPP, OPP, 20)], 30)).toEqual({ kind: 'drop' });
    expect(decide(match, [rep(ME, ME, 10), rep(OPP, 'void', 20)], 30)).toEqual({ kind: 'drop' });
  });

  it('切れた側から10分たっても報告が来なければ、勝った側の報告だけで数える', () => {
    expect(decide(match, [rep(ME, ME, 1000)], 1000 + SINGLE_REPORT_MS - 1)).toEqual({ kind: 'wait' });
    expect(decide(match, [rep(ME, ME, 1000)], 1000 + SINGLE_REPORT_MS)).toMatchObject({ kind: 'record', row: { winner: ME } });
  });

  it('同じ相手と1日3試合までの決まりはそのまま（4試合目は数えない）', () => {
    expect(PAIR_DAILY_LIMIT).toBe(3);
    const at = Date.UTC(2026, 9, 11, 3, 0);
    const rows = Array.from({ length: 4 }, (_, i) => ({ id: i + 1, matchId: `00000000000000a${i}`, a: ME, b: OPP, winner: ME, at: at + i * 1000 }));
    const out = runBatch(new Map(), rows, at + 60 * 60 * 1000);
    expect(out.counted).toBe(3);
  });
});
