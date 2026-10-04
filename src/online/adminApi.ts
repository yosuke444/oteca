import { apiBase } from '../config/api';

/**
 * 管理者メニュー（v2.0-J。SPEC §7 S20）とサーバーの やりとり。
 * パスワード（管理キー）は Worker が確かめる。端末には覚えない（ログインで受け取る「管理の合言葉」だけを、タブの間だけ覚える）。
 */

const SESSION_KEY = 'oteca.adminSession';
const TIMEOUT_MS = 10000;

type Session = { session: string; expires: number };

function readSession(): Session | null {
  try {
    const s = JSON.parse(sessionStorage.getItem(SESSION_KEY) ?? 'null') as Session | null;
    return s && typeof s.session === 'string' && s.expires > Date.now() ? s : null;
  } catch {
    return null;
  }
}

function writeSession(s: Session | null): void {
  try {
    if (s) sessionStorage.setItem(SESSION_KEY, JSON.stringify(s));
    else sessionStorage.removeItem(SESSION_KEY);
  } catch {
    // 覚えられなくても、今の画面では使える
  }
}

/** このタブで管理者メニューに入っているか（ページを閉じるまで） */
export function isAdmin(): boolean {
  return readSession() !== null;
}

/** 管理者メニューから出る（サーバーの合言葉も消す。つながらなくても、端末からは消す） */
export function logoutAdmin(): void {
  const s = readSession();
  writeSession(null);
  if (s) void call('/admin/logout', { session: s.session }, { 'x-admin-session': s.session });
}

export type AdminResult<T> = { ok: true; data: T } | { ok: false; status: number; data: Record<string, unknown> | null };

async function call<T>(path: string, body: unknown, headers: Record<string, string> = {}): Promise<AdminResult<T>> {
  const base = apiBase();
  if (!base) return { ok: false, status: 0, data: null };
  const ctl = new AbortController();
  const id = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${base}${path}`, { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'text/plain;charset=UTF-8', ...headers }, signal: ctl.signal });
    const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    return res.ok ? { ok: true, data: data as T } : { ok: false, status: res.status, data };
  } catch {
    return { ok: false, status: 0, data: null };
  } finally {
    clearTimeout(id);
  }
}

/**
 * パスワードで入る。正しければ「管理の合言葉」をタブの間だけ覚える
 * @returns ok／wrong（あと left 回）／locked（until まで入れない）／offline
 */
export async function loginAdmin(password: string): Promise<{ kind: 'ok' } | { kind: 'wrong'; left: number } | { kind: 'locked'; until: number } | { kind: 'offline' }> {
  const r = await call<Session>('/admin-login', { password });
  if (r.ok) {
    writeSession({ session: r.data.session, expires: r.data.expires });
    return { kind: 'ok' };
  }
  if (r.status === 423) return { kind: 'locked', until: Number(r.data?.until ?? 0) };
  if (r.status === 401) return { kind: 'wrong', left: Number(r.data?.left ?? 0) };
  return { kind: 'offline' };
}

/** 管理者の道を呼ぶ（合言葉が切れていたら忘れる） */
export async function adminCall<T>(path: string, body: unknown = {}): Promise<AdminResult<T>> {
  const s = readSession();
  if (!s) return { ok: false, status: 401, data: null };
  const r = await call<T>(path, body, { 'x-admin-session': s.session });
  if (!r.ok && (r.status === 401 || r.status === 423)) writeSession(null);
  return r;
}
