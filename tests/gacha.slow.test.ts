// 重いテスト（npm run test:slow）：ガチャの大量抽選（CLAUDE.md 14）
import { describe, expect, it } from 'vitest';
import { CARD_DB } from '../src/data/cards';
import { PACK_DATA } from '../src/data/packs';
import { cardRate, drawBags } from '../src/gacha/gacha';
import { makeRandom } from './save.helpers';

const rand = (seed: number) => makeRandom(seed).next;

describe('G02 10万袋を引くと、スーパーレア約6%・ダブル約10%', () => {
  it('どのパックでも、確率どおりに出て、どのカードも出る', () => {
    for (const pack of PACK_DATA.packs) {
      const bags = drawBags(pack, 100000, rand(pack.id.length * 7919));
      const cards = bags.flatMap((b) => b.cards);
      const doubles = bags.filter((b) => b.double).length / bags.length;
      const supers = cards.filter((c) => c.super).length / cards.length;
      expect(doubles, `${pack.id} ダブル`).toBeGreaterThan(0.096);
      expect(doubles, `${pack.id} ダブル`).toBeLessThan(0.104);
      expect(supers, `${pack.id} スーパーレア`).toBeGreaterThan(0.057);
      expect(supers, `${pack.id} スーパーレア`).toBeLessThan(0.063);
      // スーパーレアの印と、カードの種類が合っている
      for (const c of cards.slice(0, 2000)) {
        const def = CARD_DB[c.no];
        expect(def.kind === 'otege' && def.rarity === 'super').toBe(c.super);
      }
      // どのカードも出る。それぞれの中ではだいたい同じ確率
      const count = new Map<string, number>();
      for (const c of cards) count.set(CARD_DB[c.no].id, (count.get(CARD_DB[c.no].id) ?? 0) + 1);
      for (const id of [...pack.normal, ...pack.super]) {
        const got = (count.get(id) ?? 0) / cards.length;
        const want = cardRate(pack, id);
        expect(Math.abs(got - want) / want, `${pack.id} ${id}`).toBeLessThan(0.15);
      }
    }
  });
});
