/**
 * 試合の結果の突き合わせ（UPDATE_v2 §10・SPEC §11-9）。ふつうの処理だけ。
 * - 2人の報告が一致した試合だけを記録する。食い違ったら記録しない。
 * - 片方だけの報告（相手の切断）は、10分たったらその人の申告どおりに記録する（無効の申告なら記録しない）。
 * - 受付係が組んでいない試合（予備の小部屋で組んだ試合）は、2人の報告がそろった時だけ記録する。
 */

/** 片方だけの報告を記録するまでの時間 */
export const SINGLE_REPORT_MS = 10 * 60 * 1000;
/** 受付係の知らない試合・報告の来ない試合を あきらめるまでの時間 */
export const MATCH_EXPIRE_MS = 24 * 60 * 60 * 1000;

/** 報告。winner は勝った人の playerId、無効なら 'void'（名前と載せる設定は /profile で別に送る） */
export type Report = { matchId: string; playerId: string; winner: string; at: number };
/** 受付係が組んだ試合 */
export type MatchInfo = { matchId: string; a: string; b: string; created: number };

/** 記録する1試合（known：受付係が組んだ試合。false は予備の待合所の試合） */
export type ResultRow = { matchId: string; a: string; b: string; winner: string; at: number; known?: boolean };

export type Decision = { kind: 'record'; row: ResultRow } | { kind: 'drop' } | { kind: 'wait' };

/** 報告を受け付けてよいか（受付係が組んだ試合は、その2人だけ。勝った人は2人のどちらかか void） */
export function acceptReport(match: MatchInfo | null, r: Report): boolean {
  if (r.winner !== 'void' && !/^[0-9a-f]{16}$/.test(r.winner)) return false;
  // 受付係の知らない試合（予備の小部屋）：2人そろった時に確かめる
  if (!match) return true;
  if (r.playerId !== match.a && r.playerId !== match.b) return false;
  return r.winner === 'void' || r.winner === match.a || r.winner === match.b;
}

function row(matchId: string, a: string, b: string, winner: string, at: number): ResultRow {
  return { matchId, a, b, winner, at };
}

/**
 * この試合の報告から、記録するか決める
 * @param match 受付係が組んだ試合（知らない試合は null）
 * @param reports この試合の報告（1人1つまで）
 */
export function decide(match: MatchInfo | null, reports: readonly Report[], now: number): Decision {
  if (reports.length === 0) {
    if (match && now - match.created >= MATCH_EXPIRE_MS) return { kind: 'drop' };
    return { kind: 'wait' };
  }
  if (reports.length >= 2) {
    const [x, y] = reports;
    if (x.playerId === y.playerId) return { kind: 'wait' };
    if (x.winner !== y.winner || x.winner === 'void') return { kind: 'drop' };
    // 受付係の知らない試合：勝った人は報告した2人のどちらか
    const a = match?.a ?? (x.playerId < y.playerId ? x.playerId : y.playerId);
    const b = match?.b ?? (a === x.playerId ? y.playerId : x.playerId);
    if (x.winner !== a && x.winner !== b) return { kind: 'drop' };
    return { kind: 'record', row: row(x.matchId, a, b, x.winner, Math.max(x.at, y.at)) };
  }
  // 片方だけ
  const r = reports[0];
  if (!match) return now - r.at >= MATCH_EXPIRE_MS ? { kind: 'drop' } : { kind: 'wait' };
  if (now - r.at < SINGLE_REPORT_MS) return { kind: 'wait' };
  if (r.winner === 'void') return { kind: 'drop' };
  return { kind: 'record', row: row(r.matchId, match.a, match.b, r.winner, r.at) };
}

/** 受け取った報告の中身を確かめる（形の変なものは null） */
export function cleanReport(x: unknown, now: number): Report | null {
  if (!x || typeof x !== 'object') return null;
  const o = x as Record<string, unknown>;
  const hex = (v: unknown, n: number) => typeof v === 'string' && new RegExp(`^[0-9a-f]{${n}}$`).test(v);
  if (!hex(o.matchId, 16) || !hex(o.playerId, 16)) return null;
  const winner = o.winner === 'void' ? 'void' : hex(o.winner, 16) ? (o.winner as string) : null;
  if (!winner) return null;
  return { matchId: o.matchId as string, playerId: o.playerId as string, winner, at: now };
}
