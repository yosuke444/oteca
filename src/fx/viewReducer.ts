import type { GameEvent, GameState, Side } from '../engine/types';

/**
 * 表示用の状態を、イベント1つぶんだけ進める。
 * 演出はこれで「見た目」だけを少しずつ動かす（エンジンの状態は書き換えない。CLAUDE.md 8）。
 * 1つの操作の演出が終わったら、表示はエンジンの正式な状態にそろえる（ずれても直る）。
 */
export function applyEventToView(view: GameState, e: GameEvent): GameState {
  const v = structuredClone(view);
  const ownerOf = (uid: string): Side => v.cards[uid]?.owner ?? 'p1';
  const removeEverywhere = (uid: string) => {
    const ps = v.players[ownerOf(uid)];
    ps.deck = ps.deck.filter((u) => u !== uid);
    ps.hand = ps.hand.filter((u) => u !== uid);
    ps.bench = ps.bench.filter((u) => u !== uid);
    if (ps.active === uid) ps.active = null;
  };

  switch (e.type) {
    case 'Drew': {
      const ps = v.players[e.player];
      ps.deck = ps.deck.filter((u) => u !== e.uid);
      ps.hand.push(e.uid);
      break;
    }
    case 'TurnStarted': {
      v.phase = 'main';
      v.currentPlayer = e.player;
      v.players[e.player].turnCount = e.turn;
      v.players[e.player].benchPlacedThisTurn = 0;
      v.players[e.player].swappedThisTurn = false;
      break;
    }
    case 'BenchPlaced': {
      const ps = v.players[e.player];
      ps.hand = ps.hand.filter((u) => u !== e.uid);
      ps.bench.push(e.uid);
      ps.benchPlacedThisTurn += 1;
      break;
    }
    case 'Swapped': {
      const ps = v.players[e.player];
      const i = ps.bench.indexOf(e.toActive);
      if (i >= 0) ps.bench[i] = e.toBench;
      ps.active = e.toActive;
      ps.swappedThisTurn = true;
      break;
    }
    case 'ItemUsed': {
      const ps = v.players[e.player];
      ps.hand = ps.hand.filter((u) => u !== e.itemUid);
      ps.discard.push(e.itemUid);
      break;
    }
    case 'BuffChanged': {
      const c = v.cards[e.uid];
      if (c) {
        c.attackAdd = e.attackAdd;
        c.attackOverride = e.attackOverride;
      }
      break;
    }
    case 'Damaged':
    case 'Healed':
    case 'HpSet': {
      const c = v.cards[e.uid];
      if (c) c.hp = e.hpAfter;
      break;
    }
    case 'Fainted': {
      removeEverywhere(e.uid);
      v.players[ownerOf(e.uid)].discard.push(e.uid);
      v.players[e.by].koCount = e.koCount;
      break;
    }
    case 'NeedPromote': {
      v.phase = 'promote';
      if (!v.pendingPromote.includes(e.player)) v.pendingPromote.push(e.player);
      break;
    }
    case 'Promoted': {
      const ps = v.players[e.player];
      ps.bench = ps.bench.filter((u) => u !== e.uid);
      ps.active = e.uid;
      v.pendingPromote = v.pendingPromote.filter((p) => p !== e.player);
      break;
    }
    case 'ActiveChosen':
      // 裏向きで置いた。どのカードかは相手に見せない（手札から1枚減った見た目は ActivesRevealed で）
      break;
    case 'ActivesRevealed': {
      for (const side of ['p1', 'p2'] as const) {
        const uid = e[side];
        const ps = v.players[side];
        ps.hand = ps.hand.filter((u) => u !== uid);
        ps.active = uid;
        ps.setupChoice = null;
      }
      break;
    }
    case 'GameOver': {
      v.phase = 'over';
      v.winner = e.winner;
      v.endReason = e.reason;
      break;
    }
    case 'DiceRolled':
    case 'Mulligan':
    case 'MoveSelected':
    case 'TurnEnded':
      break;
  }
  return v;
}
