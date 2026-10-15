import { describe, expect, it } from 'vitest';
import { CARD_LIST, cardById, trophyCardNo } from '../src/data/cards';
import { protocolVersion } from '../src/config/version';
import { createDefaultSave } from '../src/save/saveData';
import { LIST_FILTERS, listCards } from '../src/scenes/DeckEdit/cardList';
import { TROPHY_ICONS_MAX, trophyDisplay } from '../src/ui/common/trophyBadge';

/** 遊んでみての修正（v2.2。SPEC §16-2k） */

describe('K02 もやすの技（v2.2 で両方20下げた。v2.7 で 4-6 を80に。v2.7 のバランス調整で 4-6 は2枚捨てる）', () => {
  it('1-3：相手に60＋手札を1枚捨てる／4-6：相手に80＋手札を2枚捨てる', () => {
    const m = cardById('moyasu')!;
    if (m.kind !== 'otege') throw new Error('もやす');
    expect(m.moves.map((mv) => [mv.faces, mv.effects])).toEqual([
      [[1, 2, 3], [{ type: 'damage', amount: 60 }, { type: 'discard', count: 1, deckIfNoHand: true }]],
      [[4, 5, 6], [{ type: 'damage', amount: 80 }, { type: 'discard', count: 2, deckIfNoHand: true }]],
    ]);
    // v2.4：すりむ がスーパー・ひきかえカード・切断の決まりが変わったので 10。v2.5：持続効果の決まりが変わったので 11。v2.6：自爆で両方が気絶する順番が変わったので 12。v2.7：カードの数値とザムライのボスルールが変わったので 13。v2.7（ガチャ）：引ける枚数が 2まい・10まい に変わったので 14。v2.7（レート）：予備の待合所で2人だけなら直前の相手とも組むので 15。v2.7（4つの直し）：777ほん・スポドリの決まりが変わったので 16。v2.7（トロフィあげ）：17。v2.7（バランス調整）：4枚の数値ときみょうなドリンクの決まりが変わったので 18
    expect(protocolVersion).toBe(18);
  });
});

describe('K03 デッキ編集のカードいちらんは持っているカードだけ', () => {
  it('持っていないカードは出ない（どの絞り込み・並び替えでも）。「もっている」の絞り込みは無い', () => {
    const s = createDefaultSave();
    expect(LIST_FILTERS).toEqual(['all', 'otege', 'item', 'super']);
    for (const f of LIST_FILTERS)
      for (const sort of ['no', 'name', 'hp', 'owned'] as const)
        for (const pack of [null, 'ganso', 'shin', 'yoseatsume', 'limited']) {
          const list = listCards(s, f, pack, sort);
          for (const c of list) expect((s.collection[c.no] ?? 0) > 0, `${f} ${sort} ${pack} ${c.name}`).toBe(true);
        }
    // 初期のカードだけが並ぶ（持っていないカードは出ない）
    const all = listCards(s, 'all', null, 'no');
    expect(all.map((c) => c.no)).toEqual(CARD_LIST.filter((c) => (s.collection[c.no] ?? 0) > 0).map((c) => c.no));
    expect(all.length).toBeLessThan(CARD_LIST.length);
    // 手に入れたら出る。トロフィあげも持っていれば出る
    const kami = cardById('kami')!.no;
    expect(listCards(s, 'all', null, 'no').some((c) => c.no === kami)).toBe(false);
    s.collection[kami] = 1;
    s.trophies = [{ number: 12, receivedAt: 1 }];
    const after = listCards(s, 'all', null, 'no');
    expect(after.some((c) => c.no === kami)).toBe(true);
    expect(after.some((c) => c.no === trophyCardNo(12))).toBe(true);
    // デバッグの「ぜんぶ もっている」では全部出る
    s.unlockAll = true;
    expect(listCards(s, 'all', null, 'no').length).toBeGreaterThanOrEqual(CARD_LIST.length);
  });
});

describe('K08 トロフィあげの数の見せ方', () => {
  it('0個は何も出さない、5個までは絵の数、6個以上は5個の絵と「+1」「+2」…', () => {
    expect(TROPHY_ICONS_MAX).toBe(5);
    expect(trophyDisplay(0)).toEqual({ icons: 0, more: 0 });
    expect(trophyDisplay(1)).toEqual({ icons: 1, more: 0 });
    expect(trophyDisplay(5)).toEqual({ icons: 5, more: 0 });
    expect(trophyDisplay(6)).toEqual({ icons: 5, more: 1 });
    expect(trophyDisplay(7)).toEqual({ icons: 5, more: 2 });
    expect(trophyDisplay(123)).toEqual({ icons: 5, more: 118 });
    // 変な値は 0
    expect(trophyDisplay(-3)).toEqual({ icons: 0, more: 0 });
    expect(trophyDisplay(Number.NaN)).toEqual({ icons: 0, more: 0 });
  });
});
