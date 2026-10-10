import { describe, expect, it } from 'vitest';
import packsRaw from '../src/data/packs.json';
import { CARD_DB } from '../src/data/cards';
import { PACK_DATA, SHOP_PACKS } from '../src/data/packs';
import { DRAW, applyPull, canAfford, cardRate, convertSuper, drawBags, drawOffer, normalGlowRate, offerById, packById, revealKind, superRate, type Bag } from '../src/gacha/gacha';
import { createDefaultSave } from '../src/save/saveData';
import { makeRandom } from './save.helpers';

/** パックガチャ（SPEC §7 S09・§16-2d。UPDATE_v2 §6） */

const ganso = packById('ganso')!;
const three = offerById('three')!;
const fifteen = offerById('fifteen')!;
const rand = (seed: number) => makeRandom(seed).next;
/** 1袋（光らない・確定でない） */
const bag = (no: number, sr = false): Bag => ({ card: { no, super: sr }, glow: false, guaranteed: false });

describe('G01 3袋・15袋：コインが減り、カードが増える', () => {
  it('3袋は50コイン、15袋は200コイン。引いたカードの数だけ所持数が増える（コインとカードは同じ下書きに書く）', () => {
    for (const [offer, price, bagsN] of [
      [three, 50, 3],
      [fifteen, 200, 15],
    ] as const) {
      const s = createDefaultSave();
      s.coins = 1000;
      const before = { ...s.collection };
      const bags = drawOffer(ganso, offer, rand(price));
      expect(bags).toHaveLength(bagsN);
      const results = applyPull(s, offer, bags)!;
      expect(s.coins).toBe(1000 - price);
      // 1袋に1枚（v2.2）
      const pulled = bags.map((b) => b.card);
      expect(results).toHaveLength(pulled.length);
      const added = new Map<number, number>();
      for (const c of pulled) added.set(c.no, (added.get(c.no) ?? 0) + 1);
      for (const [no, n] of added) expect(s.collection[no], CARD_DB[no].name).toBe((before[no] ?? 0) + n);
      // ほかのカードは変わらない
      for (const [no, n] of Object.entries(before)) if (!added.has(Number(no))) expect(s.collection[Number(no)]).toBe(n);
      // 引いたカードはすべて、そのパックの中身
      for (const c of pulled) expect([...ganso.normal, ...ganso.super]).toContain(CARD_DB[c.no].id);
    }
  });

  it('NEW は初めて手に入れたカード（同じ回の2枚目は NEW ではない）', () => {
    const s = createDefaultSave();
    const hasami = Object.values(CARD_DB).find((c) => c.id === 'hasami')!.no;
    const bags: Bag[] = [bag(hasami), bag(hasami), bag(1)];
    const r = applyPull(s, three, bags)!;
    expect(r.map((x) => x.isNew)).toEqual([true, false, false]); // おてあげ（No1）は最初から持っている
    expect(r.map((x) => x.ownedAfter)).toEqual([1, 2, 6]);
  });
});

describe('G03 コインが足りない時は引けない', () => {
  it('コインもカードも変わらない', () => {
    const s = createDefaultSave();
    s.coins = 49;
    const before = structuredClone(s);
    expect(canAfford(s, three)).toBe(false);
    expect(applyPull(s, three, drawBags(ganso, 3, rand(1)))).toBeNull();
    expect(s).toEqual(before);
    s.coins = 199;
    expect(canAfford(s, fifteen)).toBe(false);
    s.coins = 200;
    expect(canAfford(s, fifteen)).toBe(true);
    expect(applyPull(s, fifteen, drawBags(ganso, 15, rand(2)))).not.toBeNull();
    expect(s.coins).toBe(0);
  });
});

describe('G04 パックの中身・確率は packs.json の値', () => {
  it('確率・値段・中身が packs.json と同じ。「なかみ」の確率の合計は100%', () => {
    // v2.2：スーパー 1袋 5%・スーパーの袋の光る確率 80%・15まいは最後の袋が確定（それぞれ packs.json の1か所）
    expect(DRAW.superRate).toBe(packsRaw.draw.superRate);
    expect(DRAW.superRate).toBe(0.05);
    expect(DRAW.glowRate).toBe(0.8);
    expect(DRAW.offers.map((o) => [o.bags, o.price, o.lastBagSuper])).toEqual([
      [3, 50, false],
      [15, 200, true],
    ]);
    expect(DRAW.superToCoins).toBe(50);
    // 2枚入り（ダブル）の設定は無い
    expect(Object.keys(packsRaw.draw).sort()).toEqual(['glowRate', 'offers', 'superRate', 'superToCoins']);
    for (const pack of SHOP_PACKS) {
      const ids = [...new Set([...pack.normal, ...pack.super])];
      const total = ids.reduce((t, id) => t + cardRate(pack, id), 0);
      expect(total, pack.id).toBeCloseTo(1, 10);
      // スーパーの中・ノーマルの中では、どれも同じ確率
      for (const id of pack.super) expect(cardRate(pack, id)).toBeCloseTo(0.05 / pack.super.length, 10);
      for (const id of pack.normal) expect(cardRate(pack, id)).toBeCloseTo(0.95 / pack.normal.length, 10);
      expect(superRate(pack)).toBe(0.05);
    }
    // スーパー1種類あたり：元祖 約1.7%、真 約1.7%、よせあつめ 2.5%
    expect(Math.round(cardRate(packById('ganso')!, 'kami') * 10000) / 100).toBe(1.67);
    expect(Math.round(cardRate(packById('shin')!, 'bakudan') * 10000) / 100).toBe(1.67);
    expect(Math.round(cardRate(packById('yoseatsume')!, 'medusa') * 10000) / 100).toBe(2.5);
    // デイリーパックはスーパーが無い
    expect(superRate(packById('daily')!)).toBe(0);
    // ノーマルの袋の光る確率：0.8 × 0.05 ÷ 0.95（約4.2%）。光った袋のスーパー率が 50%
    expect(normalGlowRate()).toBeCloseTo((0.8 * 0.05) / 0.95, 12);
    const glowSuper = 0.05 * 0.8;
    const glowNormal = 0.95 * normalGlowRate();
    expect(glowSuper / (glowSuper + glowNormal)).toBeCloseTo(0.5, 12);
    expect(glowSuper + glowNormal).toBeCloseTo(0.08, 12);
    // 限定カードはどのパックにも入っていない
    for (const pack of PACK_DATA.packs) for (const id of PACK_DATA.limited) expect([...pack.normal, ...pack.super]).not.toContain(id);
  });
});

