import { DEFAULT_RULES } from './rules';
import type { CardDb, RuleSet } from './types';

/** デッキのルール違反（SPEC §4-2）。画面の文言は画面側で付ける */
export type DeckProblem =
  | { code: 'size'; count: number; need: number }
  | { code: 'noOtege' }
  | { code: 'tooManySuper'; count: number; max: number }
  | { code: 'unknownCard'; no: number };

/** デッキを調べて、違反の一覧を返す（空なら使えるデッキ） */
export function validateDeck(cards: number[], cardDb: CardDb, rules: RuleSet = DEFAULT_RULES): DeckProblem[] {
  const problems: DeckProblem[] = [];
  let otege = 0;
  let supers = 0;
  const unknown = new Set<number>();

  for (const no of cards) {
    const def = cardDb[no];
    if (!def) {
      unknown.add(no);
      continue;
    }
    if (def.kind === 'otege') {
      otege += 1;
      if (def.rarity === 'super') supers += 1;
    }
  }

  if (cards.length !== rules.deckSize) problems.push({ code: 'size', count: cards.length, need: rules.deckSize });
  if (otege === 0) problems.push({ code: 'noOtege' });
  if (supers > rules.superMaxPerDeck) problems.push({ code: 'tooManySuper', count: supers, max: rules.superMaxPerDeck });
  for (const no of unknown) problems.push({ code: 'unknownCard', no });
  return problems;
}

export function isDeckValid(cards: number[], cardDb: CardDb, rules: RuleSet = DEFAULT_RULES): boolean {
  return validateDeck(cards, cardDb, rules).length === 0;
}
