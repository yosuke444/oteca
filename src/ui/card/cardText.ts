import type { Effect } from '../../engine/types';

/** サイコロの目の並び → 「1-5」「6」「1・3」 */
export function faceLabel(faces: number[]): string {
  const sorted = [...faces].sort((a, b) => a - b);
  const consecutive = sorted.every((f, i) => i === 0 || f === sorted[i - 1] + 1);
  if (sorted.length === 1) return String(sorted[0]);
  if (consecutive) return `${sorted[0]}-${sorted[sorted.length - 1]}`;
  return sorted.join('・');
}

export type EffectLabel = { text: string; tone: 'damage' | 'heal' | 'other' };

/** 技の効果 → 表示（ダメージは黒ペン、回復は緑ペン。SPEC §6-6） */
export function effectLabel(effect: Effect): EffectLabel {
  switch (effect.type) {
    case 'damage':
      return { text: `${effect.amount}ダメ`, tone: 'damage' };
    case 'heal':
      return { text: `${effect.amount}かいふく`, tone: 'heal' };
    case 'selfDamage':
      return { text: `じぶんに${effect.amount}ダメ`, tone: 'damage' };
    case 'setHp':
      return { text: `HPが${effect.value}に`, tone: 'other' };
    case 'addAttack':
      return { text: `ダメ+${effect.amount}`, tone: 'other' };
    case 'overrideAttack':
      return { text: `ダメが${effect.value}に`, tone: 'other' };
    case 'scheduled':
      return { text: `あとで ${effectLabel(effect.effect).text}`, tone: 'other' };
  }
}
