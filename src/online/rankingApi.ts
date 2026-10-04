import { apiBase } from '../config/api';
import { sha256, toHex } from '../net/sha256';
import type { SaveData } from '../save/saveData';
import { type RankingData, type ServerMe, type UnsentReport, applyServerRate, decodeUnsent, removeReport } from './ranking';

/**
 * ランキングのサーバー（oteca-api）との やりとり（v2.0-I。SPEC §11-9）。
 * つながらない時は null や 'retry' を返すだけで、エラーは投げない（遊びを止めない）。
 */

/** 1回のリクエストを待つ時間 */
const TIMEOUT_MS = 8000;

type Update = (fn: (d: SaveData) => void) => void;

async function call(path: string, init?: RequestInit): Promise<Response | null> {
  const base = apiBase();
  if (!base) return null;
  const ctl = new AbortController();
  const id = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    // 「単純なリクエスト」にする（GET は見出しなし、POST は text/plain）。事前確認（OPTIONS）が飛ばず、Worker へのリクエストが増えない
    return await fetch(`${base}${path}`, { ...init, signal: ctl.signal });
  } catch {
    return null;
  } finally {
    clearTimeout(id);
  }
}

const post = (path: string, body: unknown) => call(path, { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'text/plain;charset=UTF-8' } });

/** 新しい playerId（8バイトの16進数） */
function newPlayerId(): string {
  const b = new Uint8Array(8);
  crypto.getRandomValues(b);
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
}

/** 名前を載せる時だけ名前を送る（載せない設定なら送らない） */
function profileName(save: Pick<SaveData, 'playerName' | 'ranking'>): string {
  return save.ranking.optIn ? save.playerName : '';
}

/**
 * 登録して token をもらう（初めてレート対戦をする時。token はセーブに入る）。
 * その playerId がもう登録されていた（409。token をなくした・他人に先に登録された）時は、playerId を作り直して登録し直す
 * （まだ送れていない報告は、前の playerId の試合なので捨てる）。
 * @returns token。つながらない時は ''
 */
export async function ensureToken(save: SaveData, update: Update): Promise<string> {
  return (await ensureIdentity(save, update))?.token ?? '';
}

/** ensureToken と同じ。作り直した playerId も返す（画面の描き直しの前に使う時） */
export async function ensureIdentity(save: SaveData, update: Update): Promise<{ token: string; playerId: string } | null> {
  if (save.ranking.token) return { token: save.ranking.token, playerId: save.playerId };
  if (!save.playerId) return null;
  let playerId = save.playerId;
  for (let i = 0; i < 2; i++) {
    const res = await post('/register', { playerId, name: profileName(save), optIn: save.ranking.optIn });
    if (res?.status === 409) {
      playerId = newPlayerId();
      continue;
    }
    if (!res || !res.ok) return null;
    const body = (await res.json().catch(() => null)) as { token?: unknown } | null;
    const token = typeof body?.token === 'string' && /^[0-9a-f]{32}$/.test(body.token) ? body.token : '';
    if (!token) return null;
    const changed = playerId !== save.playerId;
    update((d) => {
      d.ranking.token = token;
      if (changed) {
        d.playerId = playerId;
        d.ranking.unsent = [];
      }
    });
    return { token, playerId };
  }
  return null;
}

/**
 * 1つの報告を送る
 * @returns ok＝受け付けた、drop＝送り直しても意味がない（試合の2人でない・形が変）、retry＝あとで送り直す
 */
export async function sendReport(save: Pick<SaveData, 'playerId' | 'ranking'>, r: UnsentReport): Promise<'ok' | 'drop' | 'retry' | 'auth'> {
  if (!save.ranking.token) return 'retry';
  const res = await post('/result', { matchId: r.matchId, playerId: save.playerId, token: save.ranking.token, winner: r.winner });
  if (!res) return 'retry';
  if (res.ok) return 'ok';
  // token が使えない（サーバーのデータベースを作り直した時など）：token を消して、次に登録し直す
  if (res.status === 401) return 'auth';
  // 401（token の誤り）・400・403（試合の2人でない）は送り直さない
  if (res.status === 400 || res.status === 401 || res.status === 403) return 'drop';
  return 'retry';
}

