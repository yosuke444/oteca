import raw from '../data/economy.json';
import type { CpuLevel } from '../cpu/brains';
import type { Side } from '../engine/types';
import type { SaveData } from '../save/saveData';

/**
 * おてあげコイン・ログインボーナス・対戦の報酬（SPEC §7 S11・UPDATE_v2 §5）。
 * 数値は src/data/economy.json にだけ書く。ここは日付（YYYYMMDD の数）を受け取る純粋な処理だけ
 * （今日の日付は画面の側で todayKey() を呼んで渡す）。
 */

export type Economy = {
  coinsMax: number;
  loginBonus: number;
  onlineReward: { friend: number; rate: number };
  cpuWinReward: Record<CpuLevel, number>;
  dailyRewardLimit: number;
  minTurnsEach: number;
  debugAddCoins: number;
};

export const ECONOMY: Economy = raw as Economy;

/** 端末の日付（0時で切り替え）→ 20261002 のような数 */
export function todayKey(d: Date): number {
  return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
}

/** YYYYMMDD の1日前（デバッグの「1日 すすめる」で、記録の方を1日ずらすのに使う） */
export function prevDayKey(key: number): number {
  if (key <= 0) return 0;
  const d = new Date(Math.floor(key / 10000), Math.floor(key / 100) % 100 - 1, key % 100);
  d.setDate(d.getDate() - 1);
  return todayKey(d);
}

/** コインを足す（上限 99,999・0 未満にならない）。実際に増えた枚数を返す */
export function addCoins(save: Pick<SaveData, 'coins'>, amount: number): number {
  const before = save.coins;
  save.coins = Math.max(0, Math.min(ECONOMY.coinsMax, before + amount));
  return save.coins - before;
}

// ---------------------------------------------------------------- ログインボーナス

/** 今日のログボを まだ受け取っていないか */
export function canClaimLoginBonus(save: Pick<SaveData, 'loginBonus'>, today: number): boolean {
  return save.loginBonus.lastDate !== today;
}

/**
 * ログボを受け取る（下書きを書き換える）。コインと「今日受け取った」を同じ保存で書く。
 * @returns 増えたコイン（受け取れない日は 0）
 */
export function claimLoginBonus(draft: Pick<SaveData, 'loginBonus' | 'coins'>, today: number): number {
  if (!canClaimLoginBonus(draft, today)) return 0;
  draft.loginBonus.lastDate = today;
  return addCoins(draft, ECONOMY.loginBonus);
}

// ---------------------------------------------------------------- 対戦の報酬

/** 報酬の種類：online＝フレンド対戦、rate＝レート対戦（G で作る）、cpu、none＝デバッグ・カードを ためす・チュートリアル */
export type RewardKind = 'friend' | 'rate' | 'cpu' | 'none';

export type MatchInfo = {
  kind: RewardKind;
  cpuLevel?: CpuLevel;
  /** 自分が勝ったか */
  win: boolean;
  /** 両者の自分ターン数（試合が終わった時） */
  turnCounts: Record<Side, number>;
};

/**
 * 報酬の結果。
 * - ok：もらえた
 * - short：フレンド・レートで、どちらかが2ターンに届かなかった
 * - limit：フレンド・レートで、今日の分（20試合）をもうもらった
 * - lose：CPU対戦で負けた
 * - none：報酬の無い対戦
 */
export type RewardResult = { coins: number; status: 'ok' | 'short' | 'limit' | 'lose' | 'none' };

/** 今日の、フレンド・レートで報酬を受けた試合数（日付が変わっていれば 0） */
export function rewardedToday(save: Pick<SaveData, 'dailyReward'>, today: number): number {
  return save.dailyReward.date === today ? save.dailyReward.count : 0;
}

/** その試合の報酬（まだ保存しない。見積もり） */
export function matchReward(save: Pick<SaveData, 'dailyReward'>, info: MatchInfo, today: number): RewardResult {
  switch (info.kind) {
    case 'none':
      return { coins: 0, status: 'none' };
    case 'cpu':
      if (!info.win) return { coins: 0, status: 'lose' };
      return { coins: ECONOMY.cpuWinReward[info.cpuLevel ?? 'normal'] ?? 0, status: 'ok' };
    case 'friend':
    case 'rate': {
      const n = ECONOMY.minTurnsEach;
      if (info.turnCounts.p1 < n || info.turnCounts.p2 < n) return { coins: 0, status: 'short' };
      if (rewardedToday(save, today) >= ECONOMY.dailyRewardLimit) return { coins: 0, status: 'limit' };
      return { coins: ECONOMY.onlineReward[info.kind], status: 'ok' };
    }
  }
}

/**
 * 報酬を下書きに書く（勝敗の記録と同じ update の中で呼ぶ。SPEC §7 S11）。
 * フレンド・レートでもらえた時は、今日の試合数を1増やす。
 */
export function applyMatchReward(draft: Pick<SaveData, 'dailyReward' | 'coins'>, info: MatchInfo, today: number): RewardResult {
  const r = matchReward(draft, info, today);
  if (r.status !== 'ok') return r;
  if (info.kind === 'friend' || info.kind === 'rate') {
    draft.dailyReward = { date: today, count: rewardedToday(draft, today) + 1 };
  }
  return { coins: addCoins(draft, r.coins), status: 'ok' };
}

/**
 * どの報酬になる試合か（リザルトで使う）。勝敗を記録しない試合（record が false：デバッグ対戦・カードを ためす・チュートリアル）、
 * デバッグのフレンド対戦、2人の結果がそろわなかったフレンド対戦（agree が true でない）は none
 */
export function rewardKindFor(setup: { mode: 'online' | 'cpu' | 'local'; record: boolean; debug?: boolean }, agree: boolean | null): RewardKind {
  if (!setup.record || setup.debug) return 'none';
  if (setup.mode === 'online') return agree === true ? 'friend' : 'none';
  if (setup.mode === 'cpu') return 'cpu';
  return 'none';
}

/** デバッグ「ログボの日付を 1日 すすめる」：最後に受け取った日・報酬の日を1日前にずらす（次の日になったのと同じ） */
export function debugNextDay(draft: Pick<SaveData, 'loginBonus' | 'dailyReward'>): void {
  draft.loginBonus.lastDate = prevDayKey(draft.loginBonus.lastDate);
  draft.dailyReward.date = prevDayKey(draft.dailyReward.date);
}
