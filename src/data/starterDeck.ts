import { cardById } from './cards';

/**
 * 初期カード（SPEC §5-4・UPDATE_v2 §3-1）。カードは id で指定し、数値は cards.json から引く。
 * 新しく始めた人は、この15枚を持っていて、スロット1の初期デッキ「はじめてのデッキ」もこの15枚そのもの。
 * 今までのプレイヤーの移行（形式版数3 → 4）でも、この枚数を配る。
 */
export const STARTER_CARDS: readonly (readonly [id: string, count: number])[] = [
  ['oteage', 5],
  ['mitsume', 3],
  ['otesage', 2],
  ['revolution', 1],
  ['kusuri', 2],
  ['himitsu_yaiba', 2],
];

/** 初期デッキの名前（セーブに保存するデッキ名。プレイヤーが後から変えられる）。デッキ名は8文字までなので、企画書の「はじめての デッキ」から空白を除いた */
export const STARTER_DECK_NAME = 'はじめてのデッキ';

/** 初期コイン */
export const STARTER_COINS = 200;

/**
 * v1.4 までの初期デッキ（おてあげ10／アイテム5。アイテム4種がそろっている）。
 * ルールエンジン・CPU・通信のテストと、CPU の強さの確認（npm run ladder）で「ふつうのデッキ」として使う
 */
export const CLASSIC_DECK: readonly (readonly [id: string, count: number])[] = [
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

/** id と枚数の表 → カードNoの配列（表の順） */
export function buildDeck(spec: readonly (readonly [string, number])[]): number[] {
  const deck: number[] = [];
  for (const [id, count] of spec) {
    const def = cardById(id);
    if (!def) throw new Error(`カード ${id} は cards.json にありません`);
    for (let i = 0; i < count; i++) deck.push(def.no);
  }
  return deck;
}

/** v1.4 までの初期デッキ（カードNoの配列） */
export function classicDeckNos(): number[] {
  return buildDeck(CLASSIC_DECK);
}

/** 初期デッキ（カードNoの配列） */
export function starterDeckNos(): number[] {
  return buildDeck(STARTER_CARDS);
}

/** 初期カードの所持数（No → 枚数） */
export function starterCollection(): Record<number, number> {
  const out: Record<number, number> = {};
  for (const no of starterDeckNos()) out[no] = (out[no] ?? 0) + 1;
  return out;
}
