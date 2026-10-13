import raw from '../data/economy.json';
import type { CpuLevel } from '../cpu/brains';
import type { Side } from '../engine/types';
import type { SaveData } from '../save/saveData';

/**
 * おてあげコイン・ログインボーナス・対戦の報酬（SPEC §7 S11・UPDATE_v2 §5）。
 * 数値は src/data/economy.json にだけ書く。ここは日付（YYYYMMDD の数）・時刻（ミリ秒）を受け取る純粋な処理だけ
 * （今日の日付・今の時刻は画面の側で todayKey()・Date.now() を呼んで渡す）。
 */

export type Economy = {
  coinsMax: number;
  loginBonus: number;
  /** ログボを受け取ってから、次に受け取れるまでの時間（v2.1-L） */
  loginBonusHours: number;
  onlineReward: { friend: number; rate: number };
  cpuWinReward: Record<CpuLevel, number>;
  /** CPU対戦でコインをもらえる勝ちの数（1日。デイリーミッションの入れ替わりで0に戻る。v2.7） */
  cpuDailyLimit: number;
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

// ---------------------------------------------------------------- ログインボーナス（v2.1-L：受け取ってから24時間後）

/** 受け取ってから次に受け取れるまで（ミリ秒） */
export const LOGIN_BONUS_MS = ECONOMY.loginBonusHours * 60 * 60 * 1000;

/**
 * 次にログボを受け取れるまでの残り（ミリ秒）。0 なら今受け取れる。
 * まだ一度も受け取っていない・受け取った時刻が未来（端末の時計を戻した）時も 0（受け取れる。SPEC §7 S11）
 */
export function loginBonusRemainingMs(save: Pick<SaveData, 'loginBonus'>, now: number): number {
  const at = save.loginBonus.claimedAt;
  if (at <= 0 || at > now) return 0;
  return Math.max(0, at + LOGIN_BONUS_MS - now);
}

/** 今ログボを受け取れるか */
export function canClaimLoginBonus(save: Pick<SaveData, 'loginBonus'>, now: number): boolean {
  return loginBonusRemainingMs(save, now) === 0;
}

/**
 * ログボを受け取る（下書きを書き換える）。コインと「受け取った時刻」を同じ保存で書く。
 * 何日たっても1回分（ためない）。
 * @returns 増えたコイン（受け取れない時は 0）
 */
export function claimLoginBonus(draft: Pick<SaveData, 'loginBonus' | 'coins'>, now: number): number {
  if (!canClaimLoginBonus(draft, now)) return 0;
  draft.loginBonus.claimedAt = now;
  return addCoins(draft, ECONOMY.loginBonus);
}

/** 残り時間（ミリ秒）→ 「時:分:秒」（例 23:59:58。秒は切り上げ：0:00:00 になった時に受け取れる） */
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
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
 * - limit：フレンド・レートで今日の分（20試合）、CPU対戦で今日の分（5回。v2.7）をもうもらった
 * - lose：CPU対戦で負けた
 * - none：報酬の無い対戦
 */
export type RewardResult = { coins: number; status: 'ok' | 'short' | 'limit' | 'lose' | 'none' };

/** 今日の、フレンド・レートで報酬を受けた試合数（日付が変わっていれば 0） */
export function rewardedToday(save: Pick<SaveData, 'dailyReward'>, today: number): number {
  return save.dailyReward.date === today ? save.dailyReward.count : 0;
}

/**
 * CPU対戦で、今日あと何回コインをもらえるか（v2.7）。cycle はデイリーミッションの区切り（daily.ts cycleKeyAt。画面の側で渡す）。
 * 区切りが変わっていれば、まだ1回も もらっていない
 */
export function cpuRewardsLeft(save: Pick<SaveData, 'cpuReward'>, cycle: number): number {
  const used = save.cpuReward.cycleKey === cycle ? save.cpuReward.count : 0;
  return Math.max(0, ECONOMY.cpuDailyLimit - used);
}

/** その試合の報酬（まだ保存しない。見積もり）。cycle は CPU対戦の回数を数える区切り（デイリーミッションと同じ） */
export function matchReward(save: Pick<SaveData, 'dailyReward' | 'cpuReward'>, info: MatchInfo, today: number, cycle: number): RewardResult {
  switch (info.kind) {
    case 'none':
      return { coins: 0, status: 'none' };
    case 'cpu':
      if (!info.win) return { coins: 0, status: 'lose' };
      // 1日 cpuDailyLimit 回まで。6回目からも対戦はできるが、コインは0（v2.7）
      if (cpuRewardsLeft(save, cycle) <= 0) return { coins: 0, status: 'limit' };
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
 * フレンド・レートでもらえた時は、今日の試合数を1増やす。CPU対戦でもらえた時は、今日の回数を1増やす（コインをもらえた勝ちだけ数える。v2.7）。
 */
export function applyMatchReward(draft: Pick<SaveData, 'dailyReward' | 'cpuReward' | 'coins'>, info: MatchInfo, today: number, cycle: number): RewardResult {
  const r = matchReward(draft, info, today, cycle);
  if (r.status !== 'ok') return r;
  if (info.kind === 'friend' || info.kind === 'rate') {
    draft.dailyReward = { date: today, count: rewardedToday(draft, today) + 1 };
  }
  const used = ECONOMY.cpuDailyLimit - cpuRewardsLeft(draft, cycle);
  const added = addCoins(draft, r.coins);
  // CPU対戦は、本当にコインが増えた勝ちだけ数える（コインが上限で増えなかった時は数えない。v2.7）
  if (info.kind === 'cpu' && added > 0) draft.cpuReward = { cycleKey: cycle, count: used + 1 };
  return { coins: added, status: 'ok' };
}

/**
 * どの報酬になる試合か（リザルトで使う）。勝敗を記録しない試合（record が false：デバッグ対戦・カードを ためす・チュートリアル）、
 * デバッグのフレンド対戦、2人の結果がそろわなかったフレンド対戦（agree が true でない）は none
 */
export function rewardKindFor(setup: { mode: 'online' | 'cpu' | 'local' | 'spectate'; record: boolean; debug?: boolean; rated?: unknown }, agree: boolean | null): RewardKind {
  if (!setup.record || setup.debug) return 'none';
  if (setup.mode === 'online') return agree === true ? (setup.rated ? 'rate' : 'friend') : 'none';
  if (setup.mode === 'cpu') return 'cpu';
  return 'none';
}

/** デバッグ「ログボの日付を 1日 すすめる」：受け取った時刻を24時間前に・報酬の日を1日前にずらす（次の日になったのと同じ）。CPU対戦のコインの回数も0に */
export function debugNextDay(draft: Pick<SaveData, 'loginBonus' | 'dailyReward' | 'cpuReward'>): void {
  draft.cpuReward = { cycleKey: 0, count: 0 };
  draft.loginBonus.claimedAt = Math.max(0, draft.loginBonus.claimedAt - LOGIN_BONUS_MS);
  draft.dailyReward.date = prevDayKey(draft.dailyReward.date);
}
