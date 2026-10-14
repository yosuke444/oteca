import { apiBase } from '../config/api';
import { buildId, protocolVersion } from '../config/version';
import type { EndReason, Side } from '../engine/types';

/**
 * 実際の対戦のデータを Worker に送る（v2.7。カードのバランスを見るため。SPEC §11-9）。
 * 送るのは：両者のデッキのカードの種類と枚数・勝ち負け・ターン数・終わり方・版の番号だけ。
 * 名前・ユーザーID・部屋番号など、人が分かる情報は送らない。
 * 1試合1回だけ：ふだんは p1 の端末だけが送る。相手の通信が切れた時は、残った方が送る
 */

export type MatchLogBody = {
  mode: 'rate' | 'friend';
  build: string;
  protocol: number;
  /** [[カードNo, 枚数], …]。deckA は p1、deckB は p2 */
  deckA: [number, number][];
  deckB: [number, number][];
  /** 0＝p1（deckA）の勝ち、1＝p2 の勝ち、2＝勝ち負けなし（2人の結果が食い違った） */
  winner: 0 | 1 | 2;
  turns: number;
  reason: EndReason | 'disconnect';
};

/** デッキのカードNo の並び → [[カードNo, 枚数], …]（No の順） */
export function deckCounts(cards: readonly number[]): [number, number][] {
  const m = new Map<number, number>();
  for (const no of cards) m.set(no, (m.get(no) ?? 0) + 1);
  return [...m].sort((a, b) => a[0] - b[0]);
}

/** この端末が送る係か（ふだんは p1。相手の通信が切れた時は残った自分） */
export function shouldSendMatchLog(me: Side, reason: EndReason | 'disconnect'): boolean {
  return reason === 'disconnect' || me === 'p1';
}

export function buildMatchLog(o: {
  mode: 'rate' | 'friend';
  decks: Record<Side, readonly number[]>;
  winner: Side;
  /** 2人の結果がそろったか（false＝食い違い。相手の通信切れは true として渡す） */
  agree: boolean;
  turns: number;
  reason: EndReason | 'disconnect';
}): MatchLogBody {
  return {
    mode: o.mode,
    build: buildId,
    protocol: protocolVersion,
    deckA: deckCounts(o.decks.p1),
    deckB: deckCounts(o.decks.p2),
    winner: !o.agree ? 2 : o.winner === 'p1' ? 0 : 1,
    turns: o.turns,
    reason: o.reason,
  };
}

/** 送る（届かなくても気にしない。「単純なリクエスト」にするため text/plain） */
export async function sendMatchLog(body: MatchLogBody): Promise<void> {
  const base = apiBase();
  if (!base) return;
  try {
    await fetch(`${base}/match-log`, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: JSON.stringify(body) });
  } catch {
    // 送れなくても遊ぶのには関係ない
  }
}
