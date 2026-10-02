import { describe, expect, it } from 'vitest';
import packsRaw from '../src/data/packs.json';
import { CARD_DB } from '../src/data/cards';
import { PACK_DATA } from '../src/data/packs';
import { DRAW, applyPull, canAfford, cardRate, convertSuper, drawBags, offerById, packById, type Bag } from '../src/gacha/gacha';
import { createDefaultSave } from '../src/save/saveData';
import { makeRandom } from './save.helpers';

/** パックガチャ（SPEC §7 S09・§16-2d。UPDATE_v2 §6） */

const ganso = packById('ganso')!;
const three = offerById('three')!;
const fifteen = offerById('fifteen')!;
const rand = (seed: number) => makeRandom(seed).next;

describe('G01 3袋・15袋：コインが減り、カードが増える', () => {
  it('3袋は50コイン、15袋は200コイン。引いたカードの数だけ所持数が増える（コインとカードは同じ下書きに書く）', () => {
    for (const [offer, price, bagsN] of [
      [three, 50, 3],
      [fifteen, 200, 15],
    ] as const) {
      const s = createDefaultSave();
      s.coins = 1000;
      const before = { ...s.collection };
      const bags = drawBags(ganso, offer.bags, rand(price));
      expect(bags).toHaveLength(bagsN);
      const results = applyPull(s, offer, bags)!;
      expect(s.coins).toBe(1000 - price);
      const pulled = bags.flatMap((b) => b.cards);
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
    const bags: Bag[] = [{ cards: [{ no: hasami, super: false }], double: false }, { cards: [{ no: hasami, super: false }], double: false }, { cards: [{ no: 1, super: false }], double: false }];
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
    expect(DRAW.superRate).toBe(packsRaw.draw.superRate);
    expect(DRAW.superRate).toBe(0.06);
    expect(DRAW.doubleRate).toBe(0.1);
    expect(DRAW.offers.map((o) => [o.bags, o.price])).toEqual([
      [3, 50],
      [15, 200],
    ]);
    expect(DRAW.superToCoins).toBe(50);
    for (const pack of PACK_DATA.packs) {
      const ids = [...new Set([...pack.normal, ...pack.super])];
      const total = ids.reduce((t, id) => t + cardRate(pack, id), 0);
      expect(total, pack.id).toBeCloseTo(1, 10);
      for (const id of pack.super) expect(cardRate(pack, id)).toBeCloseTo(0.06 / pack.super.length, 10);
      for (const id of pack.normal) expect(cardRate(pack, id)).toBeCloseTo(0.94 / pack.normal.length, 10);
    }
    // 限定カードはどのパックにも入っていない
    for (const pack of PACK_DATA.packs) for (const id of PACK_DATA.limited) expect([...pack.normal, ...pack.super]).not.toContain(id);
  });
});

describe('G05 スーパーレアの換金', () => {
  const kami = Object.values(CARD_DB).find((c) => c.id === 'kami')!.no;
  const revo = Object.values(CARD_DB).find((c) => c.id === 'revolution')!.no;

  it('すでに持っていたスーパーレアだけ換金できる（同じ回で先に引いた分も数える）', () => {
    const s = createDefaultSave(); // レボリューションは1枚持っている、かみは持っていない
    const bags: Bag[] = [{ cards: [{ no: revo, super: true }], double: false }, { cards: [{ no: kami, super: true }, { no: kami, super: true }], double: true }];
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
    applyPull(s, three, [{ cards: [{ no: 1, super: false }], double: false }]);
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
