import { describe, expect, it } from 'vitest';
import { CARD_DB } from '../src/data/cards';
import { PACK_DATA } from '../src/data/packs';
import { seedRng } from '../src/engine';
import { nextInt } from '../src/engine/rng';
import { drawBag, drawOffer, offerById, packById } from '../src/gacha/gacha';

/**
 * ② 決まった種で 10万袋：すりむ の割合が ほかのスーパーと同じくらい（1袋5% ÷ そのパックのスーパーの種類数）
 * かくていの袋でも、すりむ が ほかのスーパーと同じ確率（1/3）
 */
const rand = (seed: string) => {
  const rng = seedRng(seed);
  return () => nextInt(rng, 2 ** 30) / 2 ** 30;
};
const N = 100_000;

describe('② 10万袋のスーパーの割合', () => {
  for (const pack of PACK_DATA.packs) {
    it(`${pack.id}：スーパーは どれも 5% ÷ 種類数、通常は 95% ÷ 種類数`, () => {
      const r = rand(`pack-rate-${pack.id}`);
      const count: Record<string, number> = {};
      for (let i = 0; i < N; i++) {
        const id = CARD_DB[drawBag(pack, r).card.no].id;
        count[id] = (count[id] ?? 0) + 1;
      }
      const sr = pack.super.length > 0 ? PACK_DATA.draw.superRate : 0;
      // 標準偏差の5倍まで（10万袋なら スーパー1種 1.67% の ±0.2%）
      const near = (id: string, p: number) => {
        const got = (count[id] ?? 0) / N;
        expect(Math.abs(got - p), `${pack.id} ${id} ${(got * 100).toFixed(3)}%（${(p * 100).toFixed(3)}% のはず）`).toBeLessThan(5 * Math.sqrt((p * (1 - p)) / N) + 1e-9);
      };
      for (const id of pack.super) near(id, sr / pack.super.length);
      for (const id of pack.normal) near(id, (1 - sr) / pack.normal.length);
      if (!pack.super.includes('surimu')) expect(count.surimu ?? 0, pack.id).toBe(0);
    });
  }

  it('かくていの袋（よせあつめ 10まい × 3万回）：すりむ・ぱわー・めでゅーさ が どれも 1/3', () => {
    const pack = packById('yoseatsume')!;
    const r = rand('pack-rate-guaranteed');
    const count: Record<string, number> = {};
    const M = 30_000;
    for (let i = 0; i < M; i++) {
      const last = drawOffer(pack, offerById('ten')!, r)[9];
      expect(last.guaranteed && last.card.super).toBe(true);
      const id = CARD_DB[last.card.no].id;
      count[id] = (count[id] ?? 0) + 1;
    }
    for (const id of pack.super) expect(Math.abs(count[id] / M - 1 / 3), id).toBeLessThan(5 * Math.sqrt((1 / 3) * (2 / 3) / M));
  });
});
