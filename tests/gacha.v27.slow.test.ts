import { describe, expect, it } from 'vitest';
import { SHOP_PACKS } from '../src/data/packs';
import { DRAW, drawOffer, normalGlowRate, offerById } from '../src/gacha/gacha';
import { makeRandom } from './save.helpers';

/** ⑤ 決まった種で 10万回引く：かくていの袋を除いた1袋あたりのスーパーの割合が 5% 前後（光る確率も今のまま。v2.7） */
describe('⑤ 10万回引いた時のスーパーの割合', () => {
  for (const id of ['two', 'ten'] as const) {
    it(`${id}：かくていを除いて 1袋 5%（スーパーの袋の80%・ノーマルの袋の約3.4%が光る）`, () => {
      const offer = offerById(id)!;
      for (const pack of SHOP_PACKS) {
        const r = makeRandom(pack.id.length * 9973 + offer.bags).next;
        let bags = 0;
        let supers = 0;
        let superGlow = 0;
        let normalGlow = 0;
        for (let i = 0; i < 100_000; i++) {
          for (const b of drawOffer(pack, offer, r)) {
            if (b.guaranteed) continue;
            bags += 1;
            if (b.card.super) {
              supers += 1;
              if (b.glow) superGlow += 1;
            } else if (b.glow) normalGlow += 1;
          }
        }
        const rate = supers / bags;
        expect(Math.abs(rate - DRAW.superRate), `${id} ${pack.id} ${(rate * 100).toFixed(3)}%`).toBeLessThan(5 * Math.sqrt((0.05 * 0.95) / bags));
        expect(Math.abs(superGlow / supers - DRAW.glowRate)).toBeLessThan(0.02);
        expect(Math.abs(normalGlow / (bags - supers) - normalGlowRate())).toBeLessThan(0.003);
      }
    });
  }
});
