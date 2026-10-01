import { moveDamage } from '../engine/effects';
import { DICE_FACES } from '../engine/rules';
import type { GameState, OtegeCardDef, Side } from '../engine/types';

/**
 * サイコロの確率から見た「強さ」の見積もり（CPU つよい・さいきょう 用。SPEC §13-5）。
 * ルールエンジンの moveDamage（§4-5 の計算順）をそのまま使うので、ルールを二重に書かない。
 */

/** サイコロの目ごとの結果：ダメージ（damage）か回復（heal） */
export type Outcome = { damage: number; heal: number };

export function otegeDef(s: GameState, uid: string): OtegeCardDef | null {
  const d = s.cardDefs[s.cards[uid]?.no];
  return d && d.kind === 'otege' ? d : null;
}

/** そのおてあげが攻撃した時の、目 1〜6 ごとの結果。extraAdd はこれから足すダメージ（やいば等） */
export function outcomes(s: GameState, uid: string, extraAdd = 0): Outcome[] {
  const c = s.cards[uid];
  const def = otegeDef(s, uid);
  const out: Outcome[] = [];
  for (let face = 1; face <= DICE_FACES; face++) {
    const move = def?.moves.find((m) => m.faces.includes(face));
    let damage = 0;
    let heal = 0;
    for (const e of move?.effects ?? []) {
      if (e.type === 'damage') damage += moveDamage(s, { ...c, attackAdd: c.attackAdd + extraAdd }, e.amount);
      if (e.type === 'heal') heal += e.amount;
    }
    out.push({ damage, heal });
  }
  return out;
}

/** 期待ダメージ */
export function expectedDamage(s: GameState, uid: string, extraAdd = 0): number {
  return outcomes(s, uid, extraAdd).reduce((t, o) => t + o.damage, 0) / DICE_FACES;
}

/** 1回の攻撃で hp 以上のダメージが出る確率 */
export function koChance(s: GameState, attackerUid: string, hp: number, extraAdd = 0): number {
  return outcomes(s, attackerUid, extraAdd).filter((o) => o.damage >= hp).length / DICE_FACES;
}

/** 相手のバトル場のおてあげが、次の攻撃で このおてあげを倒す確率（相手の手札のアイテムは分からないので margin だけ多めに見る） */
export function threat(s: GameState, side: Side, targetUid: string, margin = 0): number {
  const opp: Side = side === 'p1' ? 'p2' : 'p1';
  const a = s.players[opp].active;
  if (!a) return 0;
  // 相手のこのターンの効果（やいば等）は相手のターン終わりに消えているので、素の強さで見る
  const base = { ...s, cards: { ...s.cards, [a]: { ...s.cards[a], attackAdd: 0, attackOverride: null } } };
  return koChance(base, a, s.cards[targetUid].hp - margin);
}

/** おてあげの「価値」（HP と 攻撃力）。準備・くりだし・ベンチに出す順の目安 */
export function otegeValue(s: GameState, uid: string): number {
  const c = s.cards[uid];
  return c.hp + 2.5 * expectedDamage(s, uid) * 6 / DICE_FACES;
}
