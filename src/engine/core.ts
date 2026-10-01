import { BIG_DAMAGE, DICE_FACES } from './rules';
import { nextInt } from './rng';
import type { CardDef, CardInstance, EndReason, GameEvent, GameState, OtegeCardDef, Side } from './types';

/**
 * エンジン内部の共通処理。
 * どれも applyAction の中で作った「状態のコピー」を書き換える（外から渡された状態には触らない）。
 */

/** 処理中の状態と、出たイベントの列 */
export type Ctx = { s: GameState; events: GameEvent[] };

export const SIDES: readonly Side[] = ['p1', 'p2'];

export function other(side: Side): Side {
  return side === 'p1' ? 'p2' : 'p1';
}

export function cardOf(s: GameState, uid: string): CardInstance | undefined {
  return s.cards[uid];
}

export function defOf(s: GameState, uid: string): CardDef | undefined {
  const c = s.cards[uid];
  return c ? s.cardDefs[c.no] : undefined;
}

export function otegeDefOf(s: GameState, uid: string): OtegeCardDef | undefined {
  const d = defOf(s, uid);
  return d && d.kind === 'otege' ? d : undefined;
}

/** バトル場かベンチにいるか */
export function isInPlay(s: GameState, uid: string): boolean {
  const c = s.cards[uid];
  if (!c) return false;
  const ps = s.players[c.owner];
  return ps.active === uid || ps.bench.includes(uid);
}

export function isOver(s: GameState): boolean {
  return s.phase === 'over';
}

/** サイコロを1個振る（テスト・デバッグ用の固定目があればそれを使う） */
export function rollDie(ctx: Ctx, purpose: 'order' | 'attack', player: Side): number {
  const forced = ctx.s.forcedDice.shift();
  const fixed = purpose === 'attack' ? ctx.s.fixedDie : null;
  const value = forced ?? fixed ?? nextInt(ctx.s.rng, DICE_FACES) + 1;
  ctx.events.push({ type: 'DiceRolled', purpose, player, value });
  return value;
}

/** 山札の上から1枚引く。山札が0なら何もしない（負けにはならない） */
export function drawOne(ctx: Ctx, player: Side): boolean {
  const ps = ctx.s.players[player];
  const uid = ps.deck.shift();
  if (uid === undefined) return false;
  ps.hand.push(uid);
  ctx.events.push({ type: 'Drew', player, uid });
  return true;
}

export function endGame(ctx: Ctx, winner: Side, reason: EndReason): void {
  if (isOver(ctx.s)) return;
  ctx.s.phase = 'over';
  ctx.s.winner = winner;
  ctx.s.endReason = reason;
  ctx.s.pendingPromote = [];
  ctx.s.resumeAfterPromote = null;
  ctx.events.push({ type: 'GameOver', winner, reason });
}

/** ダメージを与える。HPが0以下になったら、きぜつの判定まで行う */
export function dealDamage(ctx: Ctx, uid: string, amount: number, by: Side): void {
  const c = ctx.s.cards[uid];
  if (!c || !isInPlay(ctx.s, uid) || isOver(ctx.s)) return;
  const dmg = Math.max(0, amount);
  c.hp = Math.max(0, c.hp - dmg);
  ctx.events.push({ type: 'Damaged', uid, amount: dmg, hpAfter: c.hp, big: dmg >= BIG_DAMAGE });
  if (c.hp <= 0) faint(ctx, uid, by);
}

/** 回復する。最大HPは超えない */
export function heal(ctx: Ctx, uid: string, amount: number): void {
  const c = ctx.s.cards[uid];
  if (!c || !isInPlay(ctx.s, uid) || isOver(ctx.s)) return;
  const healed = Math.max(0, Math.min(amount, c.maxHp - c.hp));
  c.hp += healed;
  ctx.events.push({ type: 'Healed', uid, amount: healed, hpAfter: c.hp });
}

/** HPを指定の値にする（最大HPは超えない） */
export function setHp(ctx: Ctx, uid: string, value: number): void {
  const c = ctx.s.cards[uid];
  if (!c || !isInPlay(ctx.s, uid) || isOver(ctx.s)) return;
  c.hp = Math.max(0, Math.min(value, c.maxHp));
  ctx.events.push({ type: 'HpSet', uid, hpAfter: c.hp });
  if (c.hp <= 0) faint(ctx, uid, other(c.owner));
}

/**
 * きぜつ（SPEC §4-6）
 * 1. すてふだへ・倒した数+1 → 2. 倒した数が勝利数に届いたら勝ち
 * → 3. ベンチが空なら勝ち → 4. くりだし（ベンチ1体なら自動）
 */
export function faint(ctx: Ctx, uid: string, by: Side): void {
  const { s } = ctx;
  const c = s.cards[uid];
  const ps = s.players[c.owner];
  const wasActive = ps.active === uid;
  if (wasActive) ps.active = null;
  else ps.bench = ps.bench.filter((u) => u !== uid);
  c.attackAdd = 0;
  c.attackOverride = null;
  c.itemsThisTurn = [];
  c.benchedOnTurn = null;
  ps.discard.push(uid);

  const killer = s.players[by];
  killer.koCount += 1;
  ctx.events.push({ type: 'Fainted', uid, by, koCount: killer.koCount });

  if (killer.koCount >= s.rules[by].koToWin) {
    endGame(ctx, by, 'ko');
    return;
  }
  if (!wasActive) return;
  if (ps.bench.length === 0) {
    endGame(ctx, other(c.owner), 'noBench');
    return;
  }
  if (ps.bench.length === 1) {
    promote(ctx, c.owner, ps.bench[0]);
    return;
  }
  if (!s.pendingPromote.includes(c.owner)) s.pendingPromote.push(c.owner);
  ctx.events.push({ type: 'NeedPromote', player: c.owner });
}

/** くりだし：ベンチのおてあげをバトル場へ（交代扱いにしない） */
export function promote(ctx: Ctx, player: Side, benchUid: string): void {
  const ps = ctx.s.players[player];
  ps.bench = ps.bench.filter((u) => u !== benchUid);
  ps.active = benchUid;
  // くりだしは交代制限を受けない（SPEC §4-6）
  ctx.s.cards[benchUid].benchedOnTurn = null;
  ctx.events.push({ type: 'Promoted', player, uid: benchUid });
}
