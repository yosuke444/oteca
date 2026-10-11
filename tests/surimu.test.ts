import { describe, expect, it } from 'vitest';
import { CARD_DB, cardById } from '../src/data/cards';
import { PACK_DATA } from '../src/data/packs';
import { DEFAULT_RULES, validateDeck } from '../src/engine';
import { applyBags, convertSuper, drawBags, packById } from '../src/gacha/gacha';
import { encodeSave } from '../src/save/binary';
import { checkSavedDeck, hasTooManySuper, needsSuperFix, switchFromTooManySuper, usableDecks } from '../src/save/collection';
import { decodeSave } from '../src/save/migrate';
import { createDefaultSave } from '../src/save/saveData';
import { checkAdd } from '../src/scenes/DeckEdit/deckOps';
import { STORY } from '../src/story/story';

/**
 * S01〜S03 すりむ（No42）をスーパーおてあげにした（v2.4）。
 * HP・技は変えない。パックはよせあつめのスーパーの枠。デッキに合計1枚まで。今までのデッキは消さずに残す
 */
const SURIMU = cardById('surimu')!;
const no = (id: string) => cardById(id)!.no;
const isSuper = (n: number) => CARD_DB[n].kind === 'otege' && CARD_DB[n].rarity === 'super';

describe('S01 すりむ はスーパーおてあげ', () => {
  it('cards.json の種類がスーパー。No・HP・技は前のまま', () => {
    expect(SURIMU.no).toBe(42);
    expect(SURIMU.kind).toBe('otege');
    expect(SURIMU.kind === 'otege' && SURIMU.rarity).toBe('super');
    expect(SURIMU.kind === 'otege' && SURIMU.hp).toBe(130);
    expect(SURIMU.kind === 'otege' && SURIMU.moves).toEqual([
      { faces: [1], effects: [{ type: 'damage', amount: 30 }] },
      { faces: [2], effects: [{ type: 'heal', amount: 20 }] },
      { faces: [3], effects: [{ type: 'damage', amount: 0, then: [40] }] },
      { faces: [4], effects: [{ type: 'heal', amount: 0, then: [30] }] },
      { faces: [5], effects: [{ type: 'draw', count: 1 }] },
      { faces: [6], effects: [{ type: 'damage', amount: 50 }, { type: 'heal', amount: 40 }] },
    ]);
  });

  it('パックでは よせあつめ のスーパーの枠だけ（どのパックの通常の枠にも無い。デイリーパックにも無い）。スーパーの確率は 5% のまま', () => {
    expect(packById('yoseatsume')!.super).toContain('surimu');
    for (const p of PACK_DATA.packs) expect(p.normal).not.toContain('surimu');
    expect(PACK_DATA.draw.superRate).toBe(0.05);
    expect(PACK_DATA.draw.offers.find((o) => o.id === 'fifteen')!.lastBagSuper).toBe(true);
  });

  it('引くとスーパーとして出る（すでに持っていれば換金できる）', () => {
    const pack = packById('yoseatsume')!;
    // スーパーの袋を出し、その中ですりむを選ぶ乱数
    const idx = pack.super.indexOf('surimu');
    const seq = [0, (idx + 0.5) / pack.super.length, 0.99];
    let i = 0;
    const bags = drawBags(pack, 1, () => seq[i++ % seq.length], undefined, false);
    expect(bags[0].card).toEqual({ no: 42, super: true });
    const draft = { coins: 0, collection: { 42: 1 } as Record<number, number> };
    const [r] = applyBags(draft, bags);
    expect(r.convertible).toBe(true);
    expect(convertSuper(draft, 42)).toBe(true);
    expect(draft.collection[42]).toBe(1);
    expect(draft.coins).toBe(PACK_DATA.draw.superToCoins);
  });

  it('スポドリは すりむ に使えない（つかえる相手が通常おてあげだけの決まりが効く）', () => {
    const sp = cardById('supodori')!;
    expect(sp.kind === 'item' && sp.target?.rarity).toEqual(['normal']);
    expect(sp.kind === 'item' && SURIMU.kind === 'otege' && sp.target!.rarity.includes(SURIMU.rarity)).toBe(false);
  });
});

