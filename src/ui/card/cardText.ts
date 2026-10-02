import type { Effect } from '../../engine/types';
import { t } from '../../i18n';

/** サイコロの目の並び → 「1-5」「6」「1・3」 */
export function faceLabel(faces: number[]): string {
  const sorted = [...faces].sort((a, b) => a - b);
  const consecutive = sorted.every((f, i) => i === 0 || f === sorted[i - 1] + 1);
  if (sorted.length === 1) return String(sorted[0]);
  if (consecutive) return `${sorted[0]}-${sorted[sorted.length - 1]}`;
  return sorted.join(t().card.faceJoin);
}

/** damage＝相手へ（黒）、heal＝回復（緑）、self＝自分へのダメージ（赤）、other＝そのほか */
export type EffectLabel = { text: string; tone: 'damage' | 'heal' | 'self' | 'other' };

/**
 * 「今の量 + 持続効果」→ 「20+10」「0+0+60」（SPEC §4-5 ①）。
 * 後ろが4回以上ある（たからばこ）時は長くなるので null（呼ぶ側で「○回後に…」に書きかえる）
 */
export function plusText(now: number, then: number[] | undefined): string | null {
  if (!then || then.length === 0) return String(now);
  if (then.length > 3) return null;
  return [now, ...then].join(t().card.plus);
}

/**
 * 技の効果 → 表示（ダメージは黒ペン、回復は緑ペン、自分へのダメージは赤ペン。SPEC §6-6）。
 * 文言は効果データから辞書の書き方で作る（カード名では作らない）。
 * compact は カードの上の技表用の短い書き方（くわしくは カード詳細で全部の書き方）
 */
export function effectLabel(effect: Effect, compact = false): EffectLabel {
  const c = t().card;
  const s = c.short;
  switch (effect.type) {
    case 'damage': {
      const now = effect.amount;
      if (now === 0 && !effect.then?.some((x) => x > 0)) return { text: compact ? s.nothing : c.nothing, tone: 'other' };
      return { text: c.damage(plusText(now, effect.then) ?? now), tone: 'damage' };
    }
    case 'heal':
      return { text: c.heal(plusText(effect.amount, effect.then) ?? effect.amount), tone: 'heal' };
    case 'selfDamage':
      return { text: (compact ? s.selfDamage : c.selfDamage)(plusText(effect.amount, effect.then) ?? effect.amount), tone: 'self' };
    case 'draw': {
      const plus = plusText(effect.count, effect.then);
      if (plus !== null) return { text: (compact ? s.draw : c.draw)(plus), tone: 'other' };
      // 長い持続（たからばこ）：最後に引く回と枚数だけ書く
      const then = effect.then ?? [];
      const last = then.reduce((at, x, i) => (x > 0 ? i : at), -1);
      if (last < 0) return { text: (compact ? s.draw : c.draw)(effect.count), tone: 'other' };
      return { text: (compact ? s.drawLater : c.drawLater)(last + 1, then[last]), tone: 'other' };
    }
    case 'discard':
      return { text: (compact ? s.discard : c.discard)(effect.count), tone: 'other' };
    case 'switchWithBench':
      return { text: compact ? s.switchBench : c.switchBench, tone: 'other' };
    case 'faintLater':
      return { text: (compact ? s.faintLater : c.faintLater)(effect.after), tone: 'other' };
    case 'search':
      return { text: c.search(effect.count), tone: 'other' };
    case 'setHp':
      return { text: c.setHp(effect.value), tone: 'other' };
    case 'addAttack':
      return { text: c.addAttack(effect.amount), tone: 'other' };
    case 'overrideAttack':
      return { text: c.overrideAttack(effect.value), tone: 'other' };
    case 'scheduled':
      return { text: c.later(effectLabel(effect.effect, compact).text), tone: 'other' };
  }
}

/** 1つの技の効果を、表示する順（SPEC §4-5 ③ の処理順）に並べる */
export function sortedEffects(effects: Effect[]): Effect[] {
  const order: Record<Effect['type'], number> = {
    damage: 1,
    heal: 3,
    selfDamage: 4,
    draw: 5,
    search: 6,
    discard: 7,
    switchWithBench: 8,
    faintLater: 9,
    addAttack: 9,
    setHp: 9,
    overrideAttack: 9,
    scheduled: 9,
  };
  return effects.map((e, i) => ({ e, i })).sort((a, b) => order[a.e.type] - order[b.e.type] || a.i - b.i).map(({ e }) => e);
}
