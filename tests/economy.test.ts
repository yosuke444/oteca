import { describe, expect, it } from 'vitest';
import economy from '../src/data/economy.json';
import { ECONOMY, LOGIN_BONUS_MS, addCoins, formatCountdown, loginBonusRemainingMs, applyMatchReward, canClaimLoginBonus, claimLoginBonus, debugNextDay, matchReward, prevDayKey, rewardKindFor, rewardedToday, todayKey, type MatchInfo } from '../src/economy/rewards';
import { StatsCollector } from '../src/battle/stats';
import { type Action, applyAction } from '../src/engine';
import { deckOf, forceDice, startMain } from './helpers';
import { createDefaultSave } from '../src/save/saveData';

/** コインと報酬（SPEC §7 S11・§16-2c。UPDATE_v2 §5） */

const DAY1 = 20261002;
const DAY2 = 20261003;
const turns = (p1: number, p2: number) => ({ p1, p2 });
const friend = (p1 = 2, p2 = 2, win = true): MatchInfo => ({ kind: 'friend', win, turnCounts: turns(p1, p2) });

describe('日付', () => {
  it('端末の日付を YYYYMMDD の数にする。1日前（月・年またぎも）', () => {
    expect(todayKey(new Date(2026, 9, 2, 0, 0, 1))).toBe(20261002);
    expect(todayKey(new Date(2026, 9, 2, 23, 59, 59))).toBe(20261002);
    expect(prevDayKey(20261001)).toBe(20260930);
    expect(prevDayKey(20260101)).toBe(20251231);
    expect(prevDayKey(20240301)).toBe(20240229);
    expect(prevDayKey(0)).toBe(0);
  });
});

describe('D01 ログインボーナス（v2.1-L：受け取ってから24時間後）', () => {
  const T0 = new Date(2026, 9, 2, 15, 30, 0).getTime();
  const H = 60 * 60 * 1000;
  it('まだ受け取っていなければ50枚。24時間たつまでは無し。24時間たてば また もらえる（何日たっても1回分）', () => {
    const s = createDefaultSave();
    expect(s.coins).toBe(200);
    expect(canClaimLoginBonus(s, T0)).toBe(true);
    expect(loginBonusRemainingMs(s, T0)).toBe(0);
    expect(claimLoginBonus(s, T0)).toBe(50);
    expect(s.coins).toBe(250);
    expect(s.loginBonus.claimedAt).toBe(T0);
    // 0時をまたいでも、24時間たつまでは もらえない
    for (const later of [1, 9 * H, 23 * H + 59 * 60 * 1000 + 59 * 1000]) {
      expect(canClaimLoginBonus(s, T0 + later)).toBe(false);
      expect(claimLoginBonus(s, T0 + later)).toBe(0);
    }
    expect(s.coins).toBe(250);
    expect(loginBonusRemainingMs(s, T0 + 2000)).toBe(24 * H - 2000);
    expect(canClaimLoginBonus(s, T0 + 24 * H)).toBe(true);
    // 何日も開かなくても、もらえるのは1回分だけ。次はそこから24時間
    expect(claimLoginBonus(s, T0 + 100 * H)).toBe(50);
    expect(s.coins).toBe(300);
    expect(claimLoginBonus(s, T0 + 101 * H)).toBe(0);
    expect(s.loginBonus.claimedAt).toBe(T0 + 100 * H);
  });

  it('残り時間は 時:分:秒（秒は切り上げ）。時計を戻して受け取った時刻が未来になったら、受け取れる', () => {
    expect(formatCountdown(24 * H)).toBe('24:00:00');
    expect(formatCountdown(24 * H - 2000)).toBe('23:59:58');
    expect(formatCountdown(24 * H - 1500)).toBe('23:59:59');
    expect(formatCountdown(61 * 1000)).toBe('0:01:01');
    expect(formatCountdown(1)).toBe('0:00:01');
    expect(formatCountdown(0)).toBe('0:00:00');
    expect(formatCountdown(-5)).toBe('0:00:00');
    const s = createDefaultSave();
    claimLoginBonus(s, T0);
    expect(loginBonusRemainingMs(s, T0 - 5 * H)).toBe(0);
    expect(canClaimLoginBonus(s, T0 - 5 * H)).toBe(true);
  });

  it('上限 99,999 を超えない', () => {
    const s = createDefaultSave();
    s.coins = 99990;
    expect(claimLoginBonus(s, T0)).toBe(9);
    expect(s.coins).toBe(99999);
    expect(addCoins(s, 5)).toBe(0);
    expect(ECONOMY.coinsMax).toBe(99999);
  });

  it('数値は economy.json の値', () => {
    expect(ECONOMY.loginBonus).toBe(economy.loginBonus);
    expect(ECONOMY.loginBonus).toBe(50);
    expect(ECONOMY.loginBonusHours).toBe(24);
    expect(LOGIN_BONUS_MS).toBe(24 * 60 * 60 * 1000);
  });
});

