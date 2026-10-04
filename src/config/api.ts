/**
 * ランキングと受付係のサーバー（Cloudflare Workers の oteca-api。v2.0-I・SPEC §11-9）。
 * 開発用：URL に ?api=local を付けると手元の `wrangler dev`（http://localhost:8787）、?api=off でサーバーを使わない。
 * ?lobby=off で受付係だけ使わない（予備の待合所を確かめる時）。
 */
export const API_BASE = 'https://oteca-api.oteca-api.workers.dev';
/** 手元の Worker（cd worker → npm run dev） */
export const LOCAL_API_BASE = 'http://localhost:8787';

function param(name: string): string | null {
  if (typeof window === 'undefined') return null;
  return new URLSearchParams(window.location.search).get(name);
}

/** サーバーの場所（使わない時は null） */
export function apiBase(): string | null {
  const v = param('api');
  if (v === 'off') return null;
  if (v === 'local') return LOCAL_API_BASE;
  return API_BASE;
}

/** 受付係の WebSocket の場所（使わない時は null） */
export function lobbyUrl(): string | null {
  const base = apiBase();
  if (!base || param('lobby') === 'off') return null;
  return `${base.replace(/^http/, 'ws')}/lobby`;
}
