// 重いテスト（npm run test:slow）：デイリーパックの大量抽選（CLAUDE.md 14）
import { describe, expect, it } from 'vitest';
import { CARD_DB } from '../src/data/cards';
import { dailyPack, drawDailyBags } from '../src/daily/daily';
import { cardRate, drawBags } from '../src/gacha/gacha';
import { makeRandom } from './save.helpers';

describe('M05 デイリーパックを10万袋引くと、スーパーおてあげが一度も出ない', () => {
  it('スーパーは0、35種類（v2.4：すりむ がスーパーになって36 → 35）すべてがだいたい同じ確率、1袋に1枚、光らない（v2.2）', () => {
    const pack = dailyPack();
    const bags = drawBags(pack, 100000, makeRandom(20261003).next);
    const cards = bags.map((b) => b.card);
    expect(bags.some((b) => b.glow || b.guaranteed)).toBe(false);
    // スーパーおてあげは一度も出ない（印でも、カードの種類でも）
    expect(cards.filter((c) => c.super)).toHaveLength(0);
    expect(cards.filter((c) => { const d = CARD_DB[c.no]; return d.kind === 'otege' && d.rarity === 'super'; })).toHaveLength(0);
    const count = new Map<string, number>();
    for (const c of cards) count.set(CARD_DB[c.no].id, (count.get(CARD_DB[c.no].id) ?? 0) + 1);
    expect(count.size).toBe(35);
    for (const id of pack.normal) {
      expect(cardRate(pack, id)).toBeCloseTo(1 / 35, 10);
      const got = (count.get(id) ?? 0) / cards.length;
      expect(Math.abs(got - 1 / 35) * 35, id).toBeLessThan(0.1);
    }
    // 「ぜんぶ クリア」の報酬で引く3袋も、デイリーパック
    const three = drawDailyBags(makeRandom(1).next);
    expect(three).toHaveLength(3);
    for (const b of three) expect(pack.normal).toContain(CARD_DB[b.card.no].id);
  });
});