describe('S02 ほかのスーパーと同じデッキに入れられない（合計1枚まで）', () => {
  const base = [no('oteage'), no('oteage'), no('oteage'), no('oteage'), no('oteage'), no('mitsume'), no('mitsume'), no('mitsume'), no('otesage'), no('otesage'), no('kusuri'), no('kusuri'), no('kusuri'), no('himitsu_yaiba')];
  it('すりむ1枚だけなら使える。すりむ2枚・すりむ＋かみ はルール違反', () => {
    expect(validateDeck([...base, 42], CARD_DB)).toEqual([]);
    expect(validateDeck([...base.slice(1), 42, 42], CARD_DB)).toEqual([{ code: 'tooManySuper', count: 2, max: 1 }]);
    expect(validateDeck([...base.slice(1), 42, no('kami')], CARD_DB)).toEqual([{ code: 'tooManySuper', count: 2, max: 1 }]);
  });
  it('デッキ編集：ほかのスーパーが入っていると すりむ は入れられない（逆も）', () => {
    const owned = () => 3;
    expect(checkAdd(base.slice(1), 42, CARD_DB, DEFAULT_RULES, owned)).toBeNull();
    expect(checkAdd([...base.slice(2), no('kami')], 42, CARD_DB, DEFAULT_RULES, owned)).toBe('super');
    expect(checkAdd([...base.slice(2), 42], no('kami'), CARD_DB, DEFAULT_RULES, owned)).toBe('super');
    expect(checkAdd([...base.slice(2), 42], 42, CARD_DB, DEFAULT_RULES, owned)).toBe('super');
  });
  it('ストーリーの敵のデッキも、スーパーは合計1枚まで（すりむ は どのデッキも1枚まで）', () => {
    for (const s of STORY.stages) {
      const supers = s.deck.filter(([id]) => isSuper(no(id))).reduce((a, [, n]) => a + n, 0);
      expect(supers, `ステージ${s.no}`).toBeLessThanOrEqual(1);
      expect(s.deck.reduce((a, [, n]) => a + n, 0), `ステージ${s.no}`).toBe(DEFAULT_RULES.deckSize);
    }
  });
});

describe('S03 古いセーブのデッキが壊れずに読み込める', () => {
  /** すりむ2枚のデッキ（前は使えた）と、すりむ＋かみ のデッキを持っているセーブ */
  function oldSave(withGoodDeck: boolean) {
    const s = createDefaultSave();
    s.collection = { ...s.collection, 42: 3, [no('kami')]: 1, [no('oteage')]: 9 };
    const filler = Array(13).fill(no('oteage'));
    s.decks[0] = withGoodDeck ? s.decks[0] : { name: 'からっぽ', cards: [] };
    s.decks[2] = { name: 'すりむ2', cards: [...filler, 42, 42] };
    s.decks[3] = { name: 'すりむかみ', cards: [...filler, 42, no('kami')] };
    s.selectedDeck = 2;
    return s;
  }

  it('持っている枚数・デッキの中身はそのまま。スーパー2枚以上のデッキは消さずに「使えない」になる', () => {
    const before = oldSave(true);
    const after = decodeSave(encodeSave(before));
    expect(after.collection[42]).toBe(3);
    expect(after.decks[2]).toEqual(before.decks[2]);
    expect(after.decks[3]).toEqual(before.decks[3]);
    expect(checkSavedDeck(after, 2).usable).toBe(false);
    expect(hasTooManySuper(after, 2)).toBe(true);
    expect(hasTooManySuper(after, 3)).toBe(true);
    expect(hasTooManySuper(after, 0)).toBe(false);
  });

  it('そのデッキを選んでいたら、使えるほかのデッキへ切り替える（デッキは残る）', () => {
    const s = switchFromTooManySuper(decodeSave(encodeSave(oldSave(true))));
    expect(s.selectedDeck).toBe(0);
    expect(usableDecks(s)[0]).toBe(true);
    expect(s.decks[2].cards).toHaveLength(15);
    expect(needsSuperFix(s)).toBe(false);
  });

  it('使えるデッキが1つも無ければ、選んだまま（メニューでデッキ編集へ案内する）', () => {
    const s = switchFromTooManySuper(decodeSave(encodeSave(oldSave(false))));
    expect(s.selectedDeck).toBe(2);
    expect(needsSuperFix(s)).toBe(true);
  });

  it('スーパー2枚以上でない「使えない」デッキ（作りかけ）を選んでいる時は切り替えない', () => {
    const s = oldSave(true);
    s.decks[4] = { name: 'つくりかけ', cards: [no('oteage')] };
    s.selectedDeck = 4;
    expect(switchFromTooManySuper(s).selectedDeck).toBe(4);
  });
});
