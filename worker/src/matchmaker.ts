import { DurableObject } from 'cloudflare:workers';
import { type Waiter, cleanJoin, pickPairs, serverRecord, waitingCounts } from './logic/queue';
import { type MatchInfo, type Report, type ResultRow, acceptReport, cleanReport, decide } from './logic/results';
import type { Env } from './env';
import { randomHex } from './util';
import { Db, runBatchJob } from './ranking';
import { jstDay } from './logic/batch';
import { CLOSE_VERSION, VERSION_CACHE_MS, VERSION_FETCH_MS, currentProtocol, isTooOld, readProtocol } from './logic/version';

/**
 * 受付係（Durable Object。SQLite 保存・休止機能。UPDATE_v2 §8-4・§10、SPEC §11-9）。
 * - 待ち行列：WebSocket の付け札（attachment）に持つので、休止から戻っても消えない。
 * - 組んだ試合・2人の報告・記録した結果は、SQLite の games 表に「1試合1行」で持つ（WITHOUT ROWID。索引を作らない）。
 *   書き込みは1試合あたり：組んだ時 1・1人目の報告 1・2人目の報告（記録）1・まとめ処理の後に消す 1 ＝ 4行（無料枠の書き込み行を節約）。
 * 1つだけ作る（名前 'lobby'）。
 */

type Attachment = Omit<Waiter, 'id'> & { id: string; state: 'waiting' | 'done' };

/** ブラウザから受け取るもの */
/** 同じユーザーID がもう待っていたので切った（v2.2） */
export const CLOSE_SAME_USER = 4001;

type ClientMsg = { t: 'join'; body: unknown } | { t: 'leave' };

/** 行数を数える（負荷の見積もり用。?metrics=1 の時だけ返す） */
export type Metrics = { rowsRead: number; rowsWritten: number };

/** games 表の1行 */
type GameRow = {
  id: string;
  /** 2人（受付係が組んだ試合は組んだ時に。受付係の知らない試合は報告した順に。'' ＝まだ） */
  a: string;
  b: string;
  /** 1＝受付係が組んだ試合 */
  known: number;
  created: number;
  /** a・b の報告（null ＝まだ） */
  rep_a: string | null;
  at_a: number | null;
  rep_b: string | null;
  at_b: number | null;
  /** 記録した結果（null ＝まだ） */
  winner: string | null;
  at: number | null;
};

type Conn = { ws: WebSocket; att: Attachment };

/** その日に数えた数の行を散らす数（1行を大きくしないため） */
const DAY_COUNT_BUCKETS = 16;
/** その日に数えた数を残す日数 */
const DAY_COUNTS_KEEP_DAYS = 3;

/** キー → 散らし先（0〜15） */
function bucketOf(key: string): number {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return h % DAY_COUNT_BUCKETS;
}