describe('D02 CPU対戦の報酬', () => {
  it('勝った時だけ、強さごと（よわい20・ふつう30・つよい50・さいきょう80）', () => {
    const levels = { weak: 20, normal: 30, strong: 50, strongest: 80 } as const;
    for (const [level, coins] of Object.entries(levels)) {
      const s = createDefaultSave();
      const r = applyMatchReward(s, { kind: 'cpu', cpuLevel: level as keyof typeof levels, win: true, turnCounts: turns(1, 1) }, DAY1);
      expect(r).toEqual({ coins, status: 'ok' });
      expect(s.coins).toBe(200 + coins);
      // CPU対戦は1日の数に入らない
      expect(rewardedToday(s, DAY1)).toBe(0);
      const lose = applyMatchReward(s, { kind: 'cpu', cpuLevel: level as keyof typeof levels, win: false, turnCounts: turns(5, 5) }, DAY1);
      expect(lose).toEqual({ coins: 0, status: 'lose' });
    }
  });

  it('デバッグ対戦・カードを ためす・チュートリアルは 0', () => {
    const s = createDefaultSave();
    expect(applyMatchReward(s, { kind: 'none', win: true, turnCounts: turns(9, 9) }, DAY1)).toEqual({ coins: 0, status: 'none' });
    expect(s.coins).toBe(200);
  });
});

describe('D03 フレンド・レートの報酬：両者2ターン以上', () => {
  it('両者2ターン以上なら、勝っても負けても50枚', () => {
    for (const kind of ['friend', 'rate'] as const) {
      for (const win of [true, false]) {
        const s = createDefaultSave();
        expect(applyMatchReward(s, { kind, win, turnCounts: turns(2, 2) }, DAY1)).toEqual({ coins: 50, status: 'ok' });
        expect(s.coins).toBe(250);
        expect(s.dailyReward).toEqual({ date: DAY1, count: 1 });
      }
    }
  });

  it('どちらかが1ターン以下なら 0（すぐ降参をくり返しても増えない）。1日の数にも入らない', () => {
    for (const [a, b] of [
      [1, 1],
      [1, 2],
      [2, 1],
      [0, 0],
    ]) {
      const s = createDefaultSave();
      expect(applyMatchReward(s, friend(a, b), DAY1)).toEqual({ coins: 0, status: 'short' });
      expect(s.coins).toBe(200);
      expect(rewardedToday(s, DAY1)).toBe(0);
    }
  });
});

describe('D04 フレンド・レートの報酬：1日20試合まで', () => {
  it('フレンドとレートの合計で20試合まで。21試合目は「もう もらった」。次の日はまた20試合', () => {
    const s = createDefaultSave();
    for (let i = 0; i < 20; i++) {
      const kind = i % 2 === 0 ? 'friend' : 'rate';
      expect(applyMatchReward(s, { kind, win: i % 3 === 0, turnCounts: turns(3, 2) }, DAY1).status, `${i + 1}試合め`).toBe('ok');
    }
    expect(s.coins).toBe(200 + 20 * 50);
    expect(rewardedToday(s, DAY1)).toBe(20);
    expect(applyMatchReward(s, friend(), DAY1)).toEqual({ coins: 0, status: 'limit' });
    expect(applyMatchReward(s, { kind: 'rate', win: false, turnCounts: turns(4, 4) }, DAY1)).toEqual({ coins: 0, status: 'limit' });
    expect(s.coins).toBe(1200);
    // 上限の後でも CPU の報酬は出る
    expect(applyMatchReward(s, { kind: 'cpu', cpuLevel: 'weak', win: true, turnCounts: turns(1, 1) }, DAY1).status).toBe('ok');
    // 次の日
    expect(rewardedToday(s, DAY2)).toBe(0);
    expect(applyMatchReward(s, friend(), DAY2)).toEqual({ coins: 50, status: 'ok' });
    expect(s.dailyReward).toEqual({ date: DAY2, count: 1 });
  });

  it('見積もり（matchReward）は保存しない', () => {
    const s = createDefaultSave();
    expect(matchReward(s, friend(), DAY1)).toEqual({ coins: 50, status: 'ok' });
    expect(s.coins).toBe(200);
    expect(s.dailyReward).toEqual({ date: 0, count: 0 });
  });
});

