import type { Env } from './env';
import { isVisible, lastBatchAt, nextBatchAt } from './logic/batch';

/** まとめ処理が遅れている時に、端末が聞き直すまでの時間 */
const LATE_RETRY_MS = 5 * 60 * 1000;
import { Db, type PlayerRow, rerank, writeSnapshot } from './ranking';
import { randomHex, sameText, sha256Hex } from './util';

export { Matchmaker } from './matchmaker';

/**
 * oteca-api（UPDATE_v2 §10・SPEC §11-9）：レート対戦の受付係（Durable Object）とランキング（D1）。
 * Cloudflare の無料プランで動かす。毎日 UTC 19:00（日本時間 4:00）と UTC 5:00（日本時間 14:00）に まとめ処理（Cron）。
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
    'Access-Control-Allow-Headers': 'content-type, x-admin-key',
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

const isId = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{16}$/.test(v);
const cleanName = (v: unknown) => (typeof v === 'string' ? [...v.trim()].slice(0, 8).join('') : '');

/** token が正しいか（サーバーには token のハッシュだけがある） */
async function authed(c: Ctx, playerId: unknown, token: unknown): Promise<boolean> {
  if (!isId(playerId) || typeof token !== 'string' || !/^[0-9a-f]{32}$/.test(token)) return false;
  const row = (await c.all<{ token_hash: string }>(`SELECT token_hash FROM players WHERE id = ?`, playerId))[0];
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
    visible: isVisible({ lastPlayed: row.last_played }, now),
    name: row.name,
    optIn: row.opt_in === 1,
  };
}

