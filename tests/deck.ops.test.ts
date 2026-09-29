import { describe, expect, it } from 'vitest';
import { CARD_DB } from '../src/data/cards';
import { starterDeckNos } from '../src/data/starterDeck';
import { DEFAULT_RULES, validateDeck } from '../src/engine';
import { addCard, autoFill, checkAdd, removeAt, summarize } from '../src/scenes/DeckEdit/deckOps';
import { noOf } from './helpers';
import { makeRandom } from './save.helpers';

const unlimited = () => Infinity;

describe('デッキ編集の処理', () => {
  it('15枚を超えては入れられない。スーパーは合計1枚まで', () => {
    const full = starterDeckNos();
    expect(checkAdd(full, noOf('oteage'), CARD_DB, DEFAULT_RULES, unlimited)).toBe('full');
    const withKami = [noOf('kami')];
    expect(checkAdd(withKami, noOf('revolution'), CARD_DB, DEFAULT_RULES, unlimited)).toBe('super');
    expect(checkAdd(withKami, noOf('oteage'), CARD_DB, DEFAULT_RULES, unlimited)).toBeNull();
    expect(checkAdd([], noOf('kusuri'), CARD_DB, DEFAULT_RULES, () => 0)).toBe('owned');
  });

  it('入れる・外す', () => {
    const d = addCard(addCard([], noOf('kusuri')), noOf('oteage'));
    expect(d).toEqual([noOf('oteage'), noOf('kusuri')]);
    expect(removeAt(d, 0)).toEqual([noOf('kusuri')]);
  });

  it('おまかせでうめる：15枚ちょうど・おてあげ6〜7割・ルールを守る', () => {
    for (let seed = 0; seed < 300; seed++) {
      const r = makeRandom(seed);
      const start = seed % 3 === 0 ? [] : seed % 3 === 1 ? [noOf('kami')] : [noOf('kusuri'), noOf('kusuri')];
      const deck = autoFill(start, CARD_DB, DEFAULT_RULES, unlimited, r.next);
      expect(deck).toHaveLength(15);
      expect(validateDeck(deck, CARD_DB)).toEqual([]);
      const s = summarize(deck, CARD_DB);
      expect(s.otege).toBeGreaterThanOrEqual(9);
      expect(s.otege).toBeLessThanOrEqual(11);
    }
  });

  it('おまかせでうめる：満杯なら何もしない', () => {
    const full = starterDeckNos();
    expect(autoFill(full, CARD_DB, DEFAULT_RULES, unlimited, Math.random)).toEqual(full);
  });
});
