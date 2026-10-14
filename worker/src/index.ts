import type { Env } from './env';
import { MATCH_LOG_DAILY_MAX, cleanMatchLog, rangeSince } from './logic/matchLog';
import { jstDay } from './logic/batch';
import { rankingTiming } from './logic/schedule';
import { isVisible } from './logic/batch';
import { Db, type PlayerRow, rerank, writeSnapshot } from './ranking';
import { sameText, sha256Hex } from './util';
import { isUserId } from '../../src/save/userId';
import { RATING } from '../../src/config/rating';
import { ADMIN_MENU_PATHS, ackMailbox, adminLogin, adminRoute, checkAdmin, mailbox, suspendedUntil } from './admin';

export { Matchmaker } from './matchmaker';

/**
 * oteca-api（UPDATE_v2 §10・SPEC §11-9）：レート対戦の受付係（Durable Object）とランキング（D1）。
 * Cloudflare の無料プランで動かす。毎日 UTC 19:00（日本時間 4:00）と UTC 7:00（日本時間 16:00）に まとめ処理（Cron）。
 */

/** 公開サイト（GitHub Pages） */
const SITE_ORIGIN = 'https://yosuke444.github.io';

/** 接続してよい所：公開サイトと、開発用の localhost・127.0.0.1（どのポートも） */
export function allowedOrigin(origin: string | null): boolean {
  if (!origin) return false;
  if (origin === SITE_ORIGIN) return true;
  return /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
}

