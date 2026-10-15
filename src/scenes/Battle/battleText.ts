import { blockedItemOn } from '../../engine';
import { local, t } from '../../i18n';
import type { GameEvent, GameState, RejectReason, Side } from '../../engine/types';

/** 出来ない操作を押した時の一言（SPEC §8-2） */
export function rejectText(r: RejectReason): string {
  return t().battle.reject[r];
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
    if (used?.kind === 'item' && used.afterUseNote) return local(used.afterUseNote);
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
 * @param viewer ログを見る人（相手が山札から選んだカードは見せない）。null なら全部見せる（ひとりで両方あやつる時）。'none' はどちらの分も見せない（観戦）
 */
export function logLine(e: GameEvent, view: GameState, names: Record<Side, string>, viewer: Side | 'none' | null = null): string | null {
  const L = t().battle.log;
  const nm = (uid: string) => cardName(view, uid);
  switch (e.type) {
    case 'DiceRolled':
      return e.purpose === 'order' ? L.orderDice(names[e.player], e.value) : L.attackDice(e.value);
    case 'Mulligan':
      return L.mulligan(names[e.player]);
    case 'Drew':
      return L.drew(names[e.player]);
    case 'TurnStarted':
      return L.turn(names[e.player], e.turn);
    case 'BenchPlaced':
      return L.bench(nm(e.uid));
    case 'Swapped':
      return L.swap(nm(e.toActive), nm(e.toBench));
    case 'ItemUsed':
      return e.targetUid !== null ? L.item(nm(e.targetUid), nm(e.itemUid)) : L.item(names[e.player], nm(e.itemUid));
    case 'Damaged':
      return L.damage(nm(e.uid), e.amount);
    case 'Healed':
      return L.heal(nm(e.uid), e.amount);
    case 'HealBlocked':
      return L.healBlocked(nm(e.uid));
    case 'HpSet':
      return L.hpSet(nm(e.uid), e.hpAfter);
    case 'Fainted':
      return L.faint(nm(e.uid));
    case 'Promoted':
      return L.promote(nm(e.uid));
    case 'ActivesRevealed':
      return L.start(nm(e.p1), nm(e.p2));
    case 'GameOver':
      return L.win(names[e.winner]);
    case 'TurnEnded':
      return e.attacked ? null : e.firstTurn ? L.firstTurn(names[e.player]) : L.noAttack(names[e.player]);
    // ↓ v2.0
    case 'Discarded':
      return e.fromDeck ? L.discardDeck(names[e.player], nm(e.uids[0])) : L.discard(names[e.player], e.uids.map(nm).join(L.join));
    case 'Searched':
      // 相手には何を取ったか見せない（SPEC §4-7）
      return viewer !== null && viewer !== e.player ? L.searchHidden(names[e.player], nm(e.sourceUid)) : L.search(names[e.player], e.uids.map(nm).join(L.join));
    case 'DeckShuffled':
      return L.shuffle(names[e.player]);
    case 'ChoiceNeeded':
      return L.chooseWait(names[e.player]);
    case 'LastingFired':
      return e.lasting.targetUid !== null ? L.lasting(nm(e.lasting.targetUid)) : L.lasting(names[e.lasting.holder]);
    case 'LastingCleared':
      return e.reason === 'noHeal' ? L.lastingHealCleared(nm(e.uid)) : L.lastingCleared(nm(e.uid));
    default:
      return null;
  }
}

/** ドローまでの表示（SPEC §8-1） */
export function drawCounterText(view: GameState, side: Side): { text: string; soon: boolean } {
  const ps = view.players[side];
  const n = view.rules[side].drawEveryNTurns;
  if (n <= 0) return { text: '', soon: false };
  const D = t().battle.draw;
  if (ps.deck.length === 0) return { text: D.noDeck, soon: false };
  const next = ps.turnCount + 1;
  const left = ((n - (next % n)) % n) + 1;
  if (left === 1) return { text: D.nextTurn, soon: true };
  return { text: D.left(left), soon: false };
}
