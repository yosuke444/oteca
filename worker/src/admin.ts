import { isUserId } from '../../src/save/userId';
import {
  ADMIN_SESSION_MS,
  SUSPEND_REASON_MAX,
  SEARCH_PAGE,
  type FailState,
  type SearchQuery,
  ADMIN_FAIL_LIMIT,
  ADMIN_LOCK_MS,
  ipGroup,
  isLocked,
  isSuspended,
  isTrophyNumber,
  jstDayStart,
  searchSql,
  suspendUntil,
} from './logic/admin';
import { type Db, writeSnapshot } from './ranking';
import { GIFT_BATCH_MAX, assignTrophyNumbers, giftCount, giftKindOf, parseUserIds } from './logic/gift';
import { TROPHY_NUMBER_MAX } from './logic/admin';
import { randomHex, sameText, sha256Hex } from './util';

/**
 * 管理者メニュー（v2.0-J。SPEC §7 S20・§11-9）と、郵便受け・停止の確かめ（端末から）
 * パスワードは管理キー（wrangler secret の ADMIN_KEY）。ゲームのプログラムと git には書かない。
 */

type Json = (body: unknown, status?: number) => Response;

/** 接続元（Cloudflare が付ける。手元の wrangler dev では無いことがある）。IPv6 は /64 にまとめる（アドレスを変えながら試せないように） */
export function clientIp(req: Request): string {
  return ipGroup(req.headers.get('CF-Connecting-IP') ?? req.headers.get('x-real-ip') ?? 'local');
}

async function failState(c: Db, ip: string): Promise<FailState | null> {
  const r = (await c.all<{ count: number; locked_until: number }>(`SELECT count, locked_until FROM admin_fails WHERE ip = ?`, ip))[0];
  return r ? { count: Number(r.count), lockedUntil: Number(r.locked_until) } : null;
}

/**
 * まちがえた時：数を足す（5回で1時間入れない）。決まりは logic/admin.ts の afterFail と同じ。
 * 同時に何本も送られても数えもらさないように、読んで足して書くのを1つの SQL で行う
 */
async function recordFail(c: Db, ip: string, now: number): Promise<{ left: number; locked: boolean; until: number; justLocked: boolean }> {
  // 前の数（1時間たって解けたロックは0から）
  const prev = `(CASE WHEN admin_fails.locked_until > 0 THEN 0 ELSE admin_fails.count END)`;
  const lockAt = now + ADMIN_LOCK_MS;
  const r = (
    await c.all<{ count: number; locked_until: number }>(
      `INSERT INTO admin_fails (ip, count, locked_until) VALUES (?, 1, 0) ON CONFLICT(ip) DO UPDATE SET
        count = CASE WHEN admin_fails.locked_until > ? THEN admin_fails.count WHEN ${prev} + 1 >= ? THEN 0 ELSE ${prev} + 1 END,
        locked_until = CASE WHEN admin_fails.locked_until > ? THEN admin_fails.locked_until WHEN ${prev} + 1 >= ? THEN ? ELSE 0 END
      RETURNING count, locked_until`,
      ip,
      now,
      ADMIN_FAIL_LIMIT,
      now,
      ADMIN_FAIL_LIMIT,
      lockAt,
    )
  )[0];
  const until = Number(r?.locked_until ?? 0);
  const locked = until > now;
  return { left: locked ? 0 : ADMIN_FAIL_LIMIT - Number(r?.count ?? 0), locked, until, justLocked: until === lockAt };
}

/** 管理者の操作の記録をまとめて1回で書く（v2.7。まとめ贈り） */
export async function adminLogMany(c: Db, now: number, list: { action: string; target: string; detail: unknown }[]): Promise<void> {
  if (!list.length) return;
  await c.run(
    `INSERT INTO admin_log (at, action, target, detail) SELECT ?, json_extract(value, '$.a'), json_extract(value, '$.t'), json_extract(value, '$.d') FROM json_each(?) ORDER BY key`,
    now,
    JSON.stringify(list.map((x) => ({ a: x.action, t: x.target, d: JSON.stringify(x.detail) }))),
  );
}

/** 管理者の操作の記録 */
export async function adminLog(c: Db, now: number, action: string, target: string, detail: unknown = ''): Promise<void> {
  await c.run(`INSERT INTO admin_log (at, action, target, detail) VALUES (?, ?, ?, ?)`, now, action, target, typeof detail === 'string' ? detail : JSON.stringify(detail));
}