function corsHeaders(origin: string | null): Record<string, string> {
  if (!allowedOrigin(origin)) return {};
  return {
    'Access-Control-Allow-Origin': origin!,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'content-type, x-admin-key, x-admin-session',
    'Access-Control-Expose-Headers': 'x-d1-rows-read, x-d1-rows-written, x-do-rows-read, x-do-rows-written, x-do-requests',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

/** 1回のリクエストで数えたもの（負荷の見積もり用） */
type Count = { d1Read: number; d1Written: number; doRead: number; doWritten: number; doRequests: number };

class Ctx extends Db {
  private doCount = { doRead: 0, doWritten: 0, doRequests: 0, d1Read: 0, d1Written: 0 };
  constructor(readonly env: Env) {
    super(env.DB);
  }

  /** 数えたもの（受付係の中で使った D1 もふくむ） */
  get count(): Count {
    return { ...this.doCount, d1Read: this.read + this.doCount.d1Read, d1Written: this.written + this.doCount.d1Written };
  }

  /** 受付係（1つだけ）へ */
  async lobby(path: string, init?: RequestInit): Promise<Response> {
    const stub = this.env.MATCHMAKER.get(this.env.MATCHMAKER.idFromName('lobby'));
    const res = await stub.fetch(`https://matchmaker${path}`, init);
    this.doCount.doRequests += 1;
    this.doCount.doRead += Number(res.headers.get('x-do-rows-read') ?? 0);
    this.doCount.doWritten += Number(res.headers.get('x-do-rows-written') ?? 0);
    this.doCount.d1Read += Number(res.headers.get('x-d1-rows-read') ?? 0);
    this.doCount.d1Written += Number(res.headers.get('x-d1-rows-written') ?? 0);
    return res;
  }
}

function json(body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', ...extra } });
}

/** ユーザーID（v2.0-J。15桁の数字） */
const isId = (v: unknown): v is string => isUserId(v);
/** 今までの playerId（16桁の16進数。ユーザーID に付け替える時だけ使う） */
const isLegacyId = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{16}$/.test(v);
const isToken = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{32}$/.test(v);
const cleanName = (v: unknown) => (typeof v === 'string' ? [...v.trim()].slice(0, 8).join('') : '');

/** token が正しいか（サーバーには token のハッシュだけがある） */
async function authed(c: Ctx, userId: unknown, token: unknown): Promise<boolean> {
  if (!isId(userId) || !isToken(token)) return false;
  const row = (await c.all<{ token_hash: string }>(`SELECT token_hash FROM players WHERE id = ?`, userId))[0];
  if (!row || !row.token_hash) return false;
  return sameText(row.token_hash, await sha256Hex(token));
}

async function body(req: Request): Promise<Record<string, unknown>> {
  const b = await req.json().catch(() => null);
  return b && typeof b === 'object' ? (b as Record<string, unknown>) : {};
}


/** 自分の正式なデータ */
function meOf(row: PlayerRow | undefined, now: number) {
  if (!row) return null;
  return {
    rate: row.rate,
    wins: row.wins,
    losses: row.losses,
    best: row.best,
    rank: row.rank,
    lastMatch: row.last_match ?? '',
    visible: isVisible({ lastPlayed: row.last_played }, now),
    name: row.name,
    optIn: row.opt_in === 1,
  };
}

async function route(req: Request, c: Ctx): Promise<Response> {
  const url = new URL(req.url);
  const now = Date.now();
  const p = url.pathname;

  // 待合所（WebSocket）：token で本人を確かめてから受付係へ（他人のユーザーID で並べないように）
  if (p === '/lobby') {
    const userId = url.searchParams.get('userId');
    if (!(await authed(c, userId, url.searchParams.get('token')))) return json({ error: 'auth' }, 401);
    // 停止中のユーザーID は待合所につながせない（v2.0-J）
    const sus = await suspendedUntil(c, [userId!], now);
    if (userId! in sus) return json({ error: 'suspended', until: sus[userId!] }, 403);
    const fwd = new Request(req, { headers: new Headers(req.headers) });
    fwd.headers.set('x-user-id', userId!);
    // 正式なレートと、配ったトロフィあげの数（v2.2。受付係が組んだ時に両者へ送る）
    const rec = (await c.all<{ rate: number; trophies: number }>(`SELECT rate, (SELECT COUNT(*) FROM trophies WHERE user_id = players.id) AS trophies FROM players WHERE id = ?`, userId))[0];
    fwd.headers.set('x-rate', String(rec?.rate ?? RATING.initial));
    fwd.headers.set('x-trophies', String(rec?.trophies ?? 0));
    return c.lobby('/lobby', fwd);
  }

  if (p === '/register' && req.method === 'POST') {
    // ユーザーID の登録（v2.0-J）：token は端末が作って送る（サーバーにはハッシュだけ）
    const b = await body(req);
    if (!isId(b.userId) || !isToken(b.token)) return json({ error: 'bad' }, 400);
    const hash = await sha256Hex(b.token);
    const sameOwner = async () => {
      const row = (await c.all<{ token_hash: string }>(`SELECT token_hash FROM players WHERE id = ?`, b.userId))[0];
      return row ? sameText(row.token_hash, hash) : null;
    };
    // もう登録してある：同じ token なら送り直し（登録できたことにする）、違えば ほかの人のユーザーID（409。端末は作り直す）
    const owner = await sameOwner();
    if (owner === true) return json({ ok: true, again: true });
    if (owner === false) return json({ error: 'exists' }, 409);
    // 今までの人：playerId と token が合えば、その行をユーザーID に付け替える（レート・勝敗を引き継ぐ）
    if (isLegacyId(b.legacyPlayerId)) {
      const r = await c.run(
        `UPDATE players SET id = ?, name = ?, opt_in = ? WHERE id = ? AND token_hash = ?`,
        b.userId,
        cleanName(b.name),
        b.optIn === false ? 0 : 1,
        b.legacyPlayerId,
        hash,
      );
      if (r.meta.changes) {
        // 受付係に残っている、まだ数えていない前の playerId の試合も付け替える
        await c.lobby('/rename', { method: 'POST', body: JSON.stringify({ from: b.legacyPlayerId, to: b.userId }) });
        await writeSnapshot(c, null);
        return json({ ok: true, migrated: true });
      }
    }
    const r = await c.run(
      `INSERT INTO players (id, token_hash, name, opt_in, created, last_seen) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING`,
      b.userId,
      hash,
      cleanName(b.name),
      b.optIn === false ? 0 : 1,
      now,
      now,
    );
    if (r.meta.changes) return json({ ok: true });
    // 同じ時に同じユーザーID が登録された
    return (await sameOwner()) ? json({ ok: true, again: true }) : json({ error: 'exists' }, 409);
  }

  if (p === '/result' && req.method === 'POST') {
    const b = await body(req);
    // 古い版（v2.0-I）の端末：401 だと token を消してしまうので、版を上げてもらう（426）
    if (b.userId === undefined && isLegacyId(b.playerId)) return json({ error: 'upgrade' }, 426);
    if (!(await authed(c, b.userId, b.token))) return json({ error: 'auth' }, 401);
    // 停止中は報告を受け付けない（v2.0-J）
    if ((b.userId as string) in (await suspendedUntil(c, [b.userId as string], now))) return json({ error: 'suspended' }, 403);
    const res = await c.lobby('/report', { method: 'POST', body: JSON.stringify({ matchId: b.matchId, playerId: b.userId, winner: b.winner }) });
    return json(await res.json(), res.status);
  }

  // 実際の対戦のデータ（v2.7。カードのバランス）：1試合1行。人が分かる情報は受け取らない。1日の上限に来たら記録しない
  if (p === '/match-log' && req.method === 'POST') {
    const log = cleanMatchLog(await body(req));
    if (!log) return json({ error: 'bad' }, 400);
    const day = jstDay(now);
    const n = (await c.all<{ n: number }>(`SELECT n FROM match_log_days WHERE day = ?`, day))[0]?.n ?? 0;
    if (n >= MATCH_LOG_DAILY_MAX) return json({ ok: false, full: true });
    await c.batch([
      { q: `INSERT INTO match_log_days (day, n) VALUES (?, 1) ON CONFLICT(day) DO UPDATE SET n = n + 1`, binds: [day] },
      {
        q: `INSERT INTO match_logs (day, at, mode, build, protocol, deck_a, deck_b, winner, turns, reason) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        binds: [day, now, log.mode, log.build, log.protocol, JSON.stringify(log.deckA), JSON.stringify(log.deckB), log.winner, log.turns, log.reason],
      },
    ]);
    return json({ ok: true });
  }

  // レート対戦が始まった・つながらなかった（v2.7）
  if (p === '/match-state' && req.method === 'POST') {
    const b = await body(req);
    if (!(await authed(c, b.userId, b.token))) return json({ error: 'auth' }, 401);
    const res = await c.lobby('/match-state', { method: 'POST', body: JSON.stringify({ matchId: b.matchId, playerId: b.userId, state: b.state }) });
    return json(await res.json(), res.status);
  }

  // TURN の接続先（v2.7）：Cloudflare Realtime の TURN キーから、3時間使える合言葉を作る（30分は同じものを返す）。無ければ空。
  // 登録した人（ユーザーID と token）だけに渡す（ほかの人に中継を使われないように）
  if (p === '/turn' && req.method === 'GET') {
    if (!(await authed(c, url.searchParams.get('userId'), url.searchParams.get('token')))) return json({ iceServers: [] }, 401, { 'cache-control': 'no-store' });
    return json({ iceServers: await turnServers(c.env, now) }, 200, { 'cache-control': 'no-store' });
  }

  if (p === '/profile' && req.method === 'POST') {
    const b = await body(req);
    if (b.userId === undefined && isLegacyId(b.playerId)) return json({ error: 'upgrade' }, 426);
    if (!(await authed(c, b.userId, b.token))) return json({ error: 'auth' }, 401);
    const optIn = b.optIn === false ? 0 : 1;
    const before = (await c.all<{ opt_in: number; rank: number | null }>(`SELECT opt_in, rank FROM players WHERE id = ?`, b.userId))[0];
    await c.run(`UPDATE players SET name = ?, opt_in = ?${optIn ? '' : ', rank = NULL'} WHERE id = ?`, cleanName(b.name), optIn, b.userId);
    // 「ランキングに のる」をオフにした（v2.2）：すぐ公開の一覧から外す。順位を付け直して（抜けが出ないように）写しを作り直す
    // （オンに戻した時は次の更新から載る）
    if (!optIn && before && before.rank !== null) {
      await rerank(c, now);
      await writeSnapshot(c, null);
    }
    return json({ ok: true });
  }

  if ((p === '/ranking' || p === '/me') && req.method === 'GET') {
    const userId = url.searchParams.get('userId');
    const token = url.searchParams.get('token');
    let me = null;
    if (userId && token && (await authed(c, userId, token))) {
      const row = (await c.all<PlayerRow>(`SELECT * FROM players WHERE id = ?`, userId))[0];
      me = meOf(row, now);
    }
    // 次の更新（v2.7）：済んでいれば次の予定の時刻。予定の時刻を過ぎたのに まだなら、その時刻と updating（時間を延ばして見せない）。
    // serverNow：端末の時計がずれていても、サーバーの時刻で数えられるように。保存（キャッシュ）はさせない
    const updated = Number((await c.all<{ u: number | null }>(`SELECT json_extract(value, '$.updatedAt') AS u FROM meta WHERE key = 'ranking'`))[0]?.u ?? 0);
    const timing = rankingTiming(updated, now);
    const noStore = { 'cache-control': 'no-store' };
    // 最後に まとめ処理が終わった時刻（予定の 4:00 ではなく、本当に写しを作った時刻。遅れた時に古いデータを正式としないように）
    if (p === '/me') return json({ me, updatedAt: updated, ...timing, serverNow: now }, 200, noStore);
    const snap = (await c.all<{ value: string }>(`SELECT value FROM meta WHERE key = 'ranking'`))[0];
    const ranking = snap ? (JSON.parse(snap.value) as { top: unknown[]; updatedAt: number }) : { top: [], updatedAt: 0 };
    return json({ ...ranking, me, ...timing, serverNow: now }, 200, noStore);
  }

  // 郵便受け（v2.0-J。届いたトロフィー）
  if (p === '/mailbox' && req.method === 'GET') {
    const userId = url.searchParams.get('userId');
    if (!(await authed(c, userId, url.searchParams.get('token')))) return json({ error: 'auth' }, 401);
    return json({ trophies: await mailbox(c, userId!, now) });
  }
  if (p === '/mailbox/ack' && req.method === 'POST') {
    const b = await body(req);
    if (!(await authed(c, b.userId, b.token))) return json({ error: 'auth' }, 401);
    return json({ ok: true, changed: await ackMailbox(c, b.userId as string, b.numbers) });
  }
  // 停止中か（v2.0-J。自分・対戦相手・トレード相手。ユーザーID をカンマ区切りで10件まで）
  if (p === '/status' && req.method === 'GET') {
    const ids = (url.searchParams.get('ids') ?? '').split(',').filter(Boolean);
    return json({ suspended: await suspendedUntil(c, ids, now) });
  }
  // 管理者メニューに入る（v2.0-J。パスワード＝管理キー。同じ接続元から5回まちがえたら1時間入れない）
  if (p === '/admin-login' && req.method === 'POST') return adminLogin(req, c, c.env.ADMIN_KEY, now, json);

  if (p.startsWith('/admin/')) {
    const denied = await checkAdmin(req, c, c.env.ADMIN_KEY, now, json, ADMIN_MENU_PATHS.has(p));
    if (denied) return denied;
    const b = req.method === 'POST' ? await body(req) : {};
    const done = await adminRoute(p, b, c, now, json);
    if (done) return done;
    switch (p) {
      case '/admin/hide-name': {
        // 不適切な名前を「ななし」にする（hidden: false で戻す）。次の まとめ処理で一覧にも反映。すぐ一覧を作り直す
        if (!isId(b.userId)) return json({ error: 'bad' }, 400);
        const r = await c.run(`UPDATE players SET name_banned = ? WHERE id = ?`, b.hidden === false ? 0 : 1, b.userId);
        await writeSnapshot(c, null);
        return json({ ok: true, changed: r.meta.changes });
      }
      case '/admin/run-batch': {
        // 確かめる時用：b.now で まとめ処理の時刻を変えられる（7日の非表示を確かめる）
        // b.now（時刻を変える）は管理キーの時だけ（確かめ用）。管理画面（合言葉）からは今の時刻で（未来の時刻にして予定の更新が止まらないように。v2.7）
        const at = req.headers.get('x-admin-key') && Number.isSafeInteger(b.now) && (b.now as number) > 0 ? (b.now as number) : now;
        return json(await batchViaLobby(c, at));
      }
      case '/admin/card-stats': {
        // カードの せいせき（v2.7）：期間（today・7d・all）の中で、そのカードが入っていたデッキの数と、そのデッキの勝ち
        const since = rangeSince(b.range, now);
        const rows = await c.all<{ no: number; decks: number; copies: number; wins: number; decided: number }>(
          `WITH logs AS (
             SELECT deck_a AS deck, CASE winner WHEN 0 THEN 1 WHEN 1 THEN 0 END AS win FROM match_logs WHERE at >= ?
             UNION ALL
             SELECT deck_b AS deck, CASE winner WHEN 1 THEN 1 WHEN 0 THEN 0 END AS win FROM match_logs WHERE at >= ?
           )
           SELECT json_extract(j.value, '$[0]') AS no, COUNT(*) AS decks, SUM(json_extract(j.value, '$[1]')) AS copies, SUM(win) AS wins, COUNT(win) AS decided
           FROM logs, json_each(logs.deck) AS j GROUP BY no ORDER BY decks DESC`,
          since,
          since,
        );
        const games = (await c.all<{ n: number }>(`SELECT COUNT(*) AS n FROM match_logs WHERE at >= ?`, since))[0]?.n ?? 0;
        return json({ since, games, cards: rows });
      }
      case '/admin/stats': {
        const res = await c.lobby(`/debug/stats${url.searchParams.get('reset') === '1' ? '?reset=1' : ''}`);
        const players = (await c.all<{ n: number }>(`SELECT COUNT(*) AS n FROM players`))[0]?.n ?? 0;
        return json({ lobby: await res.json(), players });
      }
      case '/admin/seed': {
        // 確かめる時用：プレイヤーと試合結果を入れる（負荷の見積もり）
        const players = Array.isArray(b.players) ? (b.players as string[]).filter(isId) : [];
        if (players.length) {
          await c.run(
            `INSERT INTO players (id, token_hash, name, created) SELECT value, '', 'p' || substr(value, 1, 5), ? FROM json_each(?) WHERE true ON CONFLICT(id) DO NOTHING`,
            now,
            JSON.stringify(players),
          );
        }
        // 今までの人（v2.0-I の playerId と token）の行を作る（付け替えのテスト用）
        for (const l of Array.isArray(b.legacy) ? (b.legacy as Record<string, unknown>[]) : []) {
          if (!isLegacyId(l.playerId) || !isToken(l.token)) continue;
          await c.run(
            `INSERT INTO players (id, token_hash, rate, wins, losses, best, last_played, created, name) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING`,
            l.playerId,
            await sha256Hex(l.token),
            Number(l.rate) || 100,
            Number(l.wins) || 0,
            Number(l.losses) || 0,
            Number(l.best) || 100,
            // 最後に遊んだのは まだ（ランキングに出さない）
            0,
            now,
            cleanName(l.name),
          );
        }
        const res = await c.lobby('/debug/seed', { method: 'POST', body: JSON.stringify({ results: b.results ?? [] }) });
        return json({ ok: true, lobby: await res.json() });
      }
      case '/admin/delete-players': {
        // 確かめる時用：テストで作ったプレイヤーを消す（順位と一覧の写しも作り直す）
        const ids = Array.isArray(b.userIds) ? (b.userIds as unknown[]).filter(isId) : [];
        if (!ids.length) return json({ error: 'bad' }, 400);
        const r = await c.run(`DELETE FROM players WHERE id IN (SELECT value FROM json_each(?))`, JSON.stringify(ids));
        await rerank(c, now);
        await writeSnapshot(c, null);
        return json({ ok: true, deleted: r.meta.changes });
      }
      case '/admin/clear-games': {
        // 確かめる時用：テストの人（playerIds）の試合（報告待ち・記録した結果）だけを消す
        const ids = Array.isArray(b.userIds) ? (b.userIds as unknown[]).filter(isId) : [];
        if (!ids.length) return json({ error: 'bad' }, 400);
        const res = await c.lobby('/debug/clear', { method: 'POST', body: JSON.stringify({ userIds: ids }) });
        return json(await res.json());
      }
      case '/admin/lookup': {
        // 名前で探す（消す人のユーザーID を調べる）
        const rows = await c.all<PlayerRow>(`SELECT id, name, rate, rank, name_banned FROM players WHERE name LIKE ? LIMIT 20`, `%${cleanName(b.name)}%`);
        return json({ players: rows });
      }
    }
  }
  return json({ error: 'not found' }, 404);
}

/** まとめ処理を受付係に頼む */
/** まとめ処理を受付係に頼む。scheduled：予定の更新（済んでいれば何もしない）。そうでなければ今すぐ（管理画面・確かめ用） */
async function batchViaLobby(c: Ctx, now: number, scheduled = false): Promise<Record<string, unknown>> {
  const res = await c.lobby('/batch', { method: 'POST', body: JSON.stringify({ now, scheduled }) });
  return (await res.json()) as Record<string, unknown>;
}

function withCount(res: Response, c: Ctx, metrics: boolean): Response {
  if (!metrics) return res;
  const r = new Response(res.body, res);
  r.headers.set('x-d1-rows-read', String(c.count.d1Read));
  r.headers.set('x-d1-rows-written', String(c.count.d1Written));
  r.headers.set('x-do-rows-read', String(c.count.doRead));
  r.headers.set('x-do-rows-written', String(c.count.doWritten));
  r.headers.set('x-do-requests', String(c.count.doRequests));
  return r;
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const origin = req.headers.get('Origin');
    if (req.method === 'OPTIONS') return new Response(null, { status: allowedOrigin(origin) ? 204 : 403, headers: corsHeaders(origin) });
    // ブラウザからは公開サイトと localhost だけ（Origin の無い呼び出しは管理用の道だけ）
    const url = new URL(req.url);
    if (!allowedOrigin(origin) && !url.pathname.startsWith('/admin/')) return new Response('forbidden', { status: 403 });
    const c = new Ctx(env);
    let res: Response;
    try {
      res = await route(req, c);
    } catch (e) {
      // 中身は返さない（記録には残す）
      console.error(e);
      res = json({ error: 'server' }, 500);
    }
    if (res.status === 101) return res;
    const out = withCount(res, c, env.METRICS === '1');
    for (const [k, v] of Object.entries(corsHeaders(origin))) out.headers.set(k, v);
    return out;
  },

  async scheduled(_ev: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    // まとめ処理は受付係の中で（Worker は待つだけ。CPU 時間をほとんど使わない）
    // 予定の更新：その回が もう済んでいれば何もしない（受付係の目覚ましが先に動いた時など。v2.7）
    ctx.waitUntil(batchViaLobby(new Ctx(env), Date.now(), true).then(() => undefined));
  },
};

/** TURN の合言葉（1時間は同じものを使う。Worker の入れ物ごと） */
let turnCache: { at: number; servers: unknown[] } | null = null;
const TURN_TTL_S = 3 * 60 * 60;
/** 同じ合言葉を返す時間（端末も30分まで使う。合言葉は3時間使えるので、対戦の途中で切れない） */
const TURN_REUSE_MS = 30 * 60 * 1000;

async function turnServers(env: Env, now: number): Promise<unknown[]> {
  if (!env.TURN_KEY_ID || !env.TURN_KEY_TOKEN) return [];
  if (turnCache && now - turnCache.at < TURN_REUSE_MS) return turnCache.servers;
  try {
    const res = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${env.TURN_KEY_ID}/credentials/generate-ice-servers`, {
      method: 'POST',
      headers: { authorization: `Bearer ${env.TURN_KEY_TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({ ttl: TURN_TTL_S }),
      signal: AbortSignal.timeout(3000),
    });
    const b = res.ok ? ((await res.json()) as { iceServers?: unknown }) : null;
    const list = Array.isArray(b?.iceServers) ? b.iceServers : b?.iceServers ? [b.iceServers] : [];
    if (list.length) turnCache = { at: now, servers: list };
    return list;
  } catch {
    // 作れなかった：前の合言葉が まだ新しければ それを（古ければ空）
    return turnCache && now - turnCache.at < TURN_REUSE_MS * 2 ? turnCache.servers : [];
  }
}
