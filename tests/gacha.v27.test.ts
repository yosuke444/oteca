import { describe, expect, it } from 'vitest';
import packsRaw from '../src/data/packs.json';
import { CARD_DB } from '../src/data/cards';
import { SHOP_PACKS } from '../src/data/packs';
import { DRAW, applyPull, drawOffer, offerById } from '../src/gacha/gacha';
import { createDefaultSave } from '../src/save/saveData';
import { makeRandom } from './save.helpers';

/**
 * v2.7 パックガチャの枚数（値段はそのまま）：50コインで2袋、200コインで10袋。10袋目はスーパーおてあげ かくてい。2まいには かくてい無し。
 * 枚数・値段・かくていは packs.json の draw.offers にだけ書く
 */
const rand = (seed: number) => makeRandom(seed).next;
const two = offerById('two')!;
const ten = offerById('ten')!;

describe('① 50コインで2袋、200コインで10袋', () => {
  it('packs.json の値（コードに直接書かない）', () => {
    expect(packsRaw.draw.offers).toEqual([
      { id: 'two', bags: 2, price: 50, lastBagSuper: false },
      { id: 'ten', bags: 10, price: 200, lastBagSuper: true },
    ]);
    expect(DRAW.offers).toEqual(packsRaw.draw.offers);
  });

  it('引くと、その数の袋が出て、コインがその値段だけ減る', () => {
    for (const pack of SHOP_PACKS) {
      for (const [offer, n] of [[two, 2], [ten, 10]] as const) {
        const s = createDefaultSave();
        s.coins = 1000;
        const bags = drawOffer(pack, offer, rand(n * 7 + pack.id.length));
        expect(bags).toHaveLength(n);
        expect(applyPull(s, offer, bags)).toHaveLength(n);
        expect(s.coins).toBe(1000 - offer.price);
      }
    }
  });
});

describe('② 10袋目は必ずスーパー', () => {
  it('どのパックでも、10袋目はかくてい・光る・そのパックのスーパー。1〜9袋目はかくていではない', () => {
    for (const pack of SHOP_PACKS) {
      for (let seed = 1; seed <= 500; seed++) {
        const bags = drawOffer(pack, ten, rand(seed * 13 + pack.id.length));
        expect(bags[9]).toMatchObject({ guaranteed: true, glow: true, card: { super: true } });
        expect(pack.super).toContain(CARD_DB[bags[9].card.no].id);
        expect(bags.slice(0, 9).some((b) => b.guaranteed)).toBe(false);
      }
    }
  });
});

describe('③ 2まい には かくてい が無い', () => {
  it('どの袋も かくていではない（スーパーが0枚の回もある）', () => {
    for (const pack of SHOP_PACKS) {
      let zero = 0;
      for (let seed = 1; seed <= 500; seed++) {
        const bags = drawOffer(pack, two, rand(seed * 17 + pack.id.length));
        expect(bags.some((b) => b.guaranteed)).toBe(false);
        if (!bags.some((b) => b.card.super)) zero += 1;
      }
      expect(zero).toBeGreaterThan(400);
    }
  });
});
