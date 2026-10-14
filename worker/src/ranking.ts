import { safeName } from '../../src/online/names';
import { RANKING } from '../../src/config/rating';
import { HIDE_AFTER_MS, type Player, runBatch } from './logic/batch';
import type { ResultRow } from './logic/results';
import { randomHex, sha256Hex } from './util';

/**
 * ランキングのデータベース（D1）を書く処理（UPDATE_v2 §10・SPEC §11-9）。
 * まとめ処理は受付係（Durable Object）の中で動かす（Worker の CPU 時間は1回10ミリ秒まで、Durable Object は30秒まで。
 * 試合の多い日でも止まらないように）。名前を消した時の写しの作り直しは Worker からも呼ぶ。
 */

/** ランキングに載せる人数 */
export const TOP_N = RANKING.top;

export type PlayerRow = {
  /** ユーザーID（v2.0-J。それより前に登録して、まだ付け替えていない人は playerId） */
  id: string;
  rate: number;
  wins: number;
  losses: number;
  best: number;
  name: string;
  opt_in: number;
  name_banned: number;
  last_played: number;
  rank: number | null;
  last_match: string;
};

/** D1 のうち、使う所だけ（ゲームのテストからも型を確かめられるように） */
type D1Meta = { rows_read?: number; rows_written?: number; changes?: number };
type D1Stmt = { bind(...values: unknown[]): D1Stmt; all<T>(): Promise<{ results: T[]; meta: D1Meta }>; run(): Promise<{ meta: D1Meta }> };
type D1Like = { prepare(q: string): D1Stmt; batch(stmts: D1Stmt[]): Promise<{ meta: D1Meta }[]> };

/** D1 を、読み書きした行数を数えながら使う（負荷の見積もり用） */
export class Db {
  read = 0;
  written = 0;
  constructor(private readonly d1: D1Like) {}

  async all<T>(q: string, ...binds: unknown[]): Promise<T[]> {
    const r = await this.d1.prepare(q).bind(...binds).all<T>();
    this.read += r.meta.rows_read ?? 0;
    this.written += r.meta.rows_written ?? 0;
    return r.results;
  }

  /** いくつかの文を1つの取引で（途中で失敗したら全部やめる） */
  async batch(stmts: { q: string; binds: unknown[] }[]): Promise<void> {
    if (!stmts.length) return;
    const rs = await this.d1.batch(stmts.map((s) => this.d1.prepare(s.q).bind(...s.binds)));
    for (const r of rs) {
      this.read += r.meta.rows_read ?? 0;
      this.written += r.meta.rows_written ?? 0;
    }
  }

  async run(q: string, ...binds: unknown[]): Promise<{ meta: D1Meta }> {
    const r = await this.d1.prepare(q).bind(...binds).run();
    this.read += r.meta.rows_read ?? 0;
    this.written += r.meta.rows_written ?? 0;
    return r;
  }
}

/** 受付係の保存領域（まとめ処理の前半と後半） */
export type LobbyStore = {
  /** 10分たった片方だけの報告などを片づけてから、記録した結果を時刻順に */
  exportResults(now: number): ResultRow[];
  /** D1 に書けた結果を消す */
  ack(matchIds: string[]): void;
  /** D1 に書く途中の印（まとめ処理の番号と、処理する試合ID）。null で消す */
  pending(): Pending | null;
  setPending(p: Pending | null): void;
  /** その日に数えた数（予備の試合。1日2回の まとめ処理をまたいで数えるため） */
  dayCounts(): Map<string, number>;
  /** 数えた数を書く（変わった分だけ）。古い日の分は消す */
  saveDayCounts(changed: [string, number][], now: number): void;
};

export type Pending = { id: string; matchIds: string[] };

/**
 * 上位100人の写しを作る（禁止語・消された名前は ''。画面が「ななし」と出す。「ランキングに のる」がオフの人は順位が無いので入らない。v2.2）
 * @param updatedAt 更新の時刻（null は前の写しの時刻のまま。名前を消した時）
 */
