import { cardById } from './cards';

/** 初期デッキの中身（SPEC §5-4）。カードは id で指定し、数値は cards.json から引く */
export const STARTER_DECK: readonly (readonly [id: string, count: number])[] = [
  ['oteage', 2],
  ['mitsume', 2],
  ['otesage', 2],
  ['yotsuashi', 1],
  ['sanbon', 1],
  ['mutsuashi', 1],
  ['kami', 1],
  ['kusuri', 2],
  ['himitsu_yaiba', 1],
  ['kimyou_drink', 1],
  ['supodori', 1],
];

/** id と枚数の表 → カードNoの配列 */
export function buildDeck(spec: readonly (readonly [string, number])[]): number[] {
  const deck: number[] = [];
  for (const [id, count] of spec) {
    const def = cardById(id);
    if (!def) throw new Error(`カード ${id} は cards.json にありません`);
    for (let i = 0; i < count; i++) deck.push(def.no);
  }
  return deck;
}

export function starterDeckNos(): number[] {
  return buildDeck(STARTER_DECK);
}
