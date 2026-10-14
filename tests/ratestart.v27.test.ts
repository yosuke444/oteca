import { describe, expect, it } from 'vitest';
import { lastBatchAt, nextBatchAt } from '../src/online/batchTime';
import { UPDATING_POLL_MS, rankingClock } from '../src/online/ranking';
import { BATCH_CHUNK, rankingTiming, shouldRunScheduled } from '../worker/src/logic/schedule';
import { RETRY_FRONT_MS, cleanStartReport, mergeStart, retryFront } from '../worker/src/logic/start';
import { pickPairs, type Waiter } from '../worker/src/logic/queue';
import { cleanIceServers } from '../src/net/iceServers';

/**
 * v2.7 ランキングの更新の時刻・レート対戦が始まらない時（確認 ①②③。Worker を通した確かめは scripts/worker-test.mjs）
 */

/** 2026-10-14 16:00（日本時間）＝ 07:00 UTC */
const SLOT = Date.UTC(2026, 9, 14, 7, 0, 0);

describe('① 予定の時刻を過ぎて新しいデータが無い間は「こうしん ちゅう…」。時間は延びない', () => {
  it('サーバー：まだ更新されていなければ、次の更新は予定の時刻のまま（過ぎている）と updating', () => {
    const now = SLOT + 40_000;
    expect(rankingTiming(SLOT - 12 * 3600e3, now)).toEqual({ nextAt: SLOT, updating: true });
    // 更新が済んだら次の予定（4:00）
    expect(rankingTiming(SLOT + 30_000, now)).toEqual({ nextAt: nextBatchAt(now), updating: false });
    // 一度も更新していない（データが無い）時は「こうしん ちゅう」にしない
    expect(rankingTiming(0, now).updating).toBe(false);
  });

  it('画面：updating か、サーバーの時刻で予定を過ぎたら「こうしん ちゅう」。5分などに延ばして見せない', () => {
    const recv = 1_000_000;
    expect(rankingClock({ nextAt: SLOT, updating: true, serverNow: SLOT + 1000 }, recv, recv + 5 * 60e3)).toEqual({ kind: 'updating' });
    // 予定の10秒前に受け取り、20秒たった（サーバーの時刻では予定を過ぎた）→ こうしん ちゅう
    expect(rankingClock({ nextAt: SLOT, updating: false, serverNow: SLOT - 10_000 }, recv, recv + 20_000)).toEqual({ kind: 'updating' });
    // サーバーの時刻で数える：端末の時計が1時間ずれていても、残りは予定までの時間
    const devClock = SLOT - 3600e3 * 5;
    expect(rankingClock({ nextAt: SLOT, serverNow: SLOT - 65_000 }, devClock, devClock + 5_000)).toEqual({ kind: 'count', text: '0:01:00' });
    expect(UPDATING_POLL_MS).toBe(30_000);
  });
});

describe('② 更新の処理を2回動かしても結果が同じ（予定の更新は、済んでいれば何もしない）', () => {
  it('その回が済んでいれば2回目は動かない。続きが残っていれば動く', () => {
    const now = SLOT + 9 * 60e3;
    expect(shouldRunScheduled(SLOT - 1, now, false)).toBe(true);
    // 1回目で更新された後の2回目
    expect(shouldRunScheduled(SLOT + 9 * 60e3, now, false)).toBe(false);
    // 多くて分けた時は、続きを動かす
    expect(shouldRunScheduled(SLOT + 9 * 60e3, now, true)).toBe(true);
    expect(lastBatchAt(now)).toBe(SLOT);
    // 1回で計算するのは2000試合まで（続きは目覚まし）
    expect(BATCH_CHUNK).toBe(2000);
  });
});

describe('③ レートで15秒つながらなければ、両方が待機の先頭に戻る（レートは変わらない）', () => {
  const w = (n: number, joinedAt: number, playerId = String(100000000000000 + n)): Waiter => ({ id: `w${n}`, playerId, protocol: 15, lastOpponentId: '', name: '', rate: 100, trophies: 0, tab: '', joinedAt, seq: n });

  it('組んでから15秒（RateScene の START_TIMEOUT_MS）', async () => {
    const { START_TIMEOUT_MS } = await import('../src/scenes/Online/RateScene');
    expect(START_TIMEOUT_MS).toBe(15_000);
  });

  it('先頭に入る（joinedAt 0）：先に待っていた人より先に組まれる。つながらなかった相手とは、ほかに人がいれば組まない', () => {
    // 先に待っていた2人（1・2）と、つながらずに戻った2人（3・4。先頭。受付係は相手を「直前の相手」にする）
    const w3 = { ...w(3, 0), lastOpponentId: w(4, 0).playerId };
    const w4 = { ...w(4, 0), lastOpponentId: w(3, 0).playerId };
    const pairs = pickPairs([w(1, 1000), w(2, 2000), w3, w4]);
    expect(pairs.map((p) => [p.a.id, p.b.id])).toEqual([['w3', 'w1'], ['w4', 'w2']]);
    // 2人だけなら、また組む（ほかに人がいない）
    expect(pickPairs([w3, w4]).map((p) => [p.a.id, p.b.id])).toEqual([['w3', 'w4']]);
  });

  it('先頭に入れるのは、その試合の2人で、まだ始まっておらず、組んでから2分以内', () => {
    const game = { a: 'A', b: 'B', created: 10_000 };
    expect(retryFront(game, 'failed', 'A', 20_000)).toBe(true);
    expect(retryFront(game, null, 'B', 20_000)).toBe(true);
    expect(retryFront(game, 'started', 'A', 20_000)).toBe(false);
    expect(retryFront(game, 'failed', 'C', 20_000)).toBe(false);
    expect(retryFront(game, 'failed', 'A', 10_000 + RETRY_FRONT_MS + 1)).toBe(false);
    expect(retryFront(null, null, 'A', 20_000)).toBe(false);
  });

  it('始まった・つながらなかったの記録：どちらかが始まったと言えば started（failed で上書きしない）', () => {
    expect(mergeStart(null, 'failed')).toBe('failed');
    expect(mergeStart('failed', 'started')).toBe('started');
    expect(mergeStart('started', 'failed')).toBe('started');
    expect(cleanStartReport({ matchId: 'ab'.repeat(8), state: 'failed' })).toEqual({ matchId: 'ab'.repeat(8), state: 'failed' });
    expect(cleanStartReport({ matchId: 'xyz', state: 'failed' })).toBeNull();
    expect(cleanStartReport({ matchId: 'ab'.repeat(8), state: 'won' })).toBeNull();
  });

  it('TURN の接続先の形を確かめる（urls が文字列・文字列の並び）', () => {
    expect(cleanIceServers([{ urls: 'turn:a', username: 'u', credential: 'c' }, { urls: ['turn:b', 'turns:c'] }, { urls: 3 }, null])).toHaveLength(2);
    expect(cleanIceServers('x')).toEqual([]);
  });
});
