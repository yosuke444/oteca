import { CARD_LIST } from '../../data/cards';
import { inPack } from '../../data/packs';
import type { CardDef } from '../../engine/types';
import { getOwnedCount, ownedTrophyDefs } from '../../save/collection';
import type { SaveData } from '../../save/saveData';

/**
 * デッキ編集のカードいちらん（SPEC §7 S02。画面から切り離した純粋な関数）。
 * v2.2：持っているカードだけを出す（持っていないカードは出さない。「もっている」の絞り込みは無くした）
 */

export type ListFilter = 'all' | 'otege' | 'item' | 'super';
export type ListSort = 'no' | 'name' | 'hp' | 'owned';

export const LIST_FILTERS: ListFilter[] = ['all', 'otege', 'item', 'super'];
export const LIST_SORTS: ListSort[] = ['no', 'name', 'hp', 'owned'];

/**
 * 一覧に出すカード（持っているものだけ。絞り込みと並び替え）
 * @param pack パックの絞り込み（null ＝ぜんぶ、'limited' ＝限定）
 */
export function listCards(save: Pick<SaveData, 'collection' | 'unlockAll' | 'trophies'>, filter: ListFilter, pack: string | null, sort: ListSort): CardDef[] {
  const own = (c: CardDef) => getOwnedCount(save, c.no);
  // 持っているトロフィーのカード（v2.0-J）も一覧に出す（パックで絞った時は出さない）
  const filtered = [...CARD_LIST, ...(pack ? [] : ownedTrophyDefs(save))].filter((c) => {
    if (own(c) <= 0) return false;
    if (pack && !inPack(c.id, pack)) return false;
    if (filter === 'otege') return c.kind === 'otege';
    if (filter === 'item') return c.kind === 'item';
    if (filter === 'super') return c.kind === 'otege' && c.rarity === 'super';
    return true;
  });
  const hp = (c: CardDef) => (c.kind === 'otege' ? c.hp : -1);
  return [...filtered].sort((a, b) => {
    if (sort === 'hp') return hp(b) - hp(a) || a.no - b.no;
    if (sort === 'name') return a.name.localeCompare(b.name, 'ja') || a.no - b.no;
    if (sort === 'owned') return own(b) - own(a) || a.no - b.no;
    return a.no - b.no;
  });
}
