import { protocolVersion } from '../../../src/config/version';

/**
 * 受付係が知っている「今の版」（v2.7。SPEC §12-6）。ふつうの処理だけ（テストしやすいように）。
 * 公開しているゲームの version.json（GitHub Pages。ゲームをデプロイすると自動で新しくなる）の版を「今の版」にする
 * （読めない時だけ Worker を作った時の版）。手で書き換えなくてよい
 */

/** version.json を読み直す間隔 */
export const VERSION_CACHE_MS = 5 * 60 * 1000;
/** version.json を取りに行って、この時間で答えが無ければあきらめる */
export const VERSION_FETCH_MS = 2000;
/** 版が古いので断った時の、接続の閉じ方の番号 */
export const CLOSE_VERSION = 4002;

/** Worker を作った時の版 */
export const BUILT_PROTOCOL = protocolVersion;

/** version.json の protocol を読む（変な形なら null） */
export function readProtocol(x: unknown): number | null {
  if (!x || typeof x !== 'object') return null;
  const p = (x as { protocol?: unknown }).protocol;
  return Number.isInteger(p) && (p as number) >= 1 && (p as number) <= 1_000_000 ? (p as number) : null;
}

/**
 * 今の版：公開している版（version.json）。分からない時（読めない・まだ読んでいない）だけ Worker を作った時の版。
 * Worker を先に新しい版でデプロイしても、公開しているゲームがまだ前の版なら、今遊んでいる人を断らない
 */
export function currentProtocol(published: number | null, built = BUILT_PROTOCOL): number {
  return published ?? built;
}

/** この版の人の申し込みを断るか（今の版より古い） */
export function isTooOld(protocol: number, current: number): boolean {
  return protocol < current;
}
