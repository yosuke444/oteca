import { nextRate } from '../../../src/online/rateMath';
import { RANKING, RATING } from '../../../src/config/rating';
import { jstDay } from '../../../src/online/batchTime';

export { jstDay, lastBatchAt, nextBatchAt } from '../../../src/online/batchTime';
import type { ResultRow } from './results';

/**
 * まとめ処理（毎日 日本時間 4:00 と 16:00。UPDATE_v2 §10・SPEC §11-9）の計算。ふつうの処理だけ。
 * 1. 試合結果を時刻順に読み、§8-4 の式でレートを計算する（2人とも、試合の前のレートで計算）。
 * 2. 同じ2人の組み合わせは、1日（日本時間 0:00〜24:00。試合の時刻で）に3試合までしか数えない。予備の待合所の試合は1人1日10試合まで。
 *    1日2回の まとめ処理をまたいでも数えられるように、その日に数えた数（counts）を受け取り、足した数を返す。
 * 3. 数えた試合のある人は「最後に遊んだ時刻」を、まとめ処理の時刻にする（7日以上たつと表示から外れる）。
 * 名前・載せる設定は /register・/profile で D1 に直接書く（ここでは変えない）。
 */

/** 同じ2人が1日に数えられる試合の数 */
export const PAIR_DAILY_LIMIT = RANKING.pairDailyLimit;
/** 予備の待合所の試合（受付係の知らない試合）を、1人が1日に数えられる数（試合をしなくても報告を合わせれば作れてしまうので） */
export const FALLBACK_DAILY_LIMIT = RANKING.fallbackDailyLimit;
/** これだけレートが変わっていない（遊んでいない）人は、ランキングの表示から外す */
export const HIDE_AFTER_MS = RANKING.hideAfterDays * 24 * 60 * 60 * 1000;

export type Player = {
  id: string;
  rate: number;
  wins: number;
  losses: number;
  best: number;
  /** 最後に数えた試合のあった まとめ処理の時刻（0＝まだ） */
  lastPlayed: number;
  /** 最後に数えた試合の試合ID（v2.0-J。端末が「自分の最後の試合が数えられたか」を比べる。'' ＝まだ） */
  lastMatch?: string;
};

export type BatchResult = {
  /** 変わった人（D1 に書く） */
  changed: Player[];
  /** 数えた試合 */
  counted: number;
  /** 1日3試合を超えて数えなかった試合 */
  skipped: number;
  /** その日に数えた数（受け取った counts に足したもの。次の まとめ処理に渡す） */
  counts: Map<string, number>;
};

/** その日に数えた数の名前：同じ2人（日付:p:小さい方-大きい方）・予備の試合（日付:f:人） */
export const pairKey = (day: number, a: string, b: string) => `${day}:p:${a < b ? `${a}-${b}` : `${b}-${a}`}`;
export const fallbackKey = (day: number, id: string) => `${day}:f:${id}`;

/** 新しく出てきた人（登録はあるはずだが、念のため） */
export function newPlayer(id: string): Player {
  return { id, rate: RATING.initial, wins: 0, losses: 0, best: RATING.initial, lastPlayed: 0 };
}


/**
 * レートを計算する
 * @param players 試合に出てきた人の今のデータ（無い人は新しく作る）
 * @param results 試合結果（並びは問わない。時刻順に並べ直す）
 * @param now まとめ処理の時刻
 * @param counts その日に、前の まとめ処理で数えた数（pairKey・fallbackKey。書き換えない）
 */
export function runBatch(players: ReadonlyMap<string, Player>, results: readonly ResultRow[], now: number, counts: ReadonlyMap<string, number> = new Map()): BatchResult {
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
  const n = new Map(counts);
  const get0 = (k: string) => n.get(k) ?? 0;
  const changed = new Set<string>();
  let counted = 0;
  let skipped = 0;
  for (const r of sorted) {
    const day = jstDay(r.at);
    const key = pairKey(day, r.a, r.b);
    const fa = fallbackKey(day, r.a);
    const fb = fallbackKey(day, r.b);
    const fallback = r.known === false;
    if (get0(key) >= PAIR_DAILY_LIMIT || (fallback && Math.max(get0(fa), get0(fb)) >= FALLBACK_DAILY_LIMIT)) {
      skipped += 1;
      continue;
    }
    n.set(key, get0(key) + 1);
    if (fallback) {
      n.set(fa, get0(fa) + 1);
      n.set(fb, get0(fb) + 1);
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
      p.lastMatch = r.matchId;
      changed.add(p.id);
    }
    counted += 1;
  }
  return { changed: [...changed].map((id) => cur.get(id)!), counted, skipped, counts: n };
}

/** ランキングに表示するか（7日以上遊んでいない人は外す。データは残す） */
export function isVisible(p: Pick<Player, 'lastPlayed'>, now: number): boolean {
  return p.lastPlayed > 0 && now - p.lastPlayed < HIDE_AFTER_MS;
}