export class Matchmaker extends DurableObject<Env> {
  private sql: SqlStorage;
  private seq = 0;
  /** まとめ処理の途中か（同時に2つ動かさない） */
  private batching = false;
  private lastCounts = new Map<number, number>();
  metrics: Metrics = { rowsRead: 0, rowsWritten: 0 };
  /** 負荷の見積もり用：休止から戻るまでの合計（WebSocket のメッセージ・行数。/debug/stats で見る） */
  private totals = { wsMessages: 0, rowsRead: 0, rowsWritten: 0, paired: 0 };

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    // 最初の作り（3つの表）の名残があれば消す
    this.exec(`DROP TABLE IF EXISTS matches`);
    this.exec(`DROP TABLE IF EXISTS reports`);
    this.exec(`DROP TABLE IF EXISTS results`);
    // まとめ処理の途中の印（D1 に書く直前に、処理する試合ID を1行で覚える。失敗した時に二重に数えないように）
    this.exec(`CREATE TABLE IF NOT EXISTS batch_state (id TEXT PRIMARY KEY, match_ids TEXT NOT NULL) WITHOUT ROWID`);
    // その日に数えた数（v2.0-J。1日2回の まとめ処理をまたいで「予備の待合所の試合は1人1日10試合まで」を数える。
    // v2.7 で「同じ2人は1日3試合まで」はやめた）。1日16行（キーの散らし先ごとに JSON。キーは 日付:f:人）。書き込み行を試合の数で増やさず、1行も大きくしない
    // 公開している版（v2.7。version.json の protocol と読んだ時刻）
    this.exec(`CREATE TABLE IF NOT EXISTS version_cache (id INTEGER PRIMARY KEY, protocol INTEGER, at INTEGER NOT NULL)`);
    this.exec(`DROP TABLE IF EXISTS day_counts`);
    this.exec(`DROP TABLE IF EXISTS day_counts2`);
    this.exec(`CREATE TABLE IF NOT EXISTS day_counts3 (day INTEGER NOT NULL, bucket INTEGER NOT NULL, counts TEXT NOT NULL, PRIMARY KEY (day, bucket)) WITHOUT ROWID`);
    this.exec(
      `CREATE TABLE IF NOT EXISTS games (id TEXT PRIMARY KEY, a TEXT NOT NULL, b TEXT NOT NULL, known INTEGER NOT NULL, created INTEGER NOT NULL,
       rep_a TEXT, at_a INTEGER, rep_b TEXT, at_b INTEGER, winner TEXT, at INTEGER) WITHOUT ROWID`,
    );
    // 休止から戻った時：今つながっている人の数を覚え直す（知らせ直さない）
    this.lastCounts = waitingCounts(this.conns().map((c) => c.att));
  }

  /** SQL を実行して、読み書きした行数を数える */
  private exec<T extends Record<string, SqlStorageValue>>(query: string, ...binds: SqlStorageValue[]): T[] {
    const cur = this.sql.exec<T>(query, ...binds);
    const rows = cur.toArray();
    this.metrics.rowsRead += cur.rowsRead;
    this.metrics.rowsWritten += cur.rowsWritten;
    this.totals.rowsRead += cur.rowsRead;
    this.totals.rowsWritten += cur.rowsWritten;
    return rows;
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    this.metrics = { rowsRead: 0, rowsWritten: 0 };
    let res: Response;
    switch (url.pathname) {
      case '/lobby':
        return this.lobby(req);
      case '/report':
        res = await this.report(req);
        break;
      case '/batch': {
        // まとめ処理（毎日 日本時間 4:00 と 16:00。Worker の Cron・管理キーから）。D1 も受付係の中から書く。同時に1つだけ
        if (this.batching) {
          res = Response.json({ ok: false, error: 'busy' }, { status: 409 });
          break;
        }
        this.batching = true;
        try {
          const body = (await req.json().catch(() => null)) as { now?: unknown } | null;
          const now = Number.isSafeInteger(body?.now) ? (body!.now as number) : Date.now();
          const db = new Db(this.env.DB);
          res = Response.json(
            await runBatchJob(db, {
              exportResults: (n) => this.exportResults(n),
              ack: (ids) => this.ack(ids),
              pending: () => {
                const r = this.exec<{ id: string; match_ids: string }>(`SELECT id, match_ids FROM batch_state`)[0];
                if (!r) return null;
                const v = JSON.parse(r.match_ids) as string[] | { matchIds: string[] };
                return { id: r.id, matchIds: Array.isArray(v) ? v : v.matchIds };
              },
              setPending: (p) => {
                this.exec(`DELETE FROM batch_state`);
                if (p) this.exec(`INSERT INTO batch_state (id, match_ids) VALUES (?, ?)`, p.id, JSON.stringify({ matchIds: p.matchIds }));
              },
              dayCounts: () => {
                const m = new Map<string, number>();
                for (const r of this.exec<{ counts: string }>(`SELECT counts FROM day_counts3`)) for (const [k, v] of JSON.parse(r.counts) as [string, number][]) m.set(k, v);
                return m;
              },
              saveDayCounts: (changed, at) => {
                // 日と散らし先ごとにまとめて、その行だけを書き直す
                const groups = new Map<string, { day: number; bucket: number; list: [string, number][] }>();
                for (const [k, v] of changed) {
                  const day = Number(k.slice(0, k.indexOf(':')));
                  const bucket = bucketOf(k);
                  const g = groups.get(`${day}:${bucket}`) ?? { day, bucket, list: [] };
                  g.list.push([k, v]);
                  groups.set(`${day}:${bucket}`, g);
                }
                for (const { day, bucket, list } of groups.values()) {
                  const row = this.exec<{ counts: string }>(`SELECT counts FROM day_counts3 WHERE day = ? AND bucket = ?`, day, bucket)[0];
                  const m = new Map<string, number>(row ? (JSON.parse(row.counts) as [string, number][]) : []);
                  for (const [k, v] of list) m.set(k, v);
                  this.exec(
                    `INSERT INTO day_counts3 (day, bucket, counts) VALUES (?, ?, ?) ON CONFLICT(day, bucket) DO UPDATE SET counts = excluded.counts`,
                    day,
                    bucket,
                    JSON.stringify([...m]),
                  );
                }
                // 3日より古い日は消す（まとめ処理が止まっていて、遅れて届いた試合のために、3日分は残す）
                this.exec(`DELETE FROM day_counts3 WHERE day < ?`, jstDay(at - DAY_COUNTS_KEEP_DAYS * 24 * 60 * 60 * 1000));
              },
            }, now),
          );
          res.headers.set('x-d1-rows-read', String(db.read));
          res.headers.set('x-d1-rows-written', String(db.written));
        } finally {
          this.batching = false;
        }
        break;
      }
      case '/rename': {
        // 今までの playerId → ユーザーID（v2.0-J。付け替えた時に、まだ数えていない試合も付け替える）
        const b = (await req.json().catch(() => null)) as { from?: string; to?: string } | null;
        const from = String(b?.from ?? '');
        const to = String(b?.to ?? '');
        if (!/^[0-9a-f]{16}$/.test(from) || !/^[1-9][0-9]{14}$/.test(to)) {
          res = Response.json({ ok: false }, { status: 400 });
          break;
        }
        for (const col of ['a', 'b', 'winner', 'rep_a', 'rep_b']) this.exec(`UPDATE games SET ${col} = ? WHERE ${col} = ?`, to, from);
        res = Response.json({ ok: true });
        break;
      }
      case '/debug/clear': {
        // 確かめる時用：テストの人の試合だけを消す（テストの後片づけ。管理キーが要る）
        const ids = JSON.stringify(((await req.json().catch(() => null)) as { userIds?: string[] } | null)?.userIds ?? []);
        this.exec(`DELETE FROM games WHERE a IN (SELECT value FROM json_each(?)) OR b IN (SELECT value FROM json_each(?))`, ids, ids);
        res = Response.json({ ok: true });
        break;
      }
      case '/debug/seed':
        res = await this.debugSeed(req);
        break;
      case '/debug/stats': {
        // 数える読み込みは、どちらの合計にも入れない（見積もりがずれないように）
        const totals = { ...this.totals };
        const n = (where: string) => Number(this.exec<{ n: number }>(`SELECT COUNT(*) AS n FROM games WHERE ${where}`)[0]?.n ?? 0);
        const body = { open: n('winner IS NULL'), results: n('winner IS NOT NULL'), waiting: this.conns().length, totals };
        this.totals = url.searchParams.get('reset') === '1' ? { wsMessages: 0, rowsRead: 0, rowsWritten: 0, paired: 0 } : { ...totals, ...this.totals, rowsRead: totals.rowsRead };
        res = Response.json(body);
        break;
      }
      default:
        res = new Response('not found', { status: 404 });
    }
    res.headers.set('x-do-rows-read', String(this.metrics.rowsRead));
    res.headers.set('x-do-rows-written', String(this.metrics.rowsWritten));
    return res;
  }

  // ---------------------------------------------------------------- 待合所（WebSocket）

  private lobby(req: Request): Response {
    if (req.headers.get('Upgrade') !== 'websocket') return new Response('expected websocket', { status: 426 });
    const pair = new WebSocketPair();
    // 休止機能（Hibernation API）：待っている間は受付係が眠れる。Worker が token で確かめたユーザーID を札（tag）に付ける
    const playerId = req.headers.get('x-user-id') ?? '';
    // 正式なレートと、配ったトロフィあげの数（v2.2。VS 画面に出す。Worker が D1 から読んだもの）
    const rec = [`rate:${Number(req.headers.get('x-rate') ?? '')}`, `trophies:${Number(req.headers.get('x-trophies') ?? '')}`];
    this.ctx.acceptWebSocket(pair[1], playerId ? [playerId, ...rec] : []);
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  /**
   * 今の版（公開している version.json を5分ごとに読み直す。読めなければ前の値・Worker を作った時の版）。
   * 読んだ値は受付係の保存（SQL）に書く（休止から戻っても、毎回読みに行かないように）
   */
  private async currentVersion(now = Date.now()): Promise<number> {
    const url = this.env.GAME_VERSION_URL;
    const row = this.sql.exec(`SELECT protocol, at FROM version_cache WHERE id = 1`).toArray()[0] as { protocol: number | null; at: number } | undefined;
    let protocol = row?.protocol ?? null;
    if (url && now - (row?.at ?? 0) >= VERSION_CACHE_MS) {
      try {
        const res = await fetch(`${url}?t=${now}`, { cache: 'no-store', signal: AbortSignal.timeout(VERSION_FETCH_MS) });
        const p = res.ok ? readProtocol(await res.json()) : null;
        if (p !== null) protocol = p;
      } catch {
        // 読めない：前の値のまま（5分は読み直さない）
      }
      this.exec(`INSERT INTO version_cache (id, protocol, at) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET protocol = excluded.protocol, at = excluded.at`, protocol, now);
    }
    return currentProtocol(protocol);
  }

  /** 待っている人（付け札から。1回の出来事で1回だけ作る） */
  private conns(): Conn[] {
    const out: Conn[] = [];
    for (const ws of this.ctx.getWebSockets()) {
      const att = ws.deserializeAttachment() as Attachment | null;
      if (att && att.state === 'waiting' && ws.readyState === 1) out.push({ ws, att });
    }
    return out;
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    this.totals.wsMessages += 1;
    let m: ClientMsg;
    try {
      m = JSON.parse(typeof message === 'string' ? message : new TextDecoder().decode(message));
    } catch {
      return;
    }
    if (m.t === 'leave') {
      this.drop(ws);
      this.broadcastCounts(this.match(this.conns()));
      return;
    }
    if (m.t !== 'join') return;
    const cur = ws.deserializeAttachment() as Attachment | null;
    if (cur) return; // 2回目の join は無視
    const j = cleanJoin(m.body);
    // 本人のユーザーID でなければ受け付けない（つないだ時に token で確かめたユーザーID と同じか）
    if (j && this.ctx.getTags(ws)[0] !== j.playerId) {
      ws.send(JSON.stringify({ t: 'error', body: { reason: 'auth' } }));
      ws.close(1008, 'auth');
      return;
    }
    if (!j) {
      ws.send(JSON.stringify({ t: 'error', body: { reason: 'bad' } }));
      ws.close(1008, 'bad');
      return;
    }
    // 今の版より古い人の申し込みは断る（v2.7）：端末は「さいよみこみ」を出す
    if (isTooOld(j.protocol, await this.currentVersion())) {
      ws.send(JSON.stringify({ t: 'error', body: { reason: 'version' } }));
      ws.close(CLOSE_VERSION, 'version');
      return;
    }
    // 版を待つ間に、同じ接続から別の join が来ていた
    if (ws.deserializeAttachment()) return;
    // 同じユーザーID がもう待っている（v2.2。SPEC §7 S15）：
    // 同じタブの入り直し（前の接続が切れたのに残っていた）は前の接続を外す。ほかのタブ・端末なら2つ目は受け付けない（人数にも数えない）
    for (const other of this.conns()) {
      if (other.ws === ws || other.att.playerId !== j.playerId) continue;
      if (j.tab && other.att.tab === j.tab) {
        this.drop(other.ws, 4000, 'replaced');
        continue;
      }
      ws.send(JSON.stringify({ t: 'error', body: { reason: 'same-user' } }));
      ws.close(CLOSE_SAME_USER, 'same-user');
      return;
    }
    this.seq = (this.seq + 1) % 1e9;
    // レートとトロフィーの数は、サーバーの記録（v2.2）。無ければ端末が送ってきたレート
    const rec = serverRecord(this.ctx.getTags(ws));
    ws.serializeAttachment({ ...j, rate: rec?.rate ?? j.rate, trophies: rec?.trophies ?? 0, id: randomHex(8), joinedAt: Date.now(), seq: this.seq, state: 'waiting' } satisfies Attachment);
    const left = this.match(this.conns());
    this.broadcastCounts(left);
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    if (this.drop(ws)) this.broadcastCounts(this.match(this.conns()));
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    if (this.drop(ws)) this.broadcastCounts(this.match(this.conns()));
  }

  /**
   * 待ち行列から外す（やめる・タブを閉じた・通信が切れた）
   * @returns 待っていた人を外した時 true
   */
  private drop(ws: WebSocket, code = 1000, reason = 'bye'): boolean {
    const a = ws.deserializeAttachment() as Attachment | null;
    const was = !!a && a.state === 'waiting';
    if (a && was) ws.serializeAttachment({ ...a, state: 'done' });
    try {
      ws.close(code, reason);
    } catch {
      // もう閉じている
    }
    return was;
  }

  /**
   * 組めるだけ組んで、2人に知らせて切る
   * @returns まだ待っている人
   */
  private match(conns: Conn[]): Conn[] {
    const now = Date.now();
    const byId = new Map(conns.map((c) => [c.att.id, c]));
    const used = new Set<string>();
    for (const { a, b } of pickPairs(conns.map((c) => c.att))) {
      const matchId = randomHex(8);
      const roomId = randomHex(8);
      this.exec(`INSERT INTO games (id, a, b, known, created) VALUES (?, ?, ?, 1, ?)`, matchId, a.playerId, b.playerId, now);
      this.totals.paired += 1;
      for (const [me, opp] of [
        [a, b],
        [b, a],
      ] as const) {
        const c = byId.get(me.id);
        if (!c) continue;
        used.add(me.id);
        c.ws.serializeAttachment({ ...c.att, state: 'done' });
        // 両者の名前・レート・トロフィあげの数（v2.2。VS 画面と対戦中の名前の欄に出す）
        c.ws.send(JSON.stringify({ t: 'paired', body: { matchId, roomId, me: { rate: me.rate, trophies: me.trophies }, opponent: { userId: opp.playerId, name: opp.name, rate: opp.rate, trophies: opp.trophies } } }));
        // 組めたら受付係との接続は切る（ブラウザの側でも切る）
        try {
          c.ws.close(1000, 'paired');
        } catch {
          // もう閉じている
        }
      }
    }
    return conns.filter((c) => !used.has(c.att.id));
  }

  /** 待っている人数を、変わった版数の人にだけ知らせる */
  private broadcastCounts(conns: Conn[]): void {
    const counts = waitingCounts(conns.map((c) => c.att));
    const changed = new Set<number>();
    for (const v of new Set([...counts.keys(), ...this.lastCounts.keys()])) if (this.lastCounts.get(v) !== (counts.get(v) ?? 0)) changed.add(v);
    if (changed.size) {
      for (const c of conns) {
        if (!changed.has(c.att.protocol)) continue;
        try {
          c.ws.send(JSON.stringify({ t: 'waiting', body: { count: counts.get(c.att.protocol) ?? 0 } }));
        } catch {
          // 切れかけ
        }
      }
    }
    this.lastCounts = counts;
  }

  // ---------------------------------------------------------------- 結果の報告

  private game(id: string): GameRow | null {
    return this.exec<GameRow>(`SELECT * FROM games WHERE id = ?`, id)[0] ?? null;
  }

  /** 行 → 受付係が組んだ試合（知らない試合は null） */
  private static matchOf(g: GameRow | null): MatchInfo | null {
    return g && g.known === 1 ? { matchId: g.id, a: g.a, b: g.b, created: Number(g.created) } : null;
  }

  /** 行 → 届いている報告 */
  private static reportsOf(g: GameRow): Report[] {
    const out: Report[] = [];
    if (g.rep_a !== null && g.a) out.push({ matchId: g.id, playerId: g.a, winner: g.rep_a, at: Number(g.at_a) });
    if (g.rep_b !== null && g.b) out.push({ matchId: g.id, playerId: g.b, winner: g.rep_b, at: Number(g.at_b) });
    return out;
  }

  /** 報告を受け取る（token は Worker が確かめてから渡す）。書き込みは1行だけ */
  private async report(req: Request): Promise<Response> {
    const now = Date.now();
    const r = cleanReport(await req.json().catch(() => null), now);
    if (!r) return Response.json({ ok: false, error: 'bad' }, { status: 400 });
    const g = this.game(r.matchId);
    // もう記録した試合
    if (g && g.winner !== null) return Response.json({ ok: true, state: 'done' });
    const match = Matchmaker.matchOf(g);
    if (!acceptReport(match, r)) return Response.json({ ok: false, error: 'not-player' }, { status: 403 });
    if (!g) {
      // 受付係の知らない試合（予備の待合所）の1人目：報告した人を a にする
      this.exec(`INSERT INTO games (id, a, b, known, created, rep_a, at_a) VALUES (?, ?, '', 0, ?, ?, ?)`, r.matchId, r.playerId, now, r.winner, r.at);
      return Response.json({ ok: true, state: 'wait' });
    }
    // どちらの欄か（受付係の知らない試合の2人目は b）
    const side = r.playerId === g.a ? 'a' : r.playerId === g.b || (g.known === 0 && g.b === '') ? 'b' : null;
    if (!side) return Response.json({ ok: false, error: 'not-player' }, { status: 403 });
    // 同じ人の2回目の報告は、最初のものを残す（送り直しで中身を変えられないように）
    if ((side === 'a' ? g.rep_a : g.rep_b) !== null) return Response.json({ ok: true, state: 'wait' });
    const next: GameRow = side === 'a' ? { ...g, rep_a: r.winner, at_a: r.at } : { ...g, b: r.playerId, rep_b: r.winner, at_b: r.at };
    const reports = Matchmaker.reportsOf(next);
    const d = reports.length >= 2 ? decide(match, reports, now) : ({ kind: 'wait' } as const);
    if (d.kind === 'drop') {
      this.exec(`DELETE FROM games WHERE id = ?`, g.id);
      return Response.json({ ok: true, state: 'drop' });
    }
    const win = d.kind === 'record' ? d.row : null;
    this.exec(
      `UPDATE games SET b = ?, rep_a = ?, at_a = ?, rep_b = ?, at_b = ?, winner = ?, at = ? WHERE id = ?`,
      next.b,
      next.rep_a,
      next.at_a,
      next.rep_b,
      next.at_b,
      win?.winner ?? null,
      win?.at ?? null,
      g.id,
    );
    return Response.json({ ok: true, state: d.kind });
  }

  /**
   * まとめ処理の前半：10分たった片方だけの報告・古い試合を片づけてから、記録した結果を全部渡す（時刻順）
   */
  private exportResults(now: number): ResultRow[] {
    const out: ResultRow[] = [];
    for (const g of this.exec<GameRow>(`SELECT * FROM games`)) {
      if (g.winner !== null) {
        out.push({ matchId: g.id, a: g.a, b: g.b, winner: g.winner, at: Number(g.at), known: g.known === 1 });
        continue;
      }
      const d = decide(Matchmaker.matchOf(g), Matchmaker.reportsOf(g), now);
      if (d.kind === 'drop') this.exec(`DELETE FROM games WHERE id = ?`, g.id);
      if (d.kind === 'record') {
        this.exec(`UPDATE games SET winner = ?, at = ? WHERE id = ?`, d.row.winner, d.row.at, g.id);
        out.push({ ...d.row, known: g.known === 1 });
      }
    }
    out.sort((x, y) => x.at - y.at || (x.matchId < y.matchId ? -1 : x.matchId > y.matchId ? 1 : 0));
    return out;
  }

  /** まとめ処理の後半：D1 に書けた結果（試合ID）を消す */
  private ack(ids: string[]): void {
    // 記録した結果だけを消す（まだ報告を待っている試合は残す）。1つの文が大きくなりすぎないように分ける
    for (let i = 0; i < ids.length; i += 2000)
      this.exec(`DELETE FROM games WHERE winner IS NOT NULL AND id IN (SELECT value FROM json_each(?))`, JSON.stringify(ids.slice(i, i + 2000)));
  }

  /** 確かめる時用：結果を直接入れる（負荷の見積もり・テスト。管理キーが要る） */
  private async debugSeed(req: Request): Promise<Response> {
    const body = (await req.json().catch(() => null)) as { results?: { a: string; b: string; winner: string; at: number }[] } | null;
    let n = 0;
    for (const r of body?.results ?? []) {
      this.exec(`INSERT INTO games (id, a, b, known, created, winner, at) VALUES (?, ?, ?, 1, ?, ?, ?)`, randomHex(8), r.a, r.b, r.at, r.winner, r.at);
      n += 1;
    }
    return Response.json({ ok: true, inserted: n });
  }
}
