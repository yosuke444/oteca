/**
 * 実際の対戦のデータ（v2.7。カードのバランス）。ふつうの処理だけ（テストしやすいように）。
 * 端末から届いた中身を確かめる。人が分かる情報は受け取らない（形にあるものだけを取り出す）
 */

/** 1日に記録する上限（1試合で D1 に2回書く：記録と、その日の数。合わせて2万回。D1 の上限 1日10万回の中に収める） */
export const MATCH_LOG_DAILY_MAX = 10000;

export type MatchLog = {
  mode: 'rate' | 'friend';
  build: string;
  protocol: number;
  deckA: [number, number][];
  deckB: [number, number][];
  winner: 0 | 1 | 2;
  turns: number;
  reason: 'ko' | 'noBench' | 'surrender' | 'disconnect';
};

/** デッキ：[[カードNo, 枚数], …]。合わせて15枚・No は 1〜65535・同じ No は1つ。No の順に並べ直す */
function cleanDeck(x: unknown): [number, number][] | null {
  if (!Array.isArray(x) || x.length === 0 || x.length > 15) return null;
  const out: [number, number][] = [];
  for (const e of x) {
    if (!Array.isArray(e) || e.length !== 2) return null;
    const [no, n] = e;
    if (!Number.isInteger(no) || no < 1 || no > 65535 || !Number.isInteger(n) || n < 1 || n > 15) return null;
    if (out.some(([m]) => m === no)) return null;
    out.push([no, n]);
  }
  if (out.reduce((t, [, n]) => t + n, 0) !== 15) return null;
  return out.sort((a, b) => a[0] - b[0]);
}

export function cleanMatchLog(x: unknown): MatchLog | null {
  if (!x || typeof x !== 'object') return null;
  const o = x as Record<string, unknown>;
  const deckA = cleanDeck(o.deckA);
  const deckB = cleanDeck(o.deckB);
  if (!deckA || !deckB) return null;
  if (o.mode !== 'rate' && o.mode !== 'friend') return null;
  if (typeof o.build !== 'string' || !/^[0-9a-z]{1,40}$/.test(o.build)) return null;
  if (!Number.isInteger(o.protocol) || (o.protocol as number) < 1 || (o.protocol as number) > 1000) return null;
  if (o.winner !== 0 && o.winner !== 1 && o.winner !== 2) return null;
  if (!Number.isInteger(o.turns) || (o.turns as number) < 0 || (o.turns as number) > 10000) return null;
  if (o.reason !== 'ko' && o.reason !== 'noBench' && o.reason !== 'surrender' && o.reason !== 'disconnect') return null;
  return { mode: o.mode, build: o.build, protocol: o.protocol as number, deckA, deckB, winner: o.winner, turns: o.turns as number, reason: o.reason };
}

/** 管理画面の「カードの せいせき」の期間 → この時刻から（today は日本時間の今日の0時） */
export function rangeSince(range: unknown, now: number): number {
  if (range === 'all') return 0;
  if (range === '7d') return now - 7 * 24 * 60 * 60 * 1000;
  const jst = now + 9 * 60 * 60 * 1000;
  return jst - (jst % (24 * 60 * 60 * 1000)) - 9 * 60 * 60 * 1000;
}
