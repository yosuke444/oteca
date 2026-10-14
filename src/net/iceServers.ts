import { apiBase } from '../config/api';

/**
 * TURN の接続先（v2.7）：直接つながらない回線（携帯の回線など）でも WebRTC でつながるように、Worker（/turn）から
 * Cloudflare Realtime の TURN の合言葉をもらう。オンラインの画面を開いた時に先にもらっておく（部屋に入る時に待たない）。
 * もらえない時（Worker に TURN キーが無い・つながらない）は、今まで通り STUN だけ
 */

/** もらった合言葉を使う時間（Worker は3時間使えるものを作り、30分は同じものを返す。足しても対戦の途中で切れない） */
const REUSE_MS = 30 * 60 * 1000;

let cache: { at: number; servers: RTCIceServer[] } | null = null;
let loading: Promise<void> | null = null;

/** 形を確かめる（urls が文字列か文字列の並び） */
export function cleanIceServers(x: unknown): RTCIceServer[] {
  if (!Array.isArray(x)) return [];
  return x.filter((s): s is RTCIceServer => {
    if (!s || typeof s !== 'object') return false;
    const u = (s as { urls?: unknown }).urls;
    return typeof u === 'string' || (Array.isArray(u) && u.every((v) => typeof v === 'string'));
  }).map((s) => {
    // ポート53の TURN は、ブラウザによっては待たされるので使わない（Cloudflare の すすめ）
    const urls = (Array.isArray(s.urls) ? s.urls : [s.urls]).filter((u) => !/:53(\?|$)/.test(u));
    return { ...s, urls };
  }).filter((s) => (s.urls as string[]).length > 0);
}

/**
 * TURN の合言葉を先にもらっておく（何回呼んでも30分に1回）。登録した人（ユーザーID と token）だけがもらえる
 */
export function prefetchTurn(who: { userId: string; ranking: { token: string } }, fetchFn: typeof fetch = fetch, now = Date.now()): Promise<void> {
  const base = apiBase();
  if (!base || !who.userId || !who.ranking.token || (cache && now - cache.at < REUSE_MS)) return Promise.resolve();
  if (loading) return loading;
  // AbortSignal.timeout の無いブラウザ（古い Safari）でも動くように
  const ctl = typeof AbortController === 'undefined' ? null : new AbortController();
  const timer = ctl ? setTimeout(() => ctl.abort(), 4000) : null;
  const q = `?userId=${encodeURIComponent(who.userId)}&token=${encodeURIComponent(who.ranking.token)}`;
  loading = fetchFn(`${base}/turn${q}`, { cache: 'no-store', ...(ctl ? { signal: ctl.signal } : {}) })
    .then(async (res) => {
      const b = res.ok ? ((await res.json()) as { iceServers?: unknown }) : null;
      const servers = cleanIceServers(b?.iceServers);
      if (servers.length) cache = { at: now, servers };
    })
    .catch(() => {})
    .finally(() => {
      if (timer) clearTimeout(timer);
      loading = null;
    });
  return loading;
}

/** 今もらっている TURN の接続先（無ければ空） */
export function turnServers(): RTCIceServer[] {
  return cache?.servers ?? [];
}
