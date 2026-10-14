import { describe, expect, it } from 'vitest';
import { buildMatchLog, deckCounts, shouldSendMatchLog } from '../src/online/matchLog';
import { MATCH_LOG_DAILY_MAX, cleanMatchLog, rangeSince } from '../worker/src/logic/matchLog';

/**
 * v2.7 実際の対戦のデータ（カードの せいせき。Worker を通した確かめは scripts/worker-test.mjs）
 */

const body = { mode: 'rate', build: 'abc123', protocol: 16, deckA: [[2, 12], [1, 3]], deckB: [[2, 15]], winner: 0, turns: 9, reason: 'ko' };

describe('端末：送る中身', () => {
  it('デッキはカードNo と枚数だけ。名前・ユーザーID・部屋番号は入らない', () => {
    expect(deckCounts([3, 1, 3, 2])).toEqual([[1, 1], [2, 1], [3, 2]]);
    const m = buildMatchLog({ mode: 'friend', decks: { p1: [1, 1, 2], p2: [2] }, winner: 'p2', agree: true, turns: 5, reason: 'surrender' });
    expect(Object.keys(m).sort()).toEqual(['build', 'deckA', 'deckB', 'mode', 'protocol', 'reason', 'turns', 'winner']);
    expect(m.winner).toBe(1);
    expect(buildMatchLog({ mode: 'rate', decks: { p1: [1], p2: [2] }, winner: 'p1', agree: false, turns: 5, reason: 'ko' }).winner).toBe(2);
  });

  it('1試合1回：ふだんは p1 だけ。相手の通信が切れた時は残った方', () => {
    expect(shouldSendMatchLog('p1', 'ko')).toBe(true);
    expect(shouldSendMatchLog('p2', 'ko')).toBe(false);
    expect(shouldSendMatchLog('p2', 'disconnect')).toBe(true);
  });
});

describe('Worker：受け取る中身', () => {
  it('形にあるものだけを取り出す（ほかの項目は捨てる）。デッキは No の順', () => {
    const c = cleanMatchLog({ ...body, name: 'あお', userId: 'x', room: '1234' });
    expect(c).toEqual({ ...body, deckA: [[1, 3], [2, 12]] });
  });

  it('おかしな中身は断る', () => {
    expect(cleanMatchLog({ ...body, deckA: [[1, 3]] })).toBeNull(); // 15枚でない
    expect(cleanMatchLog({ ...body, deckA: [[1, 3], [1, 12]] })).toBeNull(); // 同じ No が2つ
    expect(cleanMatchLog({ ...body, mode: 'cpu' })).toBeNull();
    expect(cleanMatchLog({ ...body, winner: 3 })).toBeNull();
    expect(cleanMatchLog({ ...body, reason: 'x' })).toBeNull();
    expect(cleanMatchLog({ ...body, build: 'A B' })).toBeNull();
    expect(cleanMatchLog(null)).toBeNull();
  });

  it('1日の上限：1試合2回書くので 1万試合（D1 の無料の上限 1日10万回の中）', () => {
    expect(MATCH_LOG_DAILY_MAX * 2).toBeLessThanOrEqual(100_000 / 2);
  });

  it('期間：きょう＝日本時間の0時から・7日・ぜんぶ', () => {
    const now = Date.UTC(2026, 9, 14, 7, 0, 0); // 日本時間 16:00
    expect(rangeSince('today', now)).toBe(Date.UTC(2026, 9, 13, 15, 0, 0));
    expect(rangeSince('7d', now)).toBe(now - 7 * 86400e3);
    expect(rangeSince('all', now)).toBe(0);
  });
});
