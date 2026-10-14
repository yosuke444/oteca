import { useSyncExternalStore } from 'react';
import { buildId, protocolVersion } from '../config/version';

/**
 * 新しい版のお知らせ（v2.7。SPEC §12-7）
 * 公開している version.json（{ build, protocol }。vite.config.ts の buildInfo が作る）を取りに行き、
 * 自分のビルドID と違えば「あたらしい バージョンが あります」。
 * - 確かめる時：開いた時・メニューに戻った時・タブが表に戻った時・開いたままなら10分ごと
 * - ブラウザの保存（キャッシュ）は使わない（cache: 'no-store' と、URL の後ろに時刻）
 * - 取れなかった時（オフラインなど）は何もしない（前に分かった結果のまま。最初なら「新しい版は無い」）
 * 勝手に読み込み直さない。「さいよみこみ」を押した時だけ（reloadToLatest）
 */

export type VersionInfo = { build: string; protocol: number };

/** 開いたままの時に確かめる間隔 */
export const CHECK_EVERY_MS = 10 * 60 * 1000;

/** 受け取った version.json の形を確かめる（変な形なら null） */
export function parseVersion(x: unknown): VersionInfo | null {
  if (!x || typeof x !== 'object') return null;
  const o = x as Record<string, unknown>;
  if (typeof o.build !== 'string' || !/^[0-9a-z]{1,40}$/.test(o.build)) return null;
  if (!Number.isInteger(o.protocol) || (o.protocol as number) < 1) return null;
  return { build: o.build, protocol: o.protocol as number };
}

/** version.json の場所（公開ページは /oteca/version.json。時刻を付けて、途中の保存も使わせない） */
export function versionUrl(now: number, base = baseUrl()): string {
  return `${base}version.json?t=${now}`;
}

function baseUrl(): string {
  return (import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/';
}

/** 取りに行って、この時間で答えが無ければあきらめる */
export const FETCH_TIMEOUT_MS = 4000;

/** version.json を取りに行く。取れなければ null（オフライン・壊れたファイル・時間切れなど） */
export async function fetchLatest(fetchFn: typeof fetch = fetch, now = Date.now()): Promise<VersionInfo | null> {
  const ctl = typeof AbortController === 'undefined' ? null : new AbortController();
  const timer = ctl ? setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS) : null;
  try {
    const res = await fetchFn(versionUrl(now), { cache: 'no-store', ...(ctl ? { signal: ctl.signal } : {}) });
    if (!res.ok) return null;
    return parseVersion(await res.json());
  } catch {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** 自分が古い版か（公開している版とビルドID が違う、またはプロトコル版数が小さい） */
export function isOutdated(latest: VersionInfo | null, mine: VersionInfo = { build: buildId, protocol: protocolVersion }): boolean {
  if (!latest) return false;
  return latest.build !== mine.build || latest.protocol > mine.protocol;
}

/**
 * 「さいよみこみ」で開き直す URL：?v=新しいビルドID を付ける（GitHub Pages の保存で古いページが出ないように）。
 * ほかの ?debug=1 などはそのまま
 */
export function reloadUrl(href: string, build: string): string {
  const u = new URL(href);
  u.searchParams.set('v', build);
  // 開発中の「古い版のページ」の印は付けたままにしない（開き直したら新しい版になる）
  u.searchParams.delete('fakeBuild');
  u.searchParams.delete('fakeProtocol');
  return u.toString();
}

/** 開き直した後：URL から ?v= を消す（ほかはそのまま）。消したら新しい URL、無ければ null */
export function withoutV(href: string): string | null {
  const u = new URL(href);
  if (!u.searchParams.has('v')) return null;
  u.searchParams.delete('v');
  return u.toString();
}

// ---------------------------------------------------------------- 画面から使う（今わかっている一番新しい版）

let latest: VersionInfo | null = null;
const listeners = new Set<() => void>();

function setLatest(v: VersionInfo | null): void {
  // 取れなかった時は、前に分かった結果のまま
  if (!v) return;
  if (latest && latest.build === v.build && latest.protocol === v.protocol) return;
  latest = v;
  for (const fn of [...listeners]) fn();
}

/** 今わかっている一番新しい版（まだ取れていなければ null） */
export function latestVersion(): VersionInfo | null {
  return latest;
}

/** 今、古い版で遊んでいるか */
export function outdatedNow(): boolean {
  return isOutdated(latest);
}

let checking: Promise<void> | null = null;

/** 新しい版があるか確かめる（同時に何回呼ばれても、取りに行くのは1回） */
export function checkForUpdate(fetchFn: typeof fetch = fetch): Promise<void> {
  if (checking) return checking;
  checking = fetchLatest(fetchFn)
    .then(setLatest)
    .finally(() => {
      checking = null;
    });
  return checking;
}

/** 開いた時から見張る：今すぐ・タブが表に戻った時・10分ごと。止める関数を返す */
export function watchForUpdates(fetchFn: typeof fetch = fetch): () => void {
  if (typeof window === 'undefined') return () => {};
  void checkForUpdate(fetchFn);
  const onVisible = () => {
    if (document.visibilityState === 'visible') void checkForUpdate(fetchFn);
  };
  document.addEventListener('visibilitychange', onVisible);
  const id = window.setInterval(() => void checkForUpdate(fetchFn), CHECK_EVERY_MS);
  return () => {
    document.removeEventListener('visibilitychange', onVisible);
    window.clearInterval(id);
  };
}

/** 開いた時：URL に ?v= があれば消す（「さいよみこみ」で開き直した後） */
export function cleanVersionParam(): void {
  if (typeof window === 'undefined') return;
  const next = withoutV(window.location.href);
  if (next) window.history.replaceState(window.history.state, '', next);
}

/** 「さいよみこみ」：新しい版の番号を付けて開き直す（セーブは呼ぶ側で先に済ませる） */
export function reloadToLatest(): void {
  const v = latest?.build ?? String(Date.now());
  window.location.replace(reloadUrl(window.location.href, v));
}

/** 画面用：古い版か（version.json の結果が変わると描き直す） */
export function useOutdated(): boolean {
  return useSyncExternalStore(subscribe, outdatedNow, () => false);
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** テスト用：覚えている版を消す */
export function resetUpdateForTest(v: VersionInfo | null = null): void {
  latest = v;
  for (const fn of [...listeners]) fn();
}
