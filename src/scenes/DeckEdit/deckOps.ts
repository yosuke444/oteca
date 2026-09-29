import type { DeckProblem } from '../../engine/deckValidate';
import type { CardDb, RuleSet } from '../../engine/types';

/**
 * デッキ編集の処理（画面から切り離した純粋な関数。SPEC §7 S02・§4-2）
 */

/** カードを入れられない理由 */
export type AddBlock = 'full' | 'super' | 'owned';

export type DeckSummary = { total: number; otege: number; item: number; super: number };

export function summarize(cards: number[], db: CardDb): DeckSummary {
  const s = { total: cards.length, otege: 0, item: 0, super: 0 };
  for (const no of cards) {
    const d = db[no];
    if (!d) continue;
    if (d.kind === 'otege') {
      s.otege += 1;
      if (d.rarity === 'super') s.super += 1;
    } else {
      s.item += 1;
    }
  }
  return s;
}

/** そのカードを1枚入れられるか。入れられなければ理由 */
export function checkAdd(
  cards: number[],
  no: number,
  db: CardDb,
  rules: RuleSet,
  owned: (no: number) => number,
): AddBlock | null {
  const def = db[no];
  if (cards.length >= rules.deckSize) return 'full';
  if (def?.kind === 'otege' && def.rarity === 'super' && summarize(cards, db).super >= rules.superMaxPerDeck) {
    return 'super';
  }
  if (cards.filter((c) => c === no).length >= owned(no)) return 'owned';
  return null;
}

/** 1枚入れる（No 順に並べておく） */
export function addCard(cards: number[], no: number): number[] {
  return [...cards, no].sort((a, b) => a - b);
}

/** i 番目の1枚を外す */
export function removeAt(cards: number[], index: number): number[] {
  return cards.filter((_, i) => i !== index);
}

/**
 * おまかせでうめる：残り枠を、おてあげ6〜7割／アイテム3〜4割でランダムに埋める（スーパーの制限と所持数を守る）
 * @param random 0以上1未満を返す関数（テストでは種付きのものを渡す）
 */
export function autoFill(
  cards: number[],
  db: CardDb,
  rules: RuleSet,
  owned: (no: number) => number,
  random: () => number,
): number[] {
  let deck = [...cards];
  const remaining = rules.deckSize - deck.length;
  if (remaining <= 0) return deck;

  const ratio = 0.6 + random() * 0.1;
  const targetOtege = Math.round(rules.deckSize * ratio);
  const now = summarize(deck, db);
  let otegeNeed = Math.min(remaining, Math.max(0, targetOtege - now.otege));
  let itemNeed = remaining - otegeNeed;

  const all = Object.values(db).sort((a, b) => a.no - b.no);
  const pick = (kind: 'otege' | 'item'): number | null => {
    const pool = all.filter((d) => d.kind === kind && checkAdd(deck, d.no, db, rules, owned) === null);
    if (pool.length === 0) return null;
    return pool[Math.floor(random() * pool.length)].no;
  };

  while (otegeNeed + itemNeed > 0) {
    const want: 'otege' | 'item' = otegeNeed > 0 ? 'otege' : 'item';
    const no = pick(want) ?? pick(want === 'otege' ? 'item' : 'otege');
    if (no === null) break;
    deck = addCard(deck, no);
    if (want === 'otege') otegeNeed -= 1;
    else itemNeed -= 1;
  }
  return deck;
}

/** ルール違反の文言（赤ペンで出す） */
export function problemText(p: DeckProblem): string {
  switch (p.code) {
    case 'size':
      return p.count < p.need ? `あと ${p.need - p.count}まい いれてね` : `${p.count - p.need}まい おおいよ`;
    case 'noOtege':
      return 'おてあげが 1まいも ないよ';
    case 'tooManySuper':
      return `スーパーは ${p.max}まい までだよ`;
    case 'unknownCard':
      return 'つかえない カードが はいってるよ';
  }
}

/** 入れられない時の文言 */
export function blockText(b: AddBlock, rules: RuleSet): string {
  switch (b) {
    case 'full':
      return `もう ${rules.deckSize}まい はいってるよ`;
    case 'super':
      return `スーパーは ${rules.superMaxPerDeck}まい までだよ`;
    case 'owned':
      return 'もう もっていないよ';
  }
}
