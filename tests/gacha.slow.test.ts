// 重いテスト（npm run test:slow）：ガチャの大量抽選（CLAUDE.md 14）
import { describe, expect, it } from 'vitest';
import { CARD_DB } from '../src/data/cards';
import { SHOP_PACKS } from '../src/data/packs';
import { cardRate, drawBags, drawOffer, offerById, packById } from '../src/gacha/gacha';
import { makeRandom } from './save.helpers';

const rand = (seed: number) => makeRandom(seed).next;
const pct = (x: number) => `${(x * 100).toFixed(2)}%`;

describe('G02 各パック10万袋のふだんの袋（v2.2）', () => {
  it('スーパーはどのパックでも約5%、光った袋のスーパーは約50%、スーパーの袋の光るのは約80%。どのカードも同じ確率。2枚入りは無い', () => {
    for (const pack of SHOP_PACKS) {
      const N = 100000;
      const bags = drawBags(pack, N, rand(pack.id.length * 7919));
      // 1袋に1枚。ふだんの袋に確定の袋は無い
      expect(bags.every((b) => 'card' in b && !Array.isArray((b as unknown as { cards?: unknown }).cards))).toBe(true);
      expect(bags.some((b) => b.guaranteed)).toBe(false);
      const supers = bags.filter((b) => b.card.super);
      const glowed = bags.filter((b) => b.glow);
      const superRate = supers.length / N;
      const glowSuper = glowed.filter((b) => b.card.super).length / glowed.length;
      const superGlow = supers.filter((b) => b.glow).length / supers.length;
      const glowAll = glowed.length / N;
      console.log(`[G02] ${pack.name}：スーパー ${pct(superRate)}・光った袋のスーパー ${pct(glowSuper)}・スーパーの袋の光る ${pct(superGlow)}・光る袋 ${pct(glowAll)}`);
      expect(Math.abs(superRate - 0.05), `${pack.id} スーパー ${superRate}`).toBeLessThan(0.003);
      expect(Math.abs(glowSuper - 0.5), `${pack.id} 光った袋のスーパー ${glowSuper}`).toBeLessThan(0.025);
      expect(Math.abs(superGlow - 0.8), `${pack.id} スーパーの袋の光る ${superGlow}`).toBeLessThan(0.02);
      expect(Math.abs(glowAll - 0.08), `${pack.id} 光る袋 ${glowAll}`).toBeLessThan(0.004);
      // スーパーレアの印と、カードの種類が合っている
      for (const b of bags.slice(0, 2000)) {
        const def = CARD_DB[b.card.no];
        expect(def.kind === 'otege' && def.rarity === 'super').toBe(b.card.super);
      }
      // どのカードも出る。スーパーの中・ノーマルの中では、どれもだいたい同じ確率
      const count = new Map<string, number>();
      for (const b of bags) count.set(CARD_DB[b.card.no].id, (count.get(CARD_DB[b.card.no].id) ?? 0) + 1);
      for (const id of [...pack.normal, ...pack.super]) {
        const got = (count.get(id) ?? 0) / N;
        const want = cardRate(pack, id);
        expect(Math.abs(got - want) / want, `${pack.id} ${id}`).toBeLessThan(0.15);
      }
    }
  });
});

describe('G09 1万回の10まいガチャ（v2.2。v2.7 で15まい→10まい）', () => {
  it('1回あたりのスーパーの数は平均約1.45枚（9袋 × 5% ＋ 確定1）、0枚の回が無い。最後の袋はいつもスーパー', () => {
    const ten = offerById('ten')!;
    for (const pack of SHOP_PACKS) {
      const N = 10000;
      const r = rand(pack.id.length * 104729);
      let total = 0;
      let zero = 0;
      let lastSuper = 0;
      for (let i = 0; i < N; i++) {
        const bags = drawOffer(pack, ten, r);
        const n = bags.filter((b) => b.card.super).length;
        total += n;
        if (n === 0) zero += 1;
        if (bags[9].card.super && bags[9].guaranteed) lastSuper += 1;
      }
      const avg = total / N;
      console.log(`[G09] ${pack.name}：10まい1回あたりのスーパー 平均 ${avg.toFixed(3)}枚・0枚の回 ${zero}回`);
      expect(zero).toBe(0);
      expect(lastSuper).toBe(N);
      expect(Math.abs(avg - 1.45), `${pack.id} 平均 ${avg}`).toBeLessThan(0.03);
    }
  });
});

describe('M05 デイリーパック（v2.2）', () => {
  it('光らず、スーパーも出ない', () => {
    const bags = drawBags(packById('daily')!, 100000, rand(5));
    expect(bags.some((b) => b.glow)).toBe(false);
    expect(bags.some((b) => b.card.super || b.guaranteed)).toBe(false);
  });
});
