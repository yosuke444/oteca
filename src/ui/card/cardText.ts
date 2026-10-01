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

export type EffectLabel = { text: string; tone: 'damage' | 'heal' | 'other' };

/** 技の効果 → 表示（ダメージは黒ペン、回復は緑ペン。SPEC §6-6）。文言は効果データから辞書の書き方で作る */
export function effectLabel(effect: Effect): EffectLabel {
  const c = t().card;
  switch (effect.type) {
    case 'damage':
      return { text: c.damage(effect.amount), tone: 'damage' };
    case 'heal':
      return { text: c.heal(effect.amount), tone: 'heal' };
    case 'selfDamage':
      return { text: c.selfDamage(effect.amount), tone: 'damage' };
    case 'setHp':
      return { text: c.setHp(effect.value), tone: 'other' };
    case 'addAttack':
      return { text: c.addAttack(effect.amount), tone: 'other' };
    case 'overrideAttack':
      return { text: c.overrideAttack(effect.value), tone: 'other' };
    case 'scheduled':
      return { text: c.later(effectLabel(effect.effect).text), tone: 'other' };
  }
}