describe('D05 上限と日付のまたぎ', () => {
  it('報酬はコインの上限を超えない（足せた分だけ返す）', () => {
    const s = createDefaultSave();
    s.coins = 99970;
    expect(applyMatchReward(s, friend(), DAY1)).toEqual({ coins: 29, status: 'ok' });
    expect(s.coins).toBe(99999);
  });

  it('前の日の数は、日付が変わると数え直す（20試合に達していても）', () => {
    const s = createDefaultSave();
    s.dailyReward = { date: DAY1, count: 20 };
    expect(matchReward(s, friend(), DAY1).status).toBe('limit');
    expect(matchReward(s, friend(), DAY2).status).toBe('ok');
  });
});

describe('D06 報酬の出ない試合（SPEC §7 S11）', () => {
  it('記録しない試合・デバッグのフレンド対戦・結果がそろわなかったフレンド対戦は報酬なし', () => {
    expect(rewardKindFor({ mode: 'cpu', record: true }, null)).toBe('cpu');
    expect(rewardKindFor({ mode: 'cpu', record: false }, null)).toBe('none'); // デバッグ対戦の かんたんCPU
    expect(rewardKindFor({ mode: 'local', record: false }, null)).toBe('none'); // ひとりで両方・カードを ためす
    expect(rewardKindFor({ mode: 'online', record: true }, true)).toBe('friend');
    expect(rewardKindFor({ mode: 'online', record: true }, false)).toBe('none'); // 結果が食い違った
    expect(rewardKindFor({ mode: 'online', record: true }, null)).toBe('none'); // まだそろっていない・切断
    expect(rewardKindFor({ mode: 'online', record: true, debug: true }, true)).toBe('none'); // デバッグのフレンド対戦
  });
});

describe('D07 「両者2ターン以上」は、終えたターンを数える', () => {
  /** mutsuashi 同士（1の目は回復なので決着しない）で、操作を順に行って集計する。e＝ターンおわり、s1・s2＝降参 */
  const play = (steps: ('e' | 's1' | 's2')[]) => {
    let s = startMain({ decks: { p1: deckOf([['mutsuashi', 15]]), p2: deckOf([['mutsuashi', 15]]) } });
    const stats = new StatsCollector();
    for (const st of steps) {
      const a: Action = st === 'e' ? { type: 'END_TURN', player: s.currentPlayer } : { type: 'SURRENDER', player: st === 's1' ? 'p1' : 'p2' };
      const r = applyAction(forceDice(s, 1), a);
      expect(r.rejected).toBeUndefined();
      stats.add(r.events, r.state);
      s = r.state;
    }
    return { s, stats: stats.result(s) };
  };

  it('相手が1ターン目に降参：1・0 → もらえない（すぐ降参をくり返しても増えない）', () => {
    const { stats } = play(['e', 's2']);
    expect(stats.turnCounts).toEqual({ p1: 1, p2: 0 });
    expect(matchReward(createDefaultSave(), { kind: 'friend', win: true, turnCounts: stats.turnCounts }, DAY1).status).toBe('short');
  });

  it('2ターン目の始めに降参：2・1 → もらえない（始まっただけのターンは数えない）', () => {
    const { stats } = play(['e', 'e', 'e', 's2']);
    expect(stats.turnCounts).toEqual({ p1: 2, p2: 1 });
    expect(matchReward(createDefaultSave(), { kind: 'friend', win: true, turnCounts: stats.turnCounts }, DAY1).status).toBe('short');
  });

  it('両者が2ターンずつ終えてから決着：2・2 → もらえる', () => {
    const { stats } = play(['e', 'e', 'e', 'e', 's1']);
    expect(stats.turnCounts).toEqual({ p1: 2, p2: 2 });
    expect(matchReward(createDefaultSave(), { kind: 'friend', win: false, turnCounts: stats.turnCounts }, DAY1)).toEqual({ coins: 50, status: 'ok' });
  });
});

describe('D08 デバッグ「ログボの日付を 1日 すすめる」', () => {
  it('受け取った時刻を24時間前に・報酬の日を1日前にずらす → ログボがまたもらえ、今日の試合数は0に戻る', () => {
    const s = createDefaultSave();
    const now = new Date(2026, 9, 2, 9, 0, 0).getTime();
    claimLoginBonus(s, now);
    s.dailyReward = { date: DAY1, count: 20 };
    expect(canClaimLoginBonus(s, now + 1000)).toBe(false);
    debugNextDay(s);
    expect(s.loginBonus.claimedAt).toBe(now - 24 * 60 * 60 * 1000);
    expect(canClaimLoginBonus(s, now + 1000)).toBe(true);
    expect(rewardedToday(s, DAY1)).toBe(0);
    // まだ受け取っていない（0）はそのまま
    const t = createDefaultSave();
    debugNextDay(t);
    expect(t.loginBonus.claimedAt).toBe(0);
  });
});
