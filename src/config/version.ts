export const appVersion = '0.0.0';

/** ビルドID（vite.config.ts の buildInfo が埋め込む。Worker・テストでは無い） */
declare const __OTECA_BUILD__: string | undefined;

/**
 * 版の番号（v2.7。SPEC §12-7）
 * - buildId：ビルドごとの番号（git のコミットの短いハッシュ）。公開した version.json の build と比べて、新しい版に気づく
 * - protocolVersion：通信のプロトコル版数。版が違う人どうしは つながらない（フレンド部屋・レート対戦・トレード）
 * 開発中だけ ?fakeBuild=〜&fakeProtocol=〜 で「古い版のページ」を作れる（Playwright の確かめ用。公開用ビルドでは効かない）
 */
export const buildId: string = devOverride('fakeBuild') ?? (typeof __OTECA_BUILD__ === 'string' ? __OTECA_BUILD__ : 'dev');

/** 今のプロトコル版数（変える時は、ここの数を上げる。vite.config.ts が version.json に書く） */
const PROTOCOL_VERSION = 16;
const fakeProtocol = devOverride('fakeProtocol');
export const protocolVersion: number = fakeProtocol && /^[0-9]+$/.test(fakeProtocol) ? Number(fakeProtocol) : PROTOCOL_VERSION;

function devOverride(name: string): string | null {
  const dev = (import.meta as { env?: { DEV?: boolean } }).env?.DEV === true;
  const loc = (globalThis as { location?: { search: string } }).location;
  if (!dev || !loc) return null;
  const v = new URLSearchParams(loc.search).get(name);
  return v && /^[0-9a-z]{1,16}$/.test(v) ? v : null;
}
