import { blockedItemOn } from '../../engine';
import type { GameEvent, GameState, RejectReason, Side } from '../../engine/types';

/** 出来ない操作を押した時の一言（SPEC §8-2） */
export function rejectText(r: RejectReason): string {
  switch (r) {
    case 'notYourTurn':
      return 'いまは あいての ターンだよ';
    case 'benchFull':
      return 'ベンチは いっぱいだよ';
    case 'benchLimit':
      return 'ベンチは このターン もう だしたよ';
    case 'fullHp':
      return 'HPが まんたんだよ';
    case 'badTarget':
      return 'その おてあげには つかえないよ';
    case 'notOtege':
      return 'おてあげ じゃないよ';
    case 'notItem':
      return 'アイテム じゃないよ';
    case 'notOnBench':
      return 'ベンチに いないよ';
    case 'noActive':
      return 'バトルばに おてあげが いないよ';
    case 'alreadyChosen':
      return 'もう えらんだよ';
    case 'notPending':
      return 'いまは えらばなくて いいよ';
    case 'wrongPhase':
      return 'いまは できないよ';
    case 'gameOver':
      return 'もう けっちゃく したよ';
    case 'notInHand':
      return 'てふだに ないよ';
    case 'stackBlocked':
      return 'このターンは もう その おてあげに つかえないよ';
  }
}

/**
 * アイテムをその おてあげに使えない理由の一言。重ねがけ禁止（SPEC §4-7）なら、先に使ったアイテムの afterUseNote
 * （例「ドリンクを のんだ おてあげには つかえないよ」）。
 */
export function useItemReason(view: GameState, r: RejectReason, itemUid: string, targetUid: string): string {
  if (r === 'stackBlocked') {
    const item = view.cardDefs[view.cards[itemUid].no];
    const no = item.kind === 'item' ? blockedItemOn(view, item.blockedIfUsedThisTurn, view.cards[targetUid].itemsThisTurn) : null;
    const used = no !== null ? view.cardDefs[no] : null;
    if (used?.kind === 'item' && used.afterUseNote) return used.afterUseNote;
  }
  return rejectText(r);
}

/** カードの名前 */
export function cardName(view: GameState, uid: string): string {
  const c = view.cards[uid];
  return c ? (view.cardDefs[c.no]?.name ?? '?') : '?';
}

/**
 * ログの1行（ノートの余白メモ風。SPEC §8-1）
 * @param view イベントが起きる前の表示状態
 */
export function logLine(e: GameEvent, view: GameState, names: Record<Side, string>): string | null {
  switch (e.type) {
    case 'DiceRolled':
      return e.purpose === 'order' ? `・${names[e.player]} の サイコロ：${e.value}` : `・サイコロ：${e.value}`;
    case 'Mulligan':
      return `・${names[e.player]} は おてあげが いないので ひきなおし`;
    case 'Drew':
      return `・${names[e.player]} が 1まい ひいた`;
    case 'TurnStarted':
      return `― ${names[e.player]} の ${e.turn}ターンめ ―`;
    case 'BenchPlaced':
      return `・${cardName(view, e.uid)} を ベンチに だした`;
    case 'Swapped':
      return `・${cardName(view, e.toActive)} と ${cardName(view, e.toBench)} を こうたい`;
    case 'ItemUsed':
      return `・${cardName(view, e.targetUid)} に ${cardName(view, e.itemUid)}`;
    case 'Damaged':
      return `・${cardName(view, e.uid)} に ${e.amount} ダメージ！`;
    case 'Healed':
      return `・${cardName(view, e.uid)} が ${e.amount} かいふく`;
    case 'HpSet':
      return `・${cardName(view, e.uid)} の HPが ${e.hpAfter} に`;
    case 'Fainted':
      return `・${cardName(view, e.uid)} が きぜつ！`;
    case 'Promoted':
      return `・${cardName(view, e.uid)} を くりだした`;
    case 'ActivesRevealed':
      return `・バトル スタート！ ${cardName(view, e.p1)} vs ${cardName(view, e.p2)}`;
    case 'GameOver':
      return `・${names[e.winner]} の かち！`;
    case 'TurnEnded':
      return e.attacked ? null : `・${names[e.player]} は こうげき しなかった`;
    default:
      return null;
  }
}

/** ドローまでの表示（SPEC §8-1） */
export function drawCounterText(view: GameState, side: Side): { text: string; soon: boolean } {
  const ps = view.players[side];
  const n = view.rules[side].drawEveryNTurns;
  if (n <= 0) return { text: '', soon: false };
  if (ps.deck.length === 0) return { text: 'やまふだが ないよ', soon: false };
  const next = ps.turnCount + 1;
  const left = ((n - (next % n)) % n) + 1;
  if (left === 1) return { text: 'つぎの ターンで ひける！', soon: true };
  return { text: `ドローまで あと${left}`, soon: false };
}
