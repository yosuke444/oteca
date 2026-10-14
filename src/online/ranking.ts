import { RANKING } from '../config/rating';
import { isUserId } from '../save/userId';
import { RANKING_UNSENT_MAX, type SaveData } from '../save/saveData';

/** 更新の時刻のこれだけ前より後の試合は、まだ数えられていないかもしれない（片方だけの報告の10分 ＋ 1分の余裕） */
const UNCOUNTED_MARGIN_MS = (RANKING.singleReportMinutes + 1) * 60 * 1000;

/**
 * ランキングと正式なレート（v2.0-I。UPDATE_v2 §10・SPEC §7 S15・S19・§11-9）。画面にも通信にも関係しない、ふつうの処理だけ。
 */

type RankingSave = Pick<SaveData, 'rate' | 'rateStats' | 'ranking'>;

/** 送れなかった結果の報告（セーブの ranking.unsent の1件） */
export type UnsentReport = { matchId: string; winner: string };

const HEX16 = /^[0-9a-f]{16}$/;

/** 報告 → セーブに入れる文字（「試合ID:勝った人の playerId か void」） */
export function encodeUnsent(r: UnsentReport): string {
  return `${r.matchId}:${r.winner}`;
}

/** セーブの文字 → 報告（形の変なものは null） */
export function decodeUnsent(s: string): UnsentReport | null {
  const [matchId, winner, ...rest] = s.split(':');
  // 勝った人はユーザーID（v2.0-J）
  if (rest.length || !HEX16.test(matchId ?? '') || !(winner === 'void' || isUserId(winner))) return null;
  return { matchId, winner };
}

/**
 * 試合の結果を送る前に、セーブの「送れなかった報告」に入れる（送れたら消す）。同じ試合は1つだけ。多すぎたら古いものから捨てる
 */
export function queueReport(draft: Pick<SaveData, 'ranking'>, r: UnsentReport): void {
  const s = encodeUnsent(r);
  const list = draft.ranking.unsent.filter((u) => decodeUnsent(u)?.matchId !== r.matchId);
  list.push(s);
  draft.ranking.unsent = list.slice(-RANKING_UNSENT_MAX);
}

/** 送れた（または、もう送っても意味がない）報告を消す */
export function removeReport(draft: Pick<SaveData, 'ranking'>, matchId: string): void {
  draft.ranking.unsent = draft.ranking.unsent.filter((u) => {
    const r = decodeUnsent(u);
    return r !== null && r.matchId !== matchId;
  });
}

/** 報告する勝者（自分の勝ち → 自分、負け → 相手、無効 → void） */
export function reportWinner(outcome: 'win' | 'lose' | 'void', myId: string, oppId: string): string {
  return outcome === 'void' ? 'void' : outcome === 'win' ? myId : oppId;
}

/** サーバーにある自分のデータ（GET /me・/ranking の me） */
export type ServerMe = {
  rate: number;
  wins: number;
  losses: number;
  best: number;
  rank: number | null;
  visible: boolean;
  name: string;
  optIn: boolean;
  /** 最後に数えた試合の試合ID（v2.0-J。'' ＝まだ） */
  lastMatch?: string;
};

/**
 * 正式なレートで上書きする（次の更新の後にゲームを開いた時。SPEC §7 S15）。
 * - updatedAt（最後の まとめ処理の時刻）より前に受け取っていた時だけ上書きする（1回の更新で1回）。
 * - サーバーで1試合も数えていない人は上書きしない（端末の「かり」のまま。数えられたら上書きされる）。
 * - まだ送れていない報告があれば、上書きした後も「かり」のまま。
 * - まとめ処理の少し前より後にレート対戦をしていたら上書きしない（その試合がまだ数えられていないかもしれないので。
 *   片方だけの報告は10分たってから記録されるので、更新の時刻の10分前（＋1分の余裕）より後の試合は、次の更新まで「かり」のまま）。
 * @returns 上書きした時 true
 */
export function applyServerRate(draft: RankingSave, me: ServerMe | null, updatedAt: number, now: number): boolean {
  if (!me || me.wins + me.losses === 0) return false;
  if (draft.ranking.syncedAt >= updatedAt) return false;
  // まとめ処理の少し前より後にも遊んでいる：サーバーの値にその試合が入っていないかもしれないので、上書きせず「かり」のまま
  // ただし、サーバーが最後に数えた試合が自分の最後の試合なら、もう数えられている（v2.0-J）
  const counted = !!draft.ranking.lastMatchId && me.lastMatch === draft.ranking.lastMatchId && draft.ranking.playedAt <= updatedAt;
  if (!counted && draft.ranking.playedAt > 0 && draft.ranking.playedAt > updatedAt - UNCOUNTED_MARGIN_MS) return false;
  draft.rate = me.rate;
  draft.rateStats = { wins: me.wins, losses: me.losses, best: me.best };
  draft.ranking.provisional = draft.ranking.unsent.length > 0;
  draft.ranking.syncedAt = now;
  return true;
}

/** 対戦の後：端末で計算したレートは「かり」。遊んだ時刻と試合ID を覚える */
export function markProvisional(draft: Pick<SaveData, 'ranking'>, now = Date.now(), matchId = ''): void {
  draft.ranking.provisional = true;
  draft.ranking.playedAt = now;
  draft.ranking.lastMatchId = matchId;
}

/** ランキングの一覧の1行（サーバーの写し） */
export type RankingRow = { rank: number; key: string; name: string; rate: number; wins: number; losses: number };

/** GET /ranking の答え */
/**
 * GET /ranking の答え。nextAt：次の更新の予定の時刻（サーバーの時刻）。updating：予定の時刻を過ぎたのに まだ更新されていない（v2.7）。
 * serverNow：答えた時のサーバーの時刻（端末の時計がずれていても、サーバーの時刻で数える）
 */
export type RankingData = { top: RankingRow[]; updatedAt: number; nextAt: number; me: ServerMe | null; updating?: boolean; serverNow?: number };

/** 「こうしん ちゅう…」の間、聞き直す間隔（v2.7） */
export const UPDATING_POLL_MS = 30 * 1000;

/**
 * 画面の「次の更新」（v2.7）：サーバーの時刻（受け取った時のずれを足す）で、次の更新の予定まで数える。
 * 予定の時刻を過ぎたのに新しいデータが無い間は「こうしん ちゅう」（時間を延ばして見せない）
 * @param receivedAt その答えを受け取った端末の時刻
 */
export function rankingClock(data: Pick<RankingData, 'nextAt' | 'updating' | 'serverNow'>, receivedAt: number, now: number): { kind: 'count'; text: string } | { kind: 'updating' } {
  const offset = Number.isFinite(data.serverNow) ? (data.serverNow as number) - receivedAt : 0;
  const serverNow = now + offset;
  if (data.updating || serverNow >= data.nextAt) return { kind: 'updating' };
  return { kind: 'count', text: countdown(data.nextAt, serverNow) };
}

/** 次の更新までの残り時間（時:分:秒。0 未満は 0） */
export function countdown(nextAt: number, now: number): string {
  const s = Math.max(0, Math.floor((nextAt - now) / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

/** 保存しておいた一覧を、そのまま使ってよいか（次の更新の時刻まで。SPEC S19） */
export function cacheFresh(cache: { nextAt: number; playerId: string } | null, playerId: string, now: number): boolean {
  return !!cache && cache.playerId === playerId && now < cache.nextAt;
}

