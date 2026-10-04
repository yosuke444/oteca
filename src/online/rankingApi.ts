import { apiBase } from '../config/api';
import { nextBatchAt } from './batchTime';
import { newUserId } from '../save/userId';
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

/** 名前を載せる時だけ名前を送る（載せない設定なら送らない） */
function profileName(save: Pick<SaveData, 'playerName' | 'ranking'>): string {
  return save.ranking.optIn ? save.playerName : '';
}

/** 自分の判別（ユーザーID と token） */
export type Identity = { token: string; userId: string };

/** 登録して token を使えるようにする（ensureIdentity の token だけ） */
export async function ensureToken(save: SaveData, update: Update): Promise<string> {
  return (await ensureIdentity(save, update))?.token ?? '';
}

/** 登録の途中（同じ時に2回登録しないように、1つにまとめる） */
let registering: { userId: string; promise: Promise<Identity | null> } | null = null;
/** この起動で登録できた ID（画面の描き直しの前の古いセーブで聞かれても、同じ答えを返す。from は作り直す前の ID） */
let registered: (Identity & { from: string }) | null = null;

/** テスト用：覚えている登録を忘れる */
export function forgetRegistration(): void {
  registering = null;
  registered = null;
}

/**
 * ユーザーID をサーバーに登録する（v2.0-J。初めてサーバーにつながった時。SPEC §11-9）。
 * - token は起動の時に端末が作ってセーブに入れてある（送り直しても同じ token。サーバーにはハッシュだけを覚えてもらう）。
 * - そのユーザーID がほかの人に使われていたら（409）、登録の前だけユーザーID を作り直して登録し直す。登録できた後は変えない。
 * - 今までの人（v2.0-I で登録した playerId）の行は、token が合えばサーバーがユーザーID に付け替える（レート・勝敗を引き継ぐ）。
 * - 同じ時に何回呼んでも、登録は1回にまとめる。
 * @returns 登録できたユーザーID と token。つながらない時は null（画面の描き直しの前に使えるように返す）
 */
export async function ensureIdentity(save: SaveData, update: Update): Promise<Identity | null> {
  if (!save.userId || !save.ranking.token) return null;
  if (save.userIdRegistered) return { token: save.ranking.token, userId: save.userId };
  if (registered && (registered.from === save.userId || registered.userId === save.userId)) return { token: registered.token, userId: registered.userId };
  if (registering && registering.userId === save.userId) return registering.promise;
  const promise = registerUser(save, update, true).finally(() => {
    if (registering?.promise === promise) registering = null;
  });
  registering = { userId: save.userId, promise };
  return promise;
}

/**
 * 登録を送る
 * @param allowNewId 409 の時にユーザーID を作り直してよいか（一度も登録できていない時だけ）
 */
async function registerUser(save: SaveData, update: Update, allowNewId: boolean): Promise<Identity | null> {
  const from = save.userId;
  const token = save.ranking.token;
  let userId = from;
  for (let i = 0; i < 3; i++) {
    const res = await post('/register', {
      userId,
      token,
      // 今までの人：v2.0-I で登録した playerId（サーバーに、その playerId と同じ token の行があれば付け替える。無ければ何もしない）
      ...(/^[0-9a-f]{16}$/.test(save.playerId) ? { legacyPlayerId: save.playerId } : {}),
      name: profileName(save),
      optIn: save.ranking.optIn,
    });
    if (res?.status === 409) {
      if (!allowNewId) return null;
      // ほかの人のユーザーID：作り直す（まだ登録していないので変えてよい）
      userId = newUserId();
      continue;
    }
    if (!res || !res.ok) return null;
    const changed = userId !== from;
    registered = { userId, token, from };
    update((d) => {
      // 登録の途中で、引き継ぎコードで別のセーブに入れ替えていたら書かない
      if (d.userId !== from || d.ranking.token !== token) return;
      d.userId = userId;
      d.userIdRegistered = true;
      // 前のユーザーID で書いた送れなかった報告は、もう送れない
      if (changed) d.ranking.unsent = [];
    });
    return { token, userId };
  }
  return null;
}

/** サーバーに自分の行が無かった（401）：同じユーザーID と token で登録し直す（ユーザーID は変えない） */
async function registerAgain(save: SaveData, update: Update, id: Identity): Promise<boolean> {
  return !!(await registerUser({ ...save, userId: id.userId, ranking: { ...save.ranking, token: id.token } }, update, false));
}

/**
 * 1つの報告を送る
 * @returns ok＝受け付けた、drop＝送り直しても意味がない（試合の2人でない・形が変）、retry＝あとで送り直す、auth＝token が使えない
 */
