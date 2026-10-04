import { describe, expect, it } from 'vitest';
import { CARD_DB } from '../src/data/cards';
import { PACK_DATA, SHOP_PACKS, inPack, parsePackData } from '../src/data/packs';
import { DEFAULT_RULES, validateDeck } from '../src/engine';
import { checkSavedDeck, getOwnedCount, usableDecks } from '../src/save/collection';
import { createDefaultSave, type SaveData } from '../src/save/saveData';
import { addCard, autoFill, checkAdd } from '../src/scenes/DeckEdit/deckOps';
import { noOf } from './helpers';
import { makeRandom } from './save.helpers';

/** デッキ編集の「一覧のカードをタップ」と同じ処理（入れられなければ理由を返す） */
function tapCard(save: SaveData, slot: number, no: number): string | null {
  const deck = save.decks[slot].cards;
  const block = checkAdd(deck, no, CARD_DB, DEFAULT_RULES, (n) => getOwnedCount(save, n));
  if (block) return block;
  save.decks[slot].cards = addCard(deck, no);
  return null;
}

describe('V09 在庫はデッキごと（SPEC §4-2・UPDATE_v2 §3-1）', () => {
  it('おてあげを5枚持っている時、スロット1とスロット2の両方に5枚ずつ入れられる', () => {
    const save = createDefaultSave();
    const oteage = noOf('oteage');
    expect(getOwnedCount(save, oteage)).toBe(5);
    save.decks[0].cards = []; // 初期デッキを空にしてから
    for (const slot of [0, 1]) {
      for (let i = 0; i < 5; i++) expect(tapCard(save, slot, oteage), `スロット${slot + 1} ${i + 1}枚目`).toBeNull();
    }
    expect(save.decks[0].cards).toEqual([oteage, oteage, oteage, oteage, oteage]);
    expect(save.decks[1].cards).toEqual([oteage, oteage, oteage, oteage, oteage]);
    // 6枚目はどちらにも入れられない（「もう もっていないよ」）
    expect(tapCard(save, 0, oteage)).toBe('owned');
    expect(tapCard(save, 1, oteage)).toBe('owned');
    // ほかのデッキで使っていても、3つ目のスロットにも5枚入る。所持数は減らない
    for (let i = 0; i < 5; i++) expect(tapCard(save, 2, oteage)).toBeNull();
    expect(getOwnedCount(save, oteage)).toBe(5);
    for (const slot of [0, 1, 2]) expect(checkSavedDeck(save, slot).shortages).toEqual([]);
  });

  it('初期デッキと同じ15枚を、20スロットすべてに作れる（どのデッキも使える）', () => {
    const save = createDefaultSave();
    const starter = [...save.decks[0].cards];
    for (let slot = 1; slot < 20; slot++) for (const no of starter) expect(tapCard(save, slot, no)).toBeNull();
    expect(usableDecks(save)).toEqual(Array.from({ length: 20 }, () => true));
  });

  it('持っていないカードは1枚も入れられない', () => {
    const save = createDefaultSave();
    for (const id of ['yotsuashi', 'sanbon', 'kami', 'kimyou_drink', 'supodori']) {
      expect(getOwnedCount(save, noOf(id))).toBe(0);
      expect(tapCard(save, 1, noOf(id))).toBe('owned');
    }
  });

  it('おまかせでうめる も所持数を守る（どのデッキでも）', () => {
    const save = createDefaultSave();
    const r = makeRandom(3);
    for (let slot = 1; slot < 6; slot++) {
      const deck = autoFill([], CARD_DB, DEFAULT_RULES, (n) => getOwnedCount(save, n), r.next);
      save.decks[slot].cards = deck;
      expect(deck).toHaveLength(15);
      expect(validateDeck(deck, CARD_DB)).toEqual([]);
      expect(checkSavedDeck(save, slot)).toEqual({ problems: [], shortages: [], usable: true });
    }
  });

  it('unlockAll（開発用）なら無制限', () => {
    const save = { ...createDefaultSave(), unlockAll: true };
    expect(getOwnedCount(save, noOf('kami'))).toBe(Infinity);
  });
});

describe('V10 所持数が減ったデッキ（トレードなど）', () => {
  it('使えなくなり、足りないカードと枚数が分かる（デッキは消さない）', () => {
    const save = createDefaultSave();
    const oteage = noOf('oteage');
    save.collection[oteage] = 3; // 5枚 → 3枚
    delete save.collection[noOf('revolution')]; // 1枚 → 0枚
    const check = checkSavedDeck(save, 0);
    expect(check.problems).toEqual([]);
    expect(check.shortages).toEqual([
      { no: oteage, missing: 2 },
      { no: noOf('revolution'), missing: 1 },
    ]);
    expect(check.usable).toBe(false);
    expect(usableDecks(save)[0]).toBe(false);
    expect(save.decks[0].cards).toHaveLength(15);
    // 持っている分（3枚）までなら、ほかのデッキに入れられる
    for (let i = 0; i < 3; i++) expect(tapCard(save, 1, oteage)).toBeNull();
    expect(tapCard(save, 1, oteage)).toBe('owned');
  });

  it('ルール違反と所持数の不足は別々に分かる', () => {
    const save = createDefaultSave();
    save.decks[1].cards = [noOf('kusuri'), noOf('kusuri'), noOf('kusuri')];
    const check = checkSavedDeck(save, 1);
    expect(check.problems.map((p) => p.code).sort()).toEqual(['noOtege', 'size']);
    expect(check.shortages).toEqual([{ no: noOf('kusuri'), missing: 1 }]);
    expect(check.usable).toBe(false);
  });
});

describe('パックの中身（packs.json。デッキ編集の絞り込み）', () => {
  it('どのパックのカードも cards.json にあり、ノーマルとスーパーの分け方が正しい', () => {
    expect(PACK_DATA.packs.map((p) => p.id)).toEqual(['ganso', 'shin', 'yoseatsume', 'daily']);
    // 売るのは3つ（デイリーパックは売らない。v2.1-M）
    expect(SHOP_PACKS.map((p) => p.id)).toEqual(['ganso', 'shin', 'yoseatsume']);
    expect(inPack('kami', 'ganso')).toBe(true);
    expect(inPack('kami', 'shin')).toBe(false);
    expect(inPack('oteage', 'yoseatsume')).toBe(true);
    expect(inPack('oteage', 'limited')).toBe(false);
  });

  it('形のおかしい packs.json はエラー', () => {
    const ok = {
      version: 1,
      packs: [{ id: 'a', name: 'A', short: 'A', color: 'blue', normal: ['oteage'], super: ['kami'] }],
      limited: [],
      draw: { superRate: 0.05, glowRate: 0.8, offers: [{ id: 'x', bags: 3, price: 50, lastBagSuper: false }], superToCoins: 50 },
    };
    expect(() => parsePackData(ok)).not.toThrow();
    expect(() => parsePackData({ ...ok, packs: [{ ...ok.packs[0], normal: ['nai'] }] })).toThrow('nai');
    expect(() => parsePackData({ ...ok, packs: [{ ...ok.packs[0], super: ['oteage'] }] })).toThrow('スーパーではありません');
    expect(() => parsePackData({ ...ok, packs: [{ ...ok.packs[0], normal: ['kami'] }] })).toThrow('スーパーです');
    expect(() => parsePackData({ ...ok, limited: ['nai'] })).toThrow('limited');
  });
});
