import { nextRate } from '../../../src/online/rateMath';
import { RANKING, RATING } from '../../../src/config/rating';
import type { ResultRow } from './results';

/**
 * まとめ処理（毎日 日本時間 4:00。UPDATE_v2 §10・SPEC §11-9）の計算。ふつうの処理だけ。
 * 1. 試合結果を時刻順に読み、§8-4 の式でレートを計算する（2人とも、試合の前のレートで計算）。
 * 2. 同じ2人の組み合わせは、1日（日本時間 4:00 で区切る）に3試合までしか数えない。予備の待合所の試合は1人1日10試合まで。
 * 3. 数えた試合のある人は「最後に遊んだ時刻」を、まとめ処理の時刻にする（7日以上たつと表示から外れる）。
 * 名前・載せる設定は /register・/profile で D1 に直接書く（ここでは変えない）。
 */

/** 同じ2人が1日に数えられる試合の数 */
export const PAIR_DAILY_LIMIT = RANKING.pairDailyLimit;
/** 予備の待合所の試合（受付係の知らない試合）を、1人が1日に数えられる数（試合をしなくても報告を合わせれば作れてしまうので） */
export const FALLBACK_DAILY_LIMIT = RANKING.fallbackDailyLimit;
/** これだけレートが変わっていない（遊んでいない）人は、ランキングの表示から外す */
export const HIDE_AFTER_MS = RANKING.hideAfterDays * 24 * 60 * 60 * 1000;
/** 日本時間 = UTC + 9時間 */
const JST_MS = 9 * 60 * 60 * 1000;
/** まとめ処理の時刻（日本時間の時） */
export const BATCH_HOUR_JST = RANKING.batchHourJst;

export type Player = {
  id: string;
  rate: number;
  wins: number;
  losses: number;
  best: number;
  /** 最後に数えた試合のあった まとめ処理の時刻（0＝まだ） */
  lastPlayed: number;
};

export type BatchResult = {
  /** 変わった人（D1 に書く） */
  changed: Player[];
  /** 数えた試合 */
  counted: number;
  /** 1日3試合を超えて数えなかった試合 */
  skipped: number;
};

/** 新しく出てきた人（登録はあるはずだが、念のため） */
export function newPlayer(id: string): Player {
  return { id, rate: RATING.initial, wins: 0, losses: 0, best: RATING.initial, lastPlayed: 0 };
}

/** 日本時間の日付（YYYYMMDD） */
export function jstDay(ms: number): number {
  const d = new Date(ms + JST_MS);
  return d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate();
}

/** 「1日」の区切り（日本時間 4:00。まとめ処理と同じ区切りで、1回の まとめ処理が1日分になる） */
export function batchDay(ms: number): number {
  return jstDay(ms - BATCH_HOUR_JST * 60 * 60 * 1000);
}

/** 次のまとめ処理（日本時間 4:00）の時刻 */
export function nextBatchAt(now: number): number {
  const d = new Date(now + JST_MS);
  let t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), BATCH_HOUR_JST) - JST_MS;
  if (t <= now) t += 24 * 60 * 60 * 1000;
  return t;
}

/** 前のまとめ処理（日本時間 4:00）の時刻 */
export function lastBatchAt(now: number): number {
  return nextBatchAt(now) - 24 * 60 * 60 * 1000;
}

/**
 * レートを計算する
 * @param players 試合に出てきた人の今のデータ（無い人は新しく作る）
 * @param results 試合結果（並びは問わない。時刻順に並べ直す）
 * @param now まとめ処理の時刻
 */
export function runBatch(players: ReadonlyMap<string, Player>, results: readonly ResultRow[], now: number): BatchResult {
  const cur = new Map<string, Player>();
  const get = (id: string) => {
    let p = cur.get(id);
    if (!p) {
      const base = players.get(id);
      p = base ? { ...base } : newPlayer(id);
      cur.set(id, p);
    }
    return p;
  };
  // 時刻順（同じ時刻なら試合ID の順。何度計算しても同じ順になるように）
  const sorted = [...results].sort((x, y) => x.at - y.at || (x.matchId < y.matchId ? -1 : x.matchId > y.matchId ? 1 : 0));
  const pairCount = new Map<string, number>();
  const fallbackCount = new Map<string, number>();
  const changed = new Set<string>();
  let counted = 0;
  let skipped = 0;
  for (const r of sorted) {
    const day = batchDay(r.at);
    const key = `${day}:${r.a < r.b ? `${r.a}-${r.b}` : `${r.b}-${r.a}`}`;
    const n = pairCount.get(key) ?? 0;
    const fa = `${day}:${r.a}`;
    const fb = `${day}:${r.b}`;
    const fallback = r.known === false;
    if (n >= PAIR_DAILY_LIMIT || (fallback && Math.max(fallbackCount.get(fa) ?? 0, fallbackCount.get(fb) ?? 0) >= FALLBACK_DAILY_LIMIT)) {
      skipped += 1;
      continue;
    }
    pairCount.set(key, n + 1);
    if (fallback) {
      fallbackCount.set(fa, (fallbackCount.get(fa) ?? 0) + 1);
      fallbackCount.set(fb, (fallbackCount.get(fb) ?? 0) + 1);
    }
    const pa = get(r.a);
    const pb = get(r.b);
    const aWin = r.winner === r.a;
    const ra = pa.rate;
    const rb = pb.rate;
    pa.rate = nextRate(ra, rb, aWin);
    pb.rate = nextRate(rb, ra, !aWin);
    for (const [p, win] of [
      [pa, aWin],
      [pb, !aWin],
    ] as const) {
      if (win) p.wins += 1;
      else p.losses += 1;
      p.best = Math.max(p.best, p.rate);
      p.lastPlayed = now;
      changed.add(p.id);
    }
    counted += 1;
  }
  return { changed: [...changed].map((id) => cur.get(id)!), counted, skipped };
}

/** ランキングに表示するか（7日以上遊んでいない人は外す。データは残す） */
export function isVisible(p: Pick<Player, 'lastPlayed'>, now: number): boolean {
  return p.lastPlayed > 0 && now - p.lastPlayed < HIDE_AFTER_MS;
}