export async function sendReport(save: Pick<SaveData, 'userId' | 'ranking'>, r: UnsentReport): Promise<'ok' | 'drop' | 'retry' | 'auth'> {
  if (!save.ranking.token) return 'retry';
  const res = await post('/result', { matchId: r.matchId, userId: save.userId, token: save.ranking.token, winner: r.winner });
  if (!res) return 'retry';
  if (res.ok) return 'ok';
  // token が使えない（サーバーのデータベースを作り直した時など）：次に登録し直す
  if (res.status === 401) return 'auth';
  // 400・403（試合の2人でない・停止中）は送り直さない
  if (res.status === 400 || res.status === 403) return 'drop';
  return 'retry';
}

/** 送れなかった報告を送り直す（起動した時・次の試合の後）。送れたものはセーブから消す */
let flushing = false;
export async function flushReports(getSave: () => SaveData, update: Update, known?: Identity): Promise<void> {
  if (flushing) return;
  flushing = true;
  try {
    const save = getSave();
    if (!save.ranking.unsent.length) return;
    const id = known ?? (await ensureIdentity(save, update));
    if (!id) return;
    // 登録した直後は、画面の描き直しの前なのでセーブがまだ古い：もらった token と今のユーザーID を直接使う
    for (const u of [...getSave().ranking.unsent]) {
      const r = decodeUnsent(u);
      if (!r) {
        update((d) => void (d.ranking.unsent = d.ranking.unsent.filter((x) => x !== u)));
        continue;
      }
      const cur = getSave();
      const got = await sendReport({ userId: id.userId, ranking: { ...cur.ranking, token: id.token } }, r);
      if (got === 'retry') break;
      if (got === 'auth') {
        // サーバーに自分の行が無い（データベースを作り直した時など）：同じユーザーID と token で登録し直す（ユーザーID は変えない）
        if (await registerAgain(cur, update, id)) continue;
        update((d) => removeReport(d, r.matchId));
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
  if (!save.userIdRegistered) return false;
  const res = await post('/profile', { userId: save.userId, token: save.ranking.token, name: profileName(save), optIn: save.ranking.optIn });
  return !!res?.ok;
}

function authQuery(save: Pick<SaveData, 'userId' | 'userIdRegistered' | 'ranking'>): string {
  if (!save.ranking.token || !save.userIdRegistered) return '';
  return `?userId=${save.userId}&token=${save.ranking.token}`;
}

/** 自分の正式なデータ（GET /me） */
export async function fetchMe(save: SaveData): Promise<{ me: ServerMe | null; updatedAt: number; nextAt: number } | null> {
  if (!save.ranking.token || !save.userIdRegistered) return null;
  const res = await call(`/me${authQuery(save)}`);
  if (!res?.ok) return null;
  return (await res.json().catch(() => null)) as { me: ServerMe | null; updatedAt: number; nextAt: number } | null;
}

/**
 * 起動した時：ユーザーID を登録し（初めての時）、送れなかった報告を送り、次の更新の後なら正式なレートで上書きする（SPEC §7 S15）。
 * 名前・載せる設定がサーバーと違えば知らせる
 */
export async function syncRanking(getSave: () => SaveData, update: Update): Promise<Identity | null> {
  const id = await ensureIdentity(getSave(), update);
  if (!id) return null;
  await flushReports(getSave, update, id);
  // 登録した直後は、画面の描き直しの前なのでセーブがまだ古い
  const save = { ...getSave(), userId: id.userId, userIdRegistered: true, ranking: { ...getSave().ranking, token: id.token } };
  // 開くたびに聞く（1回 D1 の数行）。同じ更新で2回上書きしないのは applyServerRate が受け取った時刻で決める
  // （次の更新の時刻まで聞かない、にすると、まとめ処理を手で動かした時に受け取れなくなる）
  const got = await fetchMe(save);
  if (!got?.me) return id;
  const me = got.me;
  update((d) => void applyServerRate(d, me, got.updatedAt, Date.now()));
  const cur = getSave();
  if (me.optIn !== cur.ranking.optIn || me.name !== profileName(cur)) void sendProfile(cur);
  return id;
}

/** その時刻の次の まとめ処理（日本時間 4:00 か 14:00 の近い方）の時刻 */
export function nextBatchAfter(ms: number): number {
  return nextBatchAt(ms);
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
  // 保存した一覧が誰のものか（ユーザーID）
  const c: RankingCache = { ...body, playerId: save.userId, savedAt: Date.now() };
  writeRankingCache(c);
  return c;
}

/** 自分の行の印（サーバーと同じ：ユーザーID の SHA-256 の先頭12文字） */
export async function myRowKey(userId: string): Promise<string> {
  return toHex(await sha256(new TextEncoder().encode(userId))).slice(0, 12);
}