/** 送れなかった報告を送り直す（起動した時・次の試合の後）。送れたものはセーブから消す */
let flushing = false;
export async function flushReports(getSave: () => SaveData, update: Update): Promise<void> {
  if (flushing) return;
  flushing = true;
  try {
    const save = getSave();
    if (!save.ranking.unsent.length) return;
    const id = await ensureIdentity(save, update);
    if (!id) return;
    const { token } = id;
    // 登録した直後は、画面の描き直しの前なのでセーブがまだ古い：もらった token と今の playerId を直接使う
    for (const u of [...getSave().ranking.unsent]) {
      const r = decodeUnsent(u);
      if (!r) {
        update((d) => void (d.ranking.unsent = d.ranking.unsent.filter((x) => x !== u)));
        continue;
      }
      const cur = getSave();
      const got = await sendReport({ playerId: id.playerId, ranking: { ...cur.ranking, token } }, r);
      if (got === 'retry') break;
      if (got === 'auth') {
        update((d) => {
          d.ranking.token = '';
          removeReport(d, r.matchId);
        });
        break;
      }
      update((d) => removeReport(d, r.matchId));
    }
  } finally {
    flushing = false;
  }
}

/** 名前・載せる設定をサーバーに知らせる（設定を変えた時。次の更新から反映） */
export async function sendProfile(save: SaveData): Promise<boolean> {
  if (!save.ranking.token) return false;
  const res = await post('/profile', { playerId: save.playerId, token: save.ranking.token, name: profileName(save), optIn: save.ranking.optIn });
  return !!res?.ok;
}

function authQuery(save: Pick<SaveData, 'playerId' | 'ranking'>): string {
  if (!save.ranking.token || !save.playerId) return '';
  return `?playerId=${save.playerId}&token=${save.ranking.token}`;
}

/** 自分の正式なデータ（GET /me） */
export async function fetchMe(save: SaveData): Promise<{ me: ServerMe | null; updatedAt: number; nextAt: number } | null> {
  if (!save.ranking.token) return null;
  const res = await call(`/me${authQuery(save)}`);
  if (!res?.ok) return null;
  return (await res.json().catch(() => null)) as { me: ServerMe | null; updatedAt: number; nextAt: number } | null;
}

/**
 * 起動した時：送れなかった報告を送り、次の更新の後なら正式なレートで上書きする（SPEC §7 S15）。
 * 名前・載せる設定がサーバーと違えば知らせる
 */
export async function syncRanking(getSave: () => SaveData, update: Update): Promise<void> {
  await flushReports(getSave, update);
  const save = getSave();
  if (!save.ranking.token) return;
  // もう今の更新の正式なレートを受け取った後（次の 4:00 がまだ来ていない）なら聞かない。
  // 受け取っていない人（まだ数えられていない・まとめ処理を手で動かした）は、開くたびに聞く（1回 D1 の2行）
  if (save.ranking.syncedAt && Date.now() < nextBatchAfter(save.ranking.syncedAt)) return;
  const got = await fetchMe(save);
  if (!got?.me) return;
  const me = got.me;
  update((d) => void applyServerRate(d, me, got.updatedAt, Date.now()));
  const cur = getSave();
  if (me.optIn !== cur.ranking.optIn || me.name !== profileName(cur)) void sendProfile(cur);
}

/** その時刻の次の まとめ処理（日本時間 4:00）の時刻 */
export function nextBatchAfter(ms: number): number {
  const JST = 9 * 60 * 60 * 1000;
  const d = new Date(ms + JST);
  let t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 4) - JST;
  if (t <= ms) t += 24 * 60 * 60 * 1000;
  return t;
}

/** ランキングの一覧を保存しておく所（端末ごと。セーブには入れない） */
const CACHE_KEY = 'oteca.rankingCache';

export type RankingCache = RankingData & { playerId: string; savedAt: number };

export function readRankingCache(): RankingCache | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const c = JSON.parse(raw) as RankingCache;
    return Array.isArray(c?.top) && Number.isFinite(c.nextAt) ? c : null;
  } catch {
    return null;
  }
}

function writeRankingCache(c: RankingCache): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(c));
  } catch {
    // 保存できなくても表示はできる
  }
}

/** ランキングの一覧を聞く（つながらない時は null）。聞けたら保存する */
export async function fetchRanking(save: SaveData): Promise<RankingCache | null> {
  const res = await call(`/ranking${authQuery(save)}`);
  if (!res?.ok) return null;
  const body = (await res.json().catch(() => null)) as RankingData | null;
  if (!body || !Array.isArray(body.top)) return null;
  const c: RankingCache = { ...body, playerId: save.playerId, savedAt: Date.now() };
  writeRankingCache(c);
  return c;
}

/** 自分の行の印（サーバーと同じ：playerId の SHA-256 の先頭12文字） */
export async function myRowKey(playerId: string): Promise<string> {
  return toHex(await sha256(new TextEncoder().encode(playerId))).slice(0, 12);
}
