import { it } from 'vitest';
import { ITEMS, OTEGE, baseDecks, swapMatch, writeRaw, type SwapStat } from './lib';

/** 3. デッキに入れた時の効き目（8つに分けて同時に動かす。この file は 0 番目）。1枚につき 3デッキ × 668試合 ＝ 2004試合 */
const PART = 0;
const PER_DECK = 668;

it('3. デッキに入れた時の効き目（0）', () => {
  const cards = [...OTEGE, ...ITEMS].map((c) => c.no).filter((_, i) => i % 8 === PART);
  const out: Record<string, Record<string, SwapStat>> = {};
  // 0 番目は、入れかえない時（基準のデッキどうし）も測る
  for (const card of PART === 0 ? [null, ...cards] : cards) {
    out[String(card)] = {};
    for (const base of baseDecks()) out[String(card)][base.name] = swapMatch(base, card, PER_DECK);
  }
  writeRaw('part3-0', out);
}, 6 * 60 * 60 * 1000);
