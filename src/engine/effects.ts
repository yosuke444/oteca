import { type Ctx, dealDamage, heal, isInPlay, isOver, other, setHp } from './core';
import type { CardInstance, Effect, EffectType, GameState, Side } from './types';

/**
 * 効果の登録表（SPEC §13-3 効果の登録制）
 * 新しい効果タイプは、types.ts の Effect に1行足して、ここに処理を1つ追加するだけで済む。
 */

/** 効果がどこから出たか */
export type EffectSource = {
  /** move＝技／item＝アイテム／scheduled＝タイミング付き効果 */
  kind: 'move' | 'item' | 'scheduled';
  /** 効果を出したプレイヤー */
  player: Side;
  /** 効果を出したカード（技ならおてあげ、アイテムならアイテム） */
  sourceUid: string;
  /** アイテムで選んだ対象 */
  targetUid?: string;
};

type Handler<T extends EffectType> = (ctx: Ctx, effect: Extract<Effect, { type: T }>, src: EffectSource) => void;

export const effectHandlers: { [T in EffectType]: Handler<T> } = {
  /** 相手のバトル場にダメージ（技なら §4-5 の計算順） */
  damage(ctx, effect, src) {
    const target = ctx.s.players[other(src.player)].active;
    if (!target) return;
    const amount =
      src.kind === 'move' ? moveDamage(ctx.s, ctx.s.cards[src.sourceUid], effect.amount) : effect.amount;
    dealDamage(ctx, target, amount, src.player);
  },

  /** 回復（技なら自分自身、アイテムなら選んだ対象） */
  heal(ctx, effect, src) {
    heal(ctx, targetOf(src), effect.amount);
  },

  /** このターンのダメージ加算（重ね掛け可） */
  addAttack(ctx, effect, src) {
    const c = ctx.s.cards[targetOf(src)];
    if (!c || !isInPlay(ctx.s, c.uid)) return;
    c.attackAdd += effect.amount;
    pushBuff(ctx, c);
  },

  /** このターンのダメージ上書き */
  overrideAttack(ctx, effect, src) {
    const c = ctx.s.cards[targetOf(src)];
    if (!c || !isInPlay(ctx.s, c.uid)) return;
    c.attackOverride = effect.value;
    pushBuff(ctx, c);
  },

  /** HPを指定の値にする */
  setHp(ctx, effect, src) {
    setHp(ctx, targetOf(src), effect.value);
  },

  /** 予約：タイミング付き効果キューに積む（発動は engine.ts の processScheduled） */
  scheduled(ctx, effect, src) {
    ctx.s.scheduled.push({
      owner: src.player,
      timing: effect.timing,
      effect: effect.effect,
      sourceUid: src.sourceUid,
      createdTurn: ctx.s.turnNumber,
    });
  },

  /** 予約：効果を出したおてあげ自身にダメージ */
  selfDamage(ctx, effect, src) {
    const c = ctx.s.cards[src.sourceUid];
    if (!c) return;
    dealDamage(ctx, c.uid, effect.amount, other(c.owner));
  },
};

/** 効果を1つ実行する（決着後は何もしない） */
export function runEffect(ctx: Ctx, effect: Effect, src: EffectSource): void {
  if (isOver(ctx.s)) return;
  const handler = effectHandlers[effect.type] as Handler<EffectType>;
  handler(ctx, effect, src);
}

/**
 * 技のダメージ計算（SPEC §4-5）
 * 1. 基本値 → 2. + このターンの加算（やいば・ドリンク） → 3. + ルール補正
 * （置き換え attackOverride は予約。v1.4 ではどのカードも使わない）
 * 画面の「このターン出る数値」の表示にも使う。
 */
export function moveDamage(s: GameState, attacker: CardInstance, base: number): number {
  let dmg = attacker.attackOverride ?? base;
  dmg += attacker.attackAdd;
  dmg += s.rules[attacker.owner].attackBonus;
  return Math.max(0, dmg);
}

function targetOf(src: EffectSource): string {
  return src.targetUid ?? src.sourceUid;
}

function pushBuff(ctx: Ctx, c: CardInstance): void {
  ctx.events.push({ type: 'BuffChanged', uid: c.uid, attackAdd: c.attackAdd, attackOverride: c.attackOverride });
}