export async function writeSnapshot(c: Db, updatedAt: number | null): Promise<number> {
  const rows = await c.all<PlayerRow>(`SELECT * FROM players WHERE rank IS NOT NULL ORDER BY rank, id LIMIT ${TOP_N}`);
  const top = await Promise.all(
    rows.map(async (r) => ({
      rank: r.rank,
      // 自分の行を見分けるための印（ユーザーID そのものは出さない）
      key: (await sha256Hex(r.id)).slice(0, 12),
      name: r.name_banned === 0 ? safeName(r.name, '') : '',
      rate: r.rate,
      wins: r.wins,
      losses: r.losses,
    })),
  );
  let at = updatedAt;
  if (at === null) {
    const prev = (await c.all<{ value: string }>(`SELECT value FROM meta WHERE key = 'ranking'`))[0];
    at = prev ? (JSON.parse(prev.value) as { updatedAt: number }).updatedAt : 0;
  }
  await c.run(`INSERT INTO meta (key, value) VALUES ('ranking', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, JSON.stringify({ top, updatedAt: at }));
  return top.length;
}

/**
 * まとめ処理（毎日 日本時間 4:00 と 16:00。UPDATE_v2 §10）：前回の まとめ処理より後に記録した
 * 受付係の結果を時刻順に読む → レートを計算（同じ2人の試合もすべて数える。v2.7）→ プレイヤー表を1人1行で更新 →
 * 全員の順位（7日以上遊んでいない人は外す）→ 上位100人の写し → 処理した結果を消す
 */
/**
 * @param chunk 1回で計算する試合の数（v2.7。多い時は古い方から。残りは remaining で返す。前の回の続きの片づけには使わない）
 */
export async function runBatchJob(c: Db, lobby: LobbyStore, now: number, chunk = Infinity): Promise<Record<string, unknown>> {
  // 前の まとめ処理が D1 に書いた後で止まっていたら、その分の結果を消してから始める（二重に数えない）
  const prev = lobby.pending();
  if (prev) {
    const done = (await c.all<{ value: string }>(`SELECT value FROM meta WHERE key = 'batch'`))[0]?.value === prev.id;
    if (done) {
      // D1 には書けていた：その結果の「その日に数えた数」を計算し直して、結果を消すのと一緒に書く
      const ids = new Set(prev.matchIds);
      const before = lobby.dayCounts();
      const again = runBatch(new Map(), lobby.exportResults(now).filter((r) => ids.has(r.matchId)), now, before).counts;
      lobby.ack(prev.matchIds);
      lobby.saveDayCounts([...again].filter(([k, v]) => before.get(k) !== v), now);
    }
    lobby.setPending(null);
  }
  const every = lobby.exportResults(now);
  const all = every.slice(0, chunk);
  const remaining = every.length - all.length;
  // 停止中の人（v2.0-J）の試合は数えない（結果は消す）
  const suspended = new Set(
    (await c.all<{ user_id: string }>(`SELECT user_id FROM suspensions WHERE until = 0 OR until > ?`, now)).map((r) => r.user_id),
  );
  const results = all.filter((r) => !suspended.has(r.a) && !suspended.has(r.b));
  const batchId = randomHex(8);
  const stmts: { q: string; binds: unknown[] }[] = [];
  let changed = 0;
  let counted = 0;
  let skipped = 0;
  let countChanges: [string, number][] = [];
  if (results.length) {
    const ids = [...new Set(results.flatMap((r) => [r.a, r.b]))];
    const rows = await c.all<PlayerRow>(
      `SELECT id, rate, wins, losses, best, last_played FROM players WHERE id IN (SELECT value FROM json_each(?))`,
      JSON.stringify(ids),
    );
    const map = new Map<string, Player>(rows.map((r) => [r.id, { id: r.id, rate: r.rate, wins: r.wins, losses: r.losses, best: r.best, lastPlayed: r.last_played }]));
    const before = lobby.dayCounts();
    const out = runBatch(map, results, now, before);
    countChanges = [...out.counts].filter(([k, v]) => before.get(k) !== v);
    counted = out.counted;
    skipped = out.skipped;
    changed = out.changed.length;
    // 1人1行で更新する。まとめて1つの文で（D1 は1回の呼び出しで使える文の数に上限があるので）。登録の無い人は作る
    const CHUNK = 500;
    for (let i = 0; i < out.changed.length; i += CHUNK) {
      const part = JSON.stringify(out.changed.slice(i, i + CHUNK).map((x) => [x.id, x.rate, x.wins, x.losses, x.best, x.lastPlayed, x.lastMatch ?? '']));
      stmts.push({
        q: `INSERT INTO players (id, token_hash, rate, wins, losses, best, last_played, last_match, created)
         SELECT json_extract(value, '$[0]'), '', json_extract(value, '$[1]'), json_extract(value, '$[2]'), json_extract(value, '$[3]'), json_extract(value, '$[4]'), json_extract(value, '$[5]'), json_extract(value, '$[6]'), ?
         FROM json_each(?) WHERE true
         ON CONFLICT(id) DO UPDATE SET rate = excluded.rate, wins = excluded.wins, losses = excluded.losses, best = excluded.best, last_played = excluded.last_played, last_match = excluded.last_match`,
        binds: [now, part],
      });
    }
  }
  // プレイヤー表・順位・「どの まとめ処理まで書いたか」を1つの取引で書く
  stmts.push(...rerankStmts(now));
  stmts.push({ q: `INSERT INTO meta (key, value) VALUES ('batch', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, binds: [batchId] });
  const ids = all.map((r) => r.matchId);
  if (ids.length) lobby.setPending({ id: batchId, matchIds: ids });
  await c.batch(stmts);
  // D1 に書けたので、受付係の結果を消し、その日に数えた数を書く（同じ時に）
  if (ids.length) {
    lobby.ack(ids);
    lobby.saveDayCounts(countChanges, now);
  }
  lobby.setPending(null);
  const top = await writeSnapshot(c, now);
  // skipped：予備の待合所の試合で1日10試合を超えたもの ＋ 停止中の人の試合
  return { ok: true, results: all.length, counted, skipped: skipped + (all.length - results.length), changed, top, remaining };
}

/** 全員の順位：7日以上遊んでいない人は外す（データは残す）。変わった人の行だけ書く */
export async function rerank(c: Db, now: number): Promise<void> {
  await c.batch(rerankStmts(now));
}

function rerankStmts(now: number): { q: string; binds: unknown[] }[] {
  const cutoff = now - HIDE_AFTER_MS;
  /** 停止中の人（v2.0-J。ランキングに載せない） */
  const suspended = `SELECT user_id FROM suspensions WHERE until = 0 OR until > ?`;
  // 「ランキングに のる」がオフの人（opt_in = 0。v2.2）も載せない（順位も付けない。レートは計算している）
  return [
    { q: `UPDATE players SET rank = NULL WHERE rank IS NOT NULL AND (last_played <= ? OR opt_in = 0 OR id IN (${suspended}))`, binds: [cutoff, now] },
    {
      q: `UPDATE players SET rank = t.r FROM (SELECT id, RANK() OVER (ORDER BY rate DESC) AS r FROM players WHERE last_played > ? AND opt_in = 1 AND id NOT IN (${suspended})) AS t
     WHERE players.id = t.id AND (players.rank IS NULL OR players.rank != t.r)`,
      binds: [cutoff, now],
    },
  ];
}
