import { features } from '../config/features';
import { CARD_DB, trophyDef, trophyNumberOf } from '../data/cards';
import { type DeckProblem, DEFAULT_RULES, validateDeck } from '../engine';
import type { CardDef, RuleSet } from '../engine/types';
import type { SaveData } from './saveData';

/**
 * 所持カードの窓口（SPEC §13-2・§4-2）
 * デッキ編集・デッキ選択は、カードを使えるかどうかを必ずここ経由で調べる。
 * 在庫はデッキごと：1つのデッキには所持数まで入れられ、ほかのデッキで使っている枚数は関係ない。
 */

/** そのカードの所持数。features.collection が false か unlockAll の時は無制限（Infinity） */
export function getOwnedCount(save: Pick<SaveData, 'collection' | 'unlockAll'> & Partial<Pick<SaveData, 'trophies'>>, no: number): number {
  // トロフィーのカード（v2.0-J）：その番号を受け取っていれば1枚（無制限の時も、持っていない番号は使えない）
  const n = trophyNumberOf(no);
  if (n !== null) return save.trophies?.some((t) => t.number === n) ? 1 : 0;
  if (!features.collection || save.unlockAll) return Infinity;
  return save.collection[no] ?? 0;
}

/** 持っているトロフィーのカードの定義（デッキ編集の一覧に出す） */
export function ownedTrophyDefs(save: Partial<Pick<SaveData, 'trophies'>>): CardDef[] {
  return (save.trophies ?? []).map((t) => trophyDef(t.number));
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
  save: Pick<SaveData, 'collection' | 'unlockAll'> & Partial<Pick<SaveData, 'trophies'>>,
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

/** そのデッキが「スーパーおてあげが多すぎる」で使えないか（v2.4：すりむ がスーパーになって、前のデッキが決まりに合わなくなった時） */
export function hasTooManySuper(save: SaveData, slot: number, rules: RuleSet = DEFAULT_RULES): boolean {
  return checkSavedDeck(save, slot, rules).problems.some((p) => p.code === 'tooManySuper');
}

/**
 * 選んでいるデッキがスーパーおてあげ2枚以上で使えない時、使えるほかのデッキに切り替える（v2.4。起動・引き継ぎの時）。
 * デッキは消さない（デッキ編集で直せば、また使える）。使えるデッキが無い時は、そのまま（メニューでデッキ編集へ案内する）
 */
export function switchFromTooManySuper(save: SaveData, rules: RuleSet = DEFAULT_RULES): SaveData {
  if (!hasTooManySuper(save, save.selectedDeck, rules)) return save;
  const next = usableDecks(save, rules).indexOf(true);
  return next < 0 ? save : { ...save, selectedDeck: next };
}

/** 選んでいるデッキがスーパーおてあげ2枚以上で、ほかに使えるデッキも無い（メニューでデッキ編集へ案内する。v2.4） */
export function needsSuperFix(save: SaveData, rules: RuleSet = DEFAULT_RULES): boolean {
  return hasTooManySuper(save, save.selectedDeck, rules) && !usableDecks(save, rules).includes(true);
}