/**
 * 管理者か確かめる（管理キー x-admin-key か、管理の合言葉 x-admin-session）。
 * 管理の合言葉で通すのは、管理者メニューの道（ADMIN_MENU_PATHS）だけ。前からある強い道（プレイヤーを消す など）は管理キーだけ
 * 入れない間は 423、まちがいは 401（管理キーのまちがいも数える）
 * @returns null なら通ってよい。Response なら、それを返す
 */
export async function checkAdmin(req: Request, c: Db, key: string | undefined, now: number, json: Json, allowSession: boolean): Promise<Response | null> {
  const ip = clientIp(req);
  const st = await failState(c, ip);
  if (isLocked(st, now)) return json({ error: 'locked', until: st!.lockedUntil }, 423);
  const given = req.headers.get('x-admin-key');
  if (given !== null) {
    if (key && sameText(given, key)) return null;
    const f = await recordFail(c, ip, now);
    return json({ error: 'auth', left: f.left, ...(f.locked ? { until: f.until } : {}) }, f.locked ? 423 : 401);
  }
  const session = req.headers.get('x-admin-session');
  if (allowSession && session && /^[0-9a-f]{64}$/.test(session)) {
    const r = (await c.all<{ expires: number }>(`SELECT expires FROM admin_sessions WHERE token_hash = ?`, await sha256Hex(session)))[0];
    if (r && Number(r.expires) > now) return null;
  }
  return json({ error: 'auth' }, 401);
}

/** POST /admin-login：パスワード（管理キー）→ 管理の合言葉 */
export async function adminLogin(req: Request, c: Db, key: string | undefined, now: number, json: Json): Promise<Response> {
  const ip = clientIp(req);
  const st = await failState(c, ip);
  if (isLocked(st, now)) return json({ error: 'locked', until: st!.lockedUntil }, 423);
  const b = (await req.json().catch(() => null)) as { password?: unknown } | null;
  const password = typeof b?.password === 'string' ? b.password.trim() : '';
  if (!key || !password || !sameText(password, key)) {
    const f = await recordFail(c, ip, now);
    if (f.justLocked) await adminLog(c, now, 'lock', ip, '');
    return json({ error: 'auth', left: f.left, ...(f.locked ? { until: f.until } : {}) }, f.locked ? 423 : 401);
  }
  await c.run(`DELETE FROM admin_fails WHERE ip = ?`, ip);
  const session = randomHex(32);
  const expires = now + ADMIN_SESSION_MS;
  await c.run(`DELETE FROM admin_sessions WHERE expires <= ?`, now);
  await c.run(`INSERT INTO admin_sessions (token_hash, expires) VALUES (?, ?)`, await sha256Hex(session), expires);
  await adminLog(c, now, 'login', ip, '');
  return json({ session, expires });
}

type PlayerBrief = { id: string; name: string; rate: number; wins: number; losses: number };

async function findPlayer(c: Db, id: string): Promise<PlayerBrief | null> {
  return (await c.all<PlayerBrief>(`SELECT id, name, rate, wins, losses FROM players WHERE id = ?`, id))[0] ?? null;
}

/** まとめて贈る相手を確かめる（v2.7）：見つかった人・見つからないID・停止中の人・形の正しくないもの */
export type CheckedUsers = { users: { id: string; name: string; rate: number }[]; missing: string[]; suspended: { id: string; until: number }[]; bad: string[]; tooMany: boolean };

async function checkUsers(c: Db, input: unknown, now: number): Promise<CheckedUsers> {
  const { ids: all, bad } = parseUserIds(input);
  const ids = all.slice(0, GIFT_BATCH_MAX);
  const found = ids.length ? await c.all<{ id: string; name: string; rate: number }>(`SELECT id, name, rate FROM players WHERE id IN (SELECT value FROM json_each(?))`, JSON.stringify(ids)) : [];
  const sus = ids.length ? await c.all<{ user_id: string; until: number }>(`SELECT user_id, until FROM suspensions WHERE user_id IN (SELECT value FROM json_each(?))`, JSON.stringify(ids)) : [];
  const stopped = new Map(sus.filter((r) => isSuspended(Number(r.until), now)).map((r) => [r.user_id, Number(r.until)]));
  const byId = new Map(found.map((p) => [p.id, p]));
  return {
    // 入れた順に。停止中の人は贈らない
    users: ids.filter((id) => byId.has(id) && !stopped.has(id)).map((id) => byId.get(id)!),
    missing: ids.filter((id) => !byId.has(id)),
    suspended: ids.filter((id) => byId.has(id) && stopped.has(id)).map((id) => ({ id, until: stopped.get(id)! })),
    bad,
    tooMany: all.length > GIFT_BATCH_MAX,
  };
}

