import { features } from '../config/features';
import { CARD_DB } from '../data/cards';
import { type DeckProblem, DEFAULT_RULES, validateDeck } from '../engine';
import type { RuleSet } from '../engine/types';
import type { SaveData } from './saveData';

/**
 * 所持カードの窓口（SPEC §13-2・§4-2）
 * デッキ編集・デッキ選択は、カードを使えるかどうかを必ずここ経由で調べる。
 * 在庫はデッキごと：1つのデッキには所持数まで入れられ、ほかのデッキで使っている枚数は関係ない。
 */

/** そのカードの所持数。features.collection が false か unlockAll の時は無制限（Infinity） */
export function getOwnedCount(save: Pick<SaveData, 'collection' | 'unlockAll'>, no: number): number {
  if (!features.collection || save.unlockAll) return Infinity;
  return save.collection[no] ?? 0;
}

/** 足りないカード（デッキに入っている枚数が所持数より多い分） */
export type Shortage = { no: number; missing: number };

export type DeckCheck = {
  /** ルール違反（SPEC §4-2） */
  problems: DeckProblem[];
  /** 所持数より多く入っているカード（トレードなどで所持数が減った時） */
  shortages: Shortage[];
  /** 対戦に使えるか（違反も不足も無い） */
  usable: boolean;
};

/** デッキのカード（No の配列）を、所持数とルールで調べる */
export function checkDeckCards(
  save: Pick<SaveData, 'collection' | 'unlockAll'>,
  cards: number[],
  rules: RuleSet = DEFAULT_RULES,
): DeckCheck {
  const problems = validateDeck(cards, CARD_DB, rules);
  const counts = new Map<number, number>();
  for (const no of cards) counts.set(no, (counts.get(no) ?? 0) + 1);
  const shortages: Shortage[] = [];
  for (const [no, n] of [...counts].sort((a, b) => a[0] - b[0])) {
    const own = getOwnedCount(save, no);
    if (n > own) shortages.push({ no, missing: n - own });
  }
  return { problems, shortages, usable: problems.length === 0 && shortages.length === 0 };
}

/** 保存しているデッキ（スロット番号）を調べる */
export function checkSavedDeck(save: SaveData, slot: number, rules: RuleSet = DEFAULT_RULES): DeckCheck {
  return checkDeckCards(save, save.decks[slot]?.cards ?? [], rules);
}

/** 全スロットについて、対戦に使えるか */
export function usableDecks(save: SaveData, rules: RuleSet = DEFAULT_RULES): boolean[] {
  return save.decks.map((_, i) => checkSavedDeck(save, i, rules).usable);
}
