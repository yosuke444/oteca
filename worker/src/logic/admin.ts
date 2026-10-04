import cardsJson from '../../../src/data/cards.json';
/**
 * 管理者メニュー（v2.0-J。SPEC §7 S20・§11-9）の決まり。Cloudflare に関係しない、ふつうの処理だけ（テストしやすいように）。
 */

/** 同じ接続元から、この回数まちがえたら入れなくする */
export const ADMIN_FAIL_LIMIT = 5;
/** 入れなくする時間 */
export const ADMIN_LOCK_MS = 60 * 60 * 1000;
/** 管理の合言葉が使える時間 */
export const ADMIN_SESSION_MS = 12 * 60 * 60 * 1000;
/** トロフィーの番号の範囲（cards.json の trophy.numberMax） */
export const TROPHY_NUMBER_MAX: number = cardsJson.trophy.numberMax;
/** 停止の期間（日。0 ＝ ずっと） */
export const SUSPEND_DAYS = [7, 30, 90, 0] as const;
/** 停止の理由の文字数 */
export const SUSPEND_REASON_MAX = 40;
/** 検索の1ページの件数 */
export const SEARCH_PAGE = 50;

const DAY_MS = 24 * 60 * 60 * 1000;

/** まちがえた数の記録 */
export type FailState = { count: number; lockedUntil: number };

/** 入れない間か */
export function isLocked(s: FailState | null, now: number): boolean {
  return !!s && s.lockedUntil > now;
}

/**
 * まちがえた時：数を足す。5回目で1時間入れなくし、数を0に戻す（1時間たったら、また5回まで）
 * @returns 次の記録と、あと何回まちがえられるか
 */
export function afterFail(s: FailState | null, now: number): { next: FailState; left: number; locked: boolean } {
  const base = s && s.lockedUntil <= now ? { count: s.lockedUntil > 0 ? 0 : s.count, lockedUntil: 0 } : (s ?? { count: 0, lockedUntil: 0 });
  const count = base.count + 1;
  if (count >= ADMIN_FAIL_LIMIT) return { next: { count: 0, lockedUntil: now + ADMIN_LOCK_MS }, left: 0, locked: true };
  return { next: { count, lockedUntil: 0 }, left: ADMIN_FAIL_LIMIT - count, locked: false };
}

/** 停止の終わりの時刻（days が 0 なら 0 ＝ ずっと）。決まった期間でなければ null */
export function suspendUntil(days: unknown, now: number): number | null {
  if (!SUSPEND_DAYS.includes(days as (typeof SUSPEND_DAYS)[number])) return null;
  return days === 0 ? 0 : now + (days as number) * DAY_MS;
}

/** 停止中か（until：0 ＝ ずっと。null ＝ 停止していない） */
export function isSuspended(until: number | null | undefined, now: number): boolean {
  if (until === null || until === undefined) return false;
  return until === 0 || until > now;
}

/** トロフィーの番号として正しいか（1〜9999 の整数） */
export function isTrophyNumber(v: unknown): v is number {
  return Number.isInteger(v) && (v as number) >= 1 && (v as number) <= TROPHY_NUMBER_MAX;
}

/** 検索の条件（画面から届いたもの） */
export type SearchQuery = {
  name?: string;
  id?: string;
  rateMin?: number;
  rateMax?: number;
  /** 最後に遊んだ日の範囲（ミリ秒） */
  seenFrom?: number;
  seenTo?: number;
  trophy?: 'any' | 'yes' | 'no';
  suspended?: 'any' | 'yes' | 'no';
  page?: number;
};

/** LIKE の特別な文字を消す（部分一致にだけ使う） */
function likeText(s: string): string {
  return s.replace(/[%_\\]/g, '');
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : null);

/**
 * 検索の SQL（WHERE と並べ方）を作る。ユーザーID の行だけ（今までの playerId のままの行は出さない）。
 * @returns sql（SELECT の後ろ全部）と、当てはめる値
 */
export function searchSql(q: SearchQuery, now: number): { sql: string; binds: unknown[]; page: number } {
  const where: string[] = [`length(p.id) = 15 AND p.id GLOB '[1-9]*'`];
  const binds: unknown[] = [now];
  const name = typeof q.name === 'string' ? likeText(q.name.trim()).slice(0, 8) : '';
  if (name) {
    where.push(`p.name LIKE ?`);
    binds.push(`%${name}%`);
  }
  const id = typeof q.id === 'string' ? q.id.normalize('NFKC').replace(/[^0-9]/g, '').slice(0, 15) : '';
  if (id) {
    where.push(`p.id LIKE ?`);
    binds.push(`%${id}%`);
  }
  const rateMin = num(q.rateMin);
  const rateMax = num(q.rateMax);
  if (rateMin !== null) {
    where.push(`p.rate >= ?`);
    binds.push(rateMin);
  }
  if (rateMax !== null) {
    where.push(`p.rate <= ?`);
    binds.push(rateMax);
  }
  const seenFrom = num(q.seenFrom);
  const seenTo = num(q.seenTo);
  if (seenFrom !== null) {
    where.push(`p.last_seen >= ?`);
    binds.push(seenFrom);
  }
  if (seenTo !== null) {
    where.push(`p.last_seen <= ?`);
    binds.push(seenTo);
  }
  if (q.trophy === 'yes') where.push(`trophies > 0`);
  if (q.trophy === 'no') where.push(`trophies = 0`);
  if (q.suspended === 'yes') where.push(`s.user_id IS NOT NULL`);
  if (q.suspended === 'no') where.push(`s.user_id IS NULL`);
  const page = Math.max(0, Math.min(1000, num(q.page) ?? 0));
  const sql = `p.id AS id, p.name AS name, p.rate AS rate, p.wins AS wins, p.losses AS losses, p.last_seen AS last_seen,
      (SELECT COUNT(*) FROM trophies t WHERE t.user_id = p.id) AS trophies, s.until AS suspended_until
    FROM players p LEFT JOIN suspensions s ON s.user_id = p.id AND (s.until = 0 OR s.until > ?)
    WHERE ${where.join(' AND ')}
    ORDER BY p.last_seen DESC, p.id
    LIMIT ${SEARCH_PAGE + 1} OFFSET ${page * SEARCH_PAGE}`;
  return { sql, binds, page };
}

/** 日本時間のその日の0時（「最後に遊んだ日」を1日1回だけ書くため） */
export function jstDayStart(ms: number): number {
  const JST = 9 * 60 * 60 * 1000;
  return Math.floor((ms + JST) / DAY_MS) * DAY_MS - JST;
}

/**
 * まちがいを数える単位（接続元）。IPv4 はそのまま、IPv6 は前の64ビット（/64）にまとめる
 * （1つの回線でアドレスを変えながら試せないように）
 */
export function ipGroup(ip: string): string {
  if (!ip.includes(':')) return ip;
  const [head, tail] = ip.toLowerCase().split('::');
  const a = head ? head.split(':') : [];
  const b = tail !== undefined && tail ? tail.split(':') : [];
  const full = tail === undefined ? a : [...a, ...Array(Math.max(0, 8 - a.length - b.length)).fill('0'), ...b];
  return `${full
    .slice(0, 4)
    .map((g) => (parseInt(g, 16) || 0).toString(16))
    .join(':')}::/64`;
}
