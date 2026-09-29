import type { CardDef } from '../engine/types';

/**
 * アイテムの演出の種類（SPEC §9-2 のアイテム別演出）。
 * カードの名前ではなく、カードデータの効果から決める（新しいアイテムが増えても、近い演出が選ばれる）。
 * - heal：ふつうの回復（くすり）
 * - bigHeal：大きい回復・ベンチ用の回復（スポドリ）
 * - power：ダメージを足す（ひみつのやいば）
 * - weird：HPを変える・ダメージを置きかえる（きみょうなドリンク）
 */
export type ItemFxKind = 'heal' | 'bigHeal' | 'power' | 'weird';

export function itemFxKind(def: CardDef | undefined): ItemFxKind {
  if (!def || def.kind !== 'item') return 'heal';
  const types = def.effects.map((e) => e.type);
  if (types.includes('setHp') || types.includes('overrideAttack')) return 'weird';
  if (types.includes('addAttack')) return 'power';
  const heal = def.effects.reduce((s, e) => s + (e.type === 'heal' ? e.amount : 0), 0);
  const benchOnly = def.target.zones.length === 1 && def.target.zones[0] === 'bench';
  return heal >= 50 || benchOnly ? 'bigHeal' : 'heal';
}

/** アイテムの種類 → 効果音のキー（SPEC §10-3） */
export const ITEM_SOUND: Record<ItemFxKind, string> = {
  heal: 'se_item_kusuri',
  bigHeal: 'se_item_spodori',
  power: 'se_item_yaiba',
  weird: 'se_item_drink',
};

/** アイテムのふせんの色（CSS のクラス名に使う） */
export function noteColorOf(def: CardDef | undefined): string {
  return def && def.kind === 'item' ? (def.color ?? 'yellow') : 'yellow';
}
