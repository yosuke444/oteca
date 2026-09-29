import type { Action, GameState, Side } from '../../engine/types';

/**
 * 画面下のヒント1行（SPEC §8-2）。設定でOFFにできる。
 * 1行に収まるよう、20文字くらいまでにする。
 */
export function hintText(view: GameState, me: Side, legal: Action[], selectedUid: string | null, canAct: boolean, busy: boolean): string {
  if (view.phase === 'over') return '';
  if (busy) return '…';
  const ps = view.players[me];
  if (!canAct) {
    if (view.phase === 'setup' && ps.setupChoice !== null) return 'あいてが えらぶのを まってるよ';
    return 'いまは あいての ばんだよ';
  }
  if (view.phase === 'setup') return 'おてあげを 1たい うらむきで だそう';
  if (view.phase === 'promote') return 'ベンチから バトルばへ くりだそう';
  if (selectedUid) {
    const def = view.cardDefs[view.cards[selectedUid].no];
    if (ps.bench.includes(selectedUid)) return 'バトルばを タップで こうたい';
    if (def.kind === 'item') return 'ひかる おてあげに つかおう';
    return 'あいている ベンチに だそう';
  }
  if (legal.some((a) => a.type === 'PLACE_BENCH')) return 'ベンチに だそう（1ターン 1まい まで）';
  if (ps.swappedThisTurn) return 'こうたいしたので こうげきは なし';
  if (legal.some((a) => a.type === 'USE_ITEM')) return 'アイテムか「ターンおわり」を おそう';
  return '「ターンおわり＆こうげき！」を おそう';
}
