import { describe, expect, it } from 'vitest';
import { CARD_DB, CARD_LIST } from '../src/data/cards';
import { PACK_DATA, parsePackData } from '../src/data/packs';
import raw from '../src/data/packs.json';
import { drawOffer, offerById, packById } from '../src/gacha/gacha';

/**
 * パックの枠とカードの種類（v2.7 の確認。すりむ を スーパーにした v2.4 のあと）
 * ① スーパーの枠にはスーパーおてあげだけ、通常の枠には通常のカードだけ
 * ③ かくていの袋で すりむ が出る（②の大量抽選は tests/packSlots.slow.test.ts）
 */
const isSuper = (id: string) => {
  const c = CARD_LIST.find((x) => x.id === id);
  return !!c && c.kind === 'otege' && c.rarity === 'super';
};

describe('① パックの枠はカードの種類（cards.json）と合っている', () => {
  it('すべてのパックで：スーパーの枠はスーパーだけ、通常の枠は通常だけ。両方に入るカードは無い', () => {
    for (const p of PACK_DATA.packs) {
      for (const id of p.super) expect(isSuper(id), `${p.id} のスーパーの枠の ${id}`).toBe(true);
      for (const id of p.normal) expect(isSuper(id), `${p.id} の通常の枠の ${id}`).toBe(false);
      expect(p.normal.filter((id) => p.super.includes(id)), p.id).toEqual([]);
    }
  });

  it('すりむ は よせあつめ のスーパーの枠だけ', () => {
    const where = PACK_DATA.packs.flatMap((p) => [...(p.normal.includes('surimu') ? [`${p.id}:normal`] : []), ...(p.super.includes('surimu') ? [`${p.id}:super`] : [])]);
    expect(where).toEqual(['yoseatsume:super']);
  });

  it('限定カード以外のスーパーおてあげは、どれかのパックのスーパーの枠に入っている', () => {
    const inSuper = new Set(PACK_DATA.packs.flatMap((p) => p.super));
    for (const c of CARD_LIST) if (c.kind === 'otege' && c.rarity === 'super' && !PACK_DATA.limited.includes(c.id) && !c.id.startsWith('trophy')) expect(inSuper.has(c.id), c.id).toBe(true);
  });

  it('枠と種類がずれた packs.json は読み込みで止まる（通常の枠にスーパー・スーパーの枠に通常）', () => {
    const bad1 = structuredClone(raw) as { packs: { normal: string[]; super: string[] }[] };
    bad1.packs[2].normal.push('surimu');
    expect(() => parsePackData(bad1)).toThrow(/スーパーです/);
    const bad2 = structuredClone(raw) as { packs: { normal: string[]; super: string[] }[] };
    bad2.packs[0].super.push('oteage');
    expect(() => parsePackData(bad2)).toThrow(/スーパーではありません/);
  });
});

describe('③ 10まいの かくていの袋で すりむ が出る', () => {
  it('かくていの袋（10袋目）はスーパーの枠から同じ確率で選ぶ：すりむ を選ぶ乱数なら すりむ', () => {
    const pack = packById('yoseatsume')!;
    const idx = pack.super.indexOf('surimu');
    // 1〜9袋目はふつうの袋（通常の目）、10袋目のスーパーの中ですりむを選ぶ
    const seq = [...Array.from({ length: 9 }, () => [0.99, 0.5, 0.99]).flat(), (idx + 0.5) / pack.super.length];
    let i = 0;
    const bags = drawOffer(pack, offerById('ten')!, () => seq[i++]);
    expect(bags[9]).toMatchObject({ guaranteed: true, card: { no: CARD_DB[42].no, super: true } });
    expect(CARD_DB[bags[9].card.no].id).toBe('surimu');
  });
});