describe('G05 スーパーレアの換金', () => {
  const kami = Object.values(CARD_DB).find((c) => c.id === 'kami')!.no;
  const revo = Object.values(CARD_DB).find((c) => c.id === 'revolution')!.no;

  it('すでに持っていたスーパーレアだけ換金できる（同じ回で先に引いた分も数える）', () => {
    const s = createDefaultSave(); // レボリューションは1枚持っている、かみは持っていない
    const bags: Bag[] = [bag(revo, true), bag(kami, true), bag(kami, true)];
    const r = applyPull(s, three, bags)!;
    expect(r.map((x) => [x.no, x.convertible, x.isNew])).toEqual([
      [revo, true, false],
      [kami, false, true],
      [kami, true, false],
    ]);
  });

  it('換金すると所持数 -1・コイン +50（同じ下書き）。持っていなければ何もしない', () => {
    const s = createDefaultSave();
    s.collection[revo] = 2;
    const coins = s.coins;
    expect(convertSuper(s, revo)).toBe(true);
    expect(s.collection[revo]).toBe(1);
    expect(s.coins).toBe(coins + 50);
    expect(convertSuper(s, kami)).toBe(false);
    expect(s.coins).toBe(coins + 50);
  });
});

describe('G06 上限', () => {
  it('所持数は999、コインは99,999を超えない', () => {
    const s = createDefaultSave();
    s.coins = 99990;
    s.collection[1] = 999;
    applyPull(s, three, [bag(1)]);
    expect(s.collection[1]).toBe(999);
    const revo = Object.values(CARD_DB).find((c) => c.id === 'revolution')!.no;
    s.collection[revo] = 5;
    // 換金でコインが上限を超えるなら、換金しない（カードだけ減って損をしないように）
    s.coins = 99990;
    expect(convertSuper(s, revo)).toBe(false);
    expect(s.coins).toBe(99990);
    expect(s.collection[revo]).toBe(5);
    s.coins = 99949;
    expect(convertSuper(s, revo)).toBe(true);
    expect(s.coins).toBe(99999);
    expect(s.collection[revo]).toBe(4);
  });
});

describe('G08 15まいガチャの最後の袋は確定（v2.2）', () => {
  it('15袋目は必ずスーパーおてあげ（そのパックのスーパーから）で、必ず光る。3まいガチャには確定が無い', () => {
    for (const pack of SHOP_PACKS) {
      for (let seed = 1; seed <= 300; seed++) {
        const bags = drawOffer(pack, fifteen, rand(seed * 31 + pack.id.length));
        expect(bags).toHaveLength(15);
        const last = bags[14];
        expect(last.guaranteed).toBe(true);
        expect(last.glow).toBe(true);
        expect(last.card.super).toBe(true);
        expect(pack.super).toContain(CARD_DB[last.card.no].id);
        // それより前の袋は確定ではない
        expect(bags.slice(0, 14).every((b) => !b.guaranteed)).toBe(true);
        // 3まいには確定が無い
        expect(drawOffer(pack, three, rand(seed)).every((b) => !b.guaranteed)).toBe(true);
      }
    }
  });

  it('確定の袋の中身は、そのパックのスーパーおてあげから同じ確率（元祖の3種類がそれぞれ約1/3）', () => {
    const count = new Map<number, number>();
    const N = 6000;
    for (let i = 0; i < N; i++) {
      const last = drawOffer(ganso, fifteen, rand(i + 1))[14];
      count.set(last.card.no, (count.get(last.card.no) ?? 0) + 1);
    }
    expect(count.size).toBe(3);
    for (const n of count.values()) expect(Math.abs(n / N - 1 / 3)).toBeLessThan(0.03);
  });

  it('デイリーパック（売らないパック）は光らせない', () => {
    const bags = drawBags(packById('daily')!, 3000, rand(9));
    expect(bags.some((b) => b.glow || b.guaranteed || b.card.super)).toBe(false);
  });

  it('めくり方：確定／光ってスーパー／光ってノーマル（ぺらっ）／光らずスーパー（サプライズ）／ノーマル', () => {
    // 確定の袋も、ふつうのスーパーレアと同じ演出（v2.3）
    expect(revealKind({ glow: true, guaranteed: true }, true)).toBe('super');
    expect(revealKind({ glow: true, guaranteed: false }, true)).toBe('super');
    expect(revealKind({ glow: true, guaranteed: false }, false)).toBe('letdown');
    expect(revealKind({ glow: false, guaranteed: false }, true)).toBe('surprise');
    expect(revealKind({ glow: false, guaranteed: false }, false)).toBe('normal');
  });
});
