import { apiBase } from '../config/api';
import { isUserId } from '../save/userId';

/**
 * アカウント停止の確かめ（v2.0-J。SPEC §7 S20）。
 * 自分（起動した時・オンラインに入る時。毎回サーバーに聞く）と、対戦相手・トレード相手（始める時。結果は10分覚えておく）。
 * サーバーにつながらない時は「停止していない」として遊べる（つながらない人を締め出さないため）。
 */

/** 結果を覚えておく時間 */
export const STATUS_CACHE_MS = 10 * 60 * 1000;
const TIMEOUT_MS = 4000;

/** ユーザーID → { until：停止の終わり（0 ＝ずっと、null ＝停止していない）、at：確かめた時刻 } */
const cache = new Map<string, { until: number | null; at: number }>();

/** テスト用：覚えた結果を忘れる */
export function forgetStatus(): void {
  cache.clear();
}

/**
 * 停止中のユーザーID と、停止の終わり（0 ＝ずっと）
 * @param now 今（テストで差し替える）
 * @param fresh 覚えた結果を使わずに聞く（自分の確かめ）
 */
export async function checkSuspended(ids: string[], now = Date.now(), fresh = false): Promise<Record<string, number>> {
  const want = [...new Set(ids.filter(isUserId))];
  const out: Record<string, number> = {};
  const ask: string[] = [];
  for (const id of want) {
    const c = cache.get(id);
    if (c && !fresh && now - c.at < STATUS_CACHE_MS) {
      if (c.until !== null && (c.until === 0 || c.until > now)) out[id] = c.until;
    } else ask.push(id);
  }
  const base = apiBase();
  if (!ask.length || !base) return out;
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${base}/status?ids=${ask.join(',')}`, { signal: ctl.signal });
    if (!res.ok) return out;
    const body = (await res.json().catch(() => null)) as { suspended?: Record<string, number> } | null;
    const sus = body?.suspended ?? {};
    for (const id of ask) {
      const until = typeof sus[id] === 'number' ? sus[id] : null;
      cache.set(id, { until, at: now });
      if (until !== null) out[id] = until;
    }
  } catch {
    // つながらない：確かめずに遊べる（覚えない）
  } finally {
    clearTimeout(t);
  }
  return out;
}

/** その人の停止の終わり（停止していなければ null）。fresh：覚えた結果を使わない（自分の確かめ） */
export async function suspendedUntilOf(userId: string, fresh = false): Promise<number | null> {
  const r = await checkSuspended([userId], Date.now(), fresh);
  return userId in r ? r[userId] : null;
}

/** 対戦・トレードの相手が遊んでよいか（停止中でなければ true。ユーザーID の無い古い版の相手・つながらない時も true） */
export async function opponentAllowed(userId: string | undefined): Promise<boolean> {
  if (!userId || !isUserId(userId)) return true;
  return (await suspendedUntilOf(userId)) === null;
}
