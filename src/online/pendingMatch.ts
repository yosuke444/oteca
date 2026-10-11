import type { Phase } from '../engine/types';
import type { SaveData } from '../save/saveData';
import { markProvisional, queueReport } from './ranking';
import { type RateChange, resolvePendingRate } from './rate';

/**
 * オンライン対戦で通信が切れた時の決まり（v2.4。SPEC §11-7）。画面にも通信にも関係しない、ふつうの処理だけ。
 * - 切れていない側：「まっています」から30秒で、残った側の勝ち。対戦が始まる前（準備中）なら勝ち負けを付けず待機画面へ
 * - 切れた側：対戦中の印（とちゅうの試合）をセーブに残しておき、次に開いた時に負けとして数える
 */

/** 対戦が始まったか（準備が終わった＝最初のおてあげを両者が決めた）。始まる前に切れた試合は勝ち負けを付けない */
export function matchBegun(phase: Phase | undefined): boolean {
  return !!phase && phase !== 'setup';
}

/**
 * 相手の通信が30秒もどらない・相手が部屋を出た時の扱い
 * - noGame：始まる前。勝ち負けを付けず待機画面へ
 * - win：残った側の勝ち
 * - selfCut：自分の端末がオフライン（切れたのは自分）。勝ちにしない（自分で切って勝つのを防ぐ）。この試合は負け
 */
export type CutOutcome = 'noGame' | 'win' | 'selfCut';

export function cutOutcome(x: { begun: boolean; online: boolean }): CutOutcome {
  if (!x.begun) return 'noGame';
  return x.online ? 'win' : 'selfCut';
}

type FriendSave = Pick<SaveData, 'pendingFriendMatch' | 'stats'>;

/** フレンド対戦が始まった：印を付ける（この後にページを閉じたら、次に開いた時に負け） */
export function startFriendMatch(draft: FriendSave, opponentId: string): void {
  draft.pendingFriendMatch = { opponentId };
}

/** フレンド対戦の画面を出た（決着・やめた・勝ち負けの付かない終わり方）：印を消す（勝敗は別に書く） */
export function clearFriendMatch(draft: FriendSave): void {
  draft.pendingFriendMatch = null;
}

/** フレンド対戦の印が残っていたら負けとして数える（勝敗の負け +1）。数えたら true */
export function resolvePendingFriend(draft: FriendSave): boolean {
  if (!draft.pendingFriendMatch) return false;
  draft.pendingFriendMatch = null;
  draft.stats.losses += 1;
  return true;
}

/** 起動した時に負けにした とちゅうの試合（メニューで1回だけ知らせる） */
export type PendingResult = { rate: RateChange | null; friend: boolean };

/**
 * 起動した時：とちゅうの試合（ページを閉じた・通信が切れたまま閉じた）を負けとして数える。
 * レート対戦は、受付係の試合ID があれば「相手の勝ち」を報告する（相手の報告と一致すれば数えられる。届かなくても相手の報告だけで10分後に数える）。
 * 始まる前のレート対戦は、勝ち負けを付けずに印だけ消す
 */
export function resolvePendingMatches(draft: SaveData, opts: { ranking: boolean; now: number }): PendingResult {
  const p = draft.pendingRateMatch;
  const rate = resolvePendingRate(draft);
  if (rate && p && opts.ranking && p.matchId) {
    markProvisional(draft, opts.now, p.matchId);
    queueReport(draft, { matchId: p.matchId, winner: p.opponentId });
  }
  const friend = resolvePendingFriend(draft);
  return { rate, friend };
}

/** 起動した時に とちゅうのフレンド対戦を負けにしたか（メニューで1回だけ知らせる） */
let friendNotice = false;

export function setFriendNotice(v: boolean): void {
  friendNotice = v;
}

export function peekFriendNotice(): boolean {
  return friendNotice;
}

export function clearFriendNotice(): void {
  friendNotice = false;
}