/** 管理者メニューの道（管理の合言葉でも使える） */
export const ADMIN_MENU_PATHS = new Set(['/admin/user', '/admin/trophy', '/admin/trophy-batch', '/admin/gift', '/admin/check-users', '/admin/suspend', '/admin/unsuspend', '/admin/search', '/admin/log', '/admin/watch', '/admin/logout', '/admin/run-batch', '/admin/stats', '/admin/card-stats']);

/** 管理者メニューの道（checkAdmin を通った後） */
export async function adminRoute(p: string, b: Record<string, unknown>, c: Db, now: number, json: Json): Promise<Response | null> {
  switch (p) {
    case '/admin/user': {
      // 相手の名前とレート（トロフィー・停止の確認に出す）
      if (!isUserId(b.userId)) return json({ error: 'bad' }, 400);
      const pl = await findPlayer(c, b.userId);
      if (!pl) return json({ error: 'no-user' }, 404);
      const s = (await c.all<{ until: number }>(`SELECT until FROM suspensions WHERE user_id = ?`, b.userId))[0];
      return json({ user: pl, suspendedUntil: s && isSuspended(Number(s.until), now) ? Number(s.until) : null });
    }
    case '/admin/trophy': {
      if (!isUserId(b.userId) || !isTrophyNumber(b.number)) return json({ error: 'bad' }, 400);
      if (!(await findPlayer(c, b.userId))) return json({ error: 'no-user' }, 404);
      const r = await c.run(`INSERT INTO trophies (number, user_id, created) VALUES (?, ?, ?) ON CONFLICT(number) DO NOTHING`, b.number, b.userId, now);
      if (!r.meta.changes) return json({ error: 'used' }, 409);
      // その人に渡した枚数（v2.7。かんりログに残す）
      const total = (await c.all<{ n: number }>(`SELECT COUNT(*) AS n FROM trophies WHERE user_id = ?`, b.userId))[0]?.n ?? 1;
      await adminLog(c, now, 'trophy', b.userId, { number: b.number, total });
      return json({ ok: true });
    }
    case '/admin/check-users': {
      // まとめて贈る前の確かめ（v2.7）：見つからないID・停止中の人を知らせる
      return json(await checkUsers(c, b.userIds, now));
    }
    case '/admin/gift': {
      // 贈り物をまとめて贈る（v2.7。大会パックなど）。見つからないID・停止中の人は飛ばす
      const kind = giftKindOf(b.kind);
      const count = kind ? giftCount(kind, b.count) : null;
      if (!kind || count === null) return json({ error: 'bad' }, 400);
      const chk = await checkUsers(c, b.userIds, now);
      if (chk.tooMany) return json({ error: 'too-many' }, 400);
      // 何人でも SQL は決まった回数（無料プランの1回の問い合わせの上限に収める）：まとめて入れて、まとめて記録する
      const ids = chk.users.map((u) => u.id);
      const rows = ids.length
        ? await c.all<{ id: number; user_id: string }>(
            `INSERT INTO gifts (user_id, kind, count, created) SELECT value, ?, ?, ? FROM json_each(?) ORDER BY key RETURNING id, user_id`,
            kind.id,
            count,
            now,
            JSON.stringify(ids),
          )
        : [];
      const giftOf = new Map(rows.map((r) => [r.user_id, Number(r.id)]));
      const sent = ids.filter((id) => giftOf.has(id)).map((id) => ({ id, giftId: giftOf.get(id)! }));
      await adminLogMany(
        c,
        now,
        sent.map((x) => ({ action: 'gift', target: x.id, detail: { kind: kind.id, count, giftId: x.giftId } })),
      );
      return json({ ok: true, sent, missing: chk.missing, suspended: chk.suspended, bad: chk.bad });
    }
    case '/admin/trophy-batch': {
      // トロフィあげをまとめて贈る（v2.7）：番号は start から順に、空いている番号を配る
      const start = Number.isInteger(b.start) ? (b.start as number) : 0;
      if (!isTrophyNumber(start)) return json({ error: 'bad' }, 400);
      const chk = await checkUsers(c, b.userIds, now);
      if (chk.tooMany) return json({ error: 'too-many' }, 400);
      const used = new Set((await c.all<{ number: number }>(`SELECT number FROM trophies WHERE number >= ?`, start)).map((r) => Number(r.number)));
      const numbers = assignTrophyNumbers(chk.users.length, start, used, TROPHY_NUMBER_MAX);
      // 何人でも SQL は決まった回数：まとめて入れ（同時に使われた番号は入らない）、枚数をまとめて数え、まとめて記録する
      const plan = chk.users.map((u, i) => ({ u: u.id, n: numbers[i] })).filter((x): x is { u: string; n: number } => x.n !== null);
      const got = plan.length
        ? await c.all<{ number: number; user_id: string }>(
            `INSERT INTO trophies (number, user_id, created) SELECT json_extract(value, '$.n'), json_extract(value, '$.u'), ? FROM json_each(?) WHERE true ON CONFLICT(number) DO NOTHING RETURNING number, user_id`,
            now,
            JSON.stringify(plan),
          )
        : [];
      const numberOf = new Map(got.map((r) => [r.user_id, Number(r.number)]));
      const sent = chk.users.filter((u) => numberOf.has(u.id)).map((u) => ({ id: u.id, number: numberOf.get(u.id)! }));
      const noNumber = chk.users.filter((u) => !numberOf.has(u.id)).map((u) => u.id);
      const totals = sent.length
        ? new Map(
            (await c.all<{ user_id: string; n: number }>(`SELECT user_id, COUNT(*) AS n FROM trophies WHERE user_id IN (SELECT value FROM json_each(?)) GROUP BY user_id`, JSON.stringify(sent.map((x) => x.id)))).map((r) => [r.user_id, Number(r.n)]),
          )
        : new Map<string, number>();
      await adminLogMany(
        c,
        now,
        sent.map((x) => ({ action: 'trophy', target: x.id, detail: { number: x.number, total: totals.get(x.id) ?? 1 } })),
      );
      return json({ ok: true, sent, missing: chk.missing, suspended: chk.suspended, bad: chk.bad, noNumber });
    }
    case '/admin/suspend': {
      if (!isUserId(b.userId)) return json({ error: 'bad' }, 400);
      const until = suspendUntil(b.days, now);
      if (until === null) return json({ error: 'bad' }, 400);
      if (!(await findPlayer(c, b.userId))) return json({ error: 'no-user' }, 404);
      const reason = typeof b.reason === 'string' ? [...b.reason.trim()].slice(0, SUSPEND_REASON_MAX).join('') : '';
      await c.run(
        `INSERT INTO suspensions (user_id, until, reason, created) VALUES (?, ?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET until = excluded.until, reason = excluded.reason, created = excluded.created`,
        b.userId,
        until,
        reason,
        now,
      );
      // ランキングからすぐ外す（公開の一覧もすぐ作り直す。ほかの人の順位は次の まとめ処理で数え直す）
      await c.run(`UPDATE players SET rank = NULL WHERE id = ?`, b.userId);
      await writeSnapshot(c, null);
      await adminLog(c, now, 'suspend', b.userId, { days: b.days, until, reason });
      return json({ ok: true, until });
    }
    case '/admin/unsuspend': {
      if (!isUserId(b.userId)) return json({ error: 'bad' }, 400);
      const r = await c.run(`DELETE FROM suspensions WHERE user_id = ?`, b.userId);
      await adminLog(c, now, 'unsuspend', b.userId, '');
      return json({ ok: true, changed: r.meta.changes });
    }
    case '/admin/search': {
      const { sql, binds, page } = searchSql(b as SearchQuery, now);
      const rows = await c.all<{ id: string; name: string; rate: number; wins: number; losses: number; last_seen: number; trophies: number; suspended_until: number | null }>(`SELECT ${sql}`, ...binds);
      // ページ送りは記録しない（かんりログが埋まらないように）
      if (page === 0) await adminLog(c, now, 'search', '', b);
      return json({ rows: rows.slice(0, SEARCH_PAGE), page, hasNext: rows.length > SEARCH_PAGE });
    }
    case '/admin/log': {
      const page = Math.max(0, Math.min(1000, Number.isInteger(b.page) ? (b.page as number) : 0));
      const rows = await c.all<{ id: number; at: number; action: string; target: string; detail: string }>(`SELECT id, at, action, target, detail FROM admin_log ORDER BY id DESC LIMIT ${SEARCH_PAGE + 1} OFFSET ${page * SEARCH_PAGE}`);
      const shown = rows.slice(0, SEARCH_PAGE);
      // 贈った記録には「受け取ったか」を付ける（v2.7。トロフィーは番号、贈り物は番号で、今の状態を見る）
      const detailOf = (r: { detail: string }) => {
        try {
          return JSON.parse(r.detail) as Record<string, unknown>;
        } catch {
          return {};
        }
      };
      const trophyNos = shown.filter((r) => r.action === 'trophy').map((r) => detailOf(r).number).filter(isTrophyNumber);
      const giftIds = shown.filter((r) => r.action === 'gift').map((r) => detailOf(r).giftId).filter((n): n is number => Number.isSafeInteger(n));
      const tDone = new Set(trophyNos.length ? (await c.all<{ number: number }>(`SELECT number FROM trophies WHERE delivered = 1 AND number IN (SELECT value FROM json_each(?))`, JSON.stringify(trophyNos))).map((r) => Number(r.number)) : []);
      const gDone = new Set(giftIds.length ? (await c.all<{ id: number }>(`SELECT id FROM gifts WHERE delivered = 1 AND id IN (SELECT value FROM json_each(?))`, JSON.stringify(giftIds))).map((r) => Number(r.id)) : []);
      const out = shown.map((r) => {
        if (r.action === 'trophy') return { ...r, received: tDone.has(detailOf(r).number as number) };
        if (r.action === 'gift') return { ...r, received: gDone.has(detailOf(r).giftId as number) };
        return r;
      });
      return json({ rows: out, page, hasNext: rows.length > SEARCH_PAGE });
    }
    case '/admin/logout': {
      // 管理の合言葉をサーバーからも消す
      const session = typeof b.session === 'string' && /^[0-9a-f]{64}$/.test(b.session) ? b.session : '';
      if (session) await c.run(`DELETE FROM admin_sessions WHERE token_hash = ?`, await sha256Hex(session));
      return json({ ok: true });
    }
    case '/admin/watch': {
      // 観戦を始めた記録（観戦そのものは端末どうしの通信）
      const room = typeof b.room === 'string' && /^[0-9]{4,8}$/.test(b.room) ? b.room : '';
      if (!room) return json({ error: 'bad' }, 400);
      await adminLog(c, now, 'watch', room, '');
      return json({ ok: true });
    }
  }
  return null;
}