async function route(req: Request, c: Ctx): Promise<Response> {
  const url = new URL(req.url);
  const now = Date.now();
  const p = url.pathname;

  // 待合所（WebSocket）：token で本人を確かめてから受付係へ（他人の playerId で並べないように）
  if (p === '/lobby') {
    const playerId = url.searchParams.get('playerId');
    if (!(await authed(c, playerId, url.searchParams.get('token')))) return json({ error: 'auth' }, 401);
    const fwd = new Request(req, { headers: new Headers(req.headers) });
    fwd.headers.set('x-player-id', playerId!);
    return c.lobby('/lobby', fwd);
  }

  if (p === '/register' && req.method === 'POST') {
    const b = await body(req);
    if (!isId(b.playerId)) return json({ error: 'bad' }, 400);
    const token = randomHex(16);
    const r = await c.run(
      `INSERT INTO players (id, token_hash, name, opt_in, created) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING`,
      b.playerId,
      await sha256Hex(token),
      cleanName(b.name),
      b.optIn === false ? 0 : 1,
      now,
    );
    // もう登録してある（token は1回しか出さない）
    if (!r.meta.changes) return json({ error: 'exists' }, 409);
    return json({ token });
  }

  if (p === '/result' && req.method === 'POST') {
    const b = await body(req);
    if (!(await authed(c, b.playerId, b.token))) return json({ error: 'auth' }, 401);
    const res = await c.lobby('/report', { method: 'POST', body: JSON.stringify({ matchId: b.matchId, playerId: b.playerId, winner: b.winner }) });
    return json(await res.json(), res.status);
  }

  if (p === '/profile' && req.method === 'POST') {
    const b = await body(req);
    if (!(await authed(c, b.playerId, b.token))) return json({ error: 'auth' }, 401);
    await c.run(`UPDATE players SET name = ?, opt_in = ? WHERE id = ?`, cleanName(b.name), b.optIn === false ? 0 : 1, b.playerId);
    return json({ ok: true });
  }

  if ((p === '/ranking' || p === '/me') && req.method === 'GET') {
    const playerId = url.searchParams.get('playerId');
    const token = url.searchParams.get('token');
    let me = null;
    if (playerId && token && (await authed(c, playerId, token))) {
      const row = (await c.all<PlayerRow>(`SELECT * FROM players WHERE id = ?`, playerId))[0];
      me = meOf(row, now);
    }
    // 更新の時刻（4:00・14:00）を過ぎたのに まとめ処理がまだ終わっていない：5分後に聞き直してもらう（古い一覧を次の更新まで覚えさせない）
    const updated = Number((await c.all<{ u: number | null }>(`SELECT json_extract(value, '$.updatedAt') AS u FROM meta WHERE key = 'ranking'`))[0]?.u ?? 0);
    const next = updated < lastBatchAt(now) && updated > 0 ? now + LATE_RETRY_MS : nextBatchAt(now);
    // 最後に まとめ処理が終わった時刻（予定の 4:00 ではなく、本当に写しを作った時刻。遅れた時に古いデータを正式としないように）
    if (p === '/me') return json({ me, updatedAt: updated, nextAt: next });
    const snap = (await c.all<{ value: string }>(`SELECT value FROM meta WHERE key = 'ranking'`))[0];
    const ranking = snap ? (JSON.parse(snap.value) as { top: unknown[]; updatedAt: number }) : { top: [], updatedAt: 0 };
    return json({ ...ranking, me, nextAt: next });
  }

  if (p.startsWith('/admin/')) {
    const key = req.headers.get('x-admin-key') ?? '';
    if (!c.env.ADMIN_KEY || !sameText(key, c.env.ADMIN_KEY)) return json({ error: 'auth' }, 401);
    const b = req.method === 'POST' ? await body(req) : {};
    switch (p) {
      case '/admin/hide-name': {
        // 不適切な名前を「ななし」にする（hidden: false で戻す）。次の まとめ処理で一覧にも反映。すぐ一覧を作り直す
        if (!isId(b.playerId)) return json({ error: 'bad' }, 400);
        const r = await c.run(`UPDATE players SET name_banned = ? WHERE id = ?`, b.hidden === false ? 0 : 1, b.playerId);
        await writeSnapshot(c, null);
        return json({ ok: true, changed: r.meta.changes });
      }
      case '/admin/run-batch': {
        // 確かめる時用：b.now で まとめ処理の時刻を変えられる（7日の非表示を確かめる）
        const at = Number.isSafeInteger(b.now) && (b.now as number) > 0 ? (b.now as number) : now;
        return json(await batchViaLobby(c, at));
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
        const res = await c.lobby('/debug/seed', { method: 'POST', body: JSON.stringify({ results: b.results ?? [] }) });
        return json({ ok: true, lobby: await res.json() });
      }
      case '/admin/delete-players': {
        // 確かめる時用：テストで作ったプレイヤーを消す（順位と一覧の写しも作り直す）
        const ids = Array.isArray(b.playerIds) ? (b.playerIds as unknown[]).filter(isId) : [];
        if (!ids.length) return json({ error: 'bad' }, 400);
        const r = await c.run(`DELETE FROM players WHERE id IN (SELECT value FROM json_each(?))`, JSON.stringify(ids));
        await rerank(c, now);
        await writeSnapshot(c, null);
        return json({ ok: true, deleted: r.meta.changes });
      }
      case '/admin/clear-games': {
        // 確かめる時用：テストの人（playerIds）の試合（報告待ち・記録した結果）だけを消す
        const ids = Array.isArray(b.playerIds) ? (b.playerIds as unknown[]).filter(isId) : [];
        if (!ids.length) return json({ error: 'bad' }, 400);
        const res = await c.lobby('/debug/clear', { method: 'POST', body: JSON.stringify({ playerIds: ids }) });
        return json(await res.json());
      }
      case '/admin/lookup': {
        // 名前で探す（消す人の playerId を調べる）
        const rows = await c.all<PlayerRow>(`SELECT id, name, rate, rank, name_banned FROM players WHERE name LIKE ? LIMIT 20`, `%${cleanName(b.name)}%`);
        return json({ players: rows });
      }
    }
  }
  return json({ error: 'not found' }, 404);
}

/** まとめ処理を受付係に頼む */
async function batchViaLobby(c: Ctx, now: number): Promise<Record<string, unknown>> {
  const res = await c.lobby('/batch', { method: 'POST', body: JSON.stringify({ now }) });
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
    ctx.waitUntil(batchViaLobby(new Ctx(env), Date.now()).then(() => undefined));
  },
};