/** 停止中のユーザーID（ずっと・まだ終わっていない） */
export async function suspendedUntil(c: Db, ids: string[], now: number): Promise<Record<string, number>> {
  const ok = ids.filter(isUserId).slice(0, 10);
  if (!ok.length) return {};
  const rows = await c.all<{ user_id: string; until: number }>(`SELECT user_id, until FROM suspensions WHERE user_id IN (SELECT value FROM json_each(?))`, JSON.stringify(ok));
  const out: Record<string, number> = {};
  for (const r of rows) if (isSuspended(Number(r.until), now)) out[r.user_id] = Number(r.until);
  return out;
}

/** 郵便受け：まだ受け取っていないトロフィーと贈り物（v2.7）。見た時に「最後に遊んだ日」を書く（1日1回） */
export async function mailbox(c: Db, userId: string, now: number): Promise<{ trophies: { number: number; created: number }[]; gifts: { id: number; kind: string; count: number; created: number }[] }> {
  await c.run(`UPDATE players SET last_seen = ? WHERE id = ? AND last_seen < ?`, now, userId, jstDayStart(now));
  const trophies = await c.all<{ number: number; created: number }>(`SELECT number, created FROM trophies WHERE user_id = ? AND delivered = 0 ORDER BY number`, userId);
  const gifts = await c.all<{ id: number; kind: string; count: number; created: number }>(`SELECT id, kind, count, created FROM gifts WHERE user_id = ? AND delivered = 0 ORDER BY id LIMIT 100`, userId);
  return { trophies, gifts };
}

/** 受け取ったと知らせる（自分あての番号だけ。トロフィーの番号と、贈り物の番号 giftIds。v2.7） */
export async function ackMailbox(c: Db, userId: string, numbers: unknown, giftIds: unknown = [], now = Date.now()): Promise<number> {
  const list = Array.isArray(numbers) ? numbers.filter(isTrophyNumber).slice(0, 100) : [];
  const gifts = Array.isArray(giftIds) ? giftIds.filter((n): n is number => Number.isSafeInteger(n) && n > 0).slice(0, 100) : [];
  let changed = 0;
  if (list.length) changed += (await c.run(`UPDATE trophies SET delivered = 1 WHERE user_id = ? AND number IN (SELECT value FROM json_each(?))`, userId, JSON.stringify(list))).meta.changes ?? 0;
  if (gifts.length) changed += (await c.run(`UPDATE gifts SET delivered = 1, delivered_at = ? WHERE user_id = ? AND delivered = 0 AND id IN (SELECT value FROM json_each(?))`, now, userId, JSON.stringify(gifts))).meta.changes ?? 0;
  return changed;
}
