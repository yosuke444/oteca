import { describe, expect, it, vi } from 'vitest';
import raw from '../src/data/cards.json';
import { CARD_DB, CARD_LIST, TROPHY, cardById, isTrophyNo, trophyCardNo, trophyDef, trophyNumberOf } from '../src/data/cards';
import { starterDeckNos } from '../src/data/starterDeck';
import { createGame, validateDeck } from '../src/engine';
import { checkDeckCards, getOwnedCount, ownedTrophyDefs } from '../src/save/collection';
import { encodeSave } from '../src/save/binary';
import { decodeSave } from '../src/save/migrate';
import { MAILBOX_EVERY_MS, checkMailbox, forgetMailbox } from '../src/online/mailbox';
import { TROPHIES_MAX, TROPHY_CARD_NO_BASE, TROPHY_NUMBER_MAX, createDefaultSave, normalizeCollection, normalizeSave } from '../src/save/saveData';
import { cleanOffer } from '../src/trade/trade';
import { TROPHY_NUMBER_MAX as WORKER_TROPHY_MAX } from '../worker/src/logic/admin';

/** トロフィーのカード（v2.0-J。SPEC §7 S20・テスト J05） */
describe('J05 トロフィーのカード', () => {
  it('性能は おてあげ と同じ。名前は「トロフィあげ（番号）」、カードNo は 50000＋番号', () => {
    const base = cardById('oteage')!;
    const d = trophyDef(123);
    expect(d.name).toBe('トロフィあげ（123）');
    expect(d.no).toBe(50123);
    expect(d.kind).toBe('otege');
    if (d.kind !== 'otege' || base.kind !== 'otege') throw new Error('おてあげ');
    expect(d.hp).toBe(base.hp);
    expect(d.moves).toEqual(base.moves);
    expect(d.rarity).toBe('normal');
    expect(d.trophy).toBe(123);
    expect(d.image).toBe('cards/trophy.png');
    // 番号の範囲（cards.json・セーブ・Worker で同じ）
    expect(TROPHY.noBase).toBe(TROPHY_CARD_NO_BASE);
    expect(TROPHY.numberMax).toBe(TROPHY_NUMBER_MAX);
    expect(TROPHY.numberMax).toBe(WORKER_TROPHY_MAX);
    expect((raw as { trophy: { copyOf: string } }).trophy.copyOf).toBe('oteage');
    expect(trophyCardNo(1)).toBe(50001);
    expect(trophyNumberOf(50001)).toBe(1);
    expect(trophyNumberOf(50000)).toBeNull();
    expect(trophyNumberOf(60000)).toBeNull();
    expect(isTrophyNo(5)).toBe(false);
  });

  it('カードの表（CARD_DB）から引ける。一覧（ガチャ・図鑑）には入らない', () => {
    expect(CARD_DB[50042]?.name).toBe('トロフィあげ（42）');
    expect(CARD_DB[50000]).toBeUndefined();
    expect(CARD_DB[1]?.name).toBe('おてあげ');
    expect(CARD_LIST.some((c) => isTrophyNo(c.no))).toBe(false);
  });

  it('デッキに入れられる（受け取った番号だけ。1つの番号につき1枚）', () => {
    const save = { ...createDefaultSave(), trophies: [{ number: 7, receivedAt: 1 }] };
    const deck = [...starterDeckNos().slice(0, 14), trophyCardNo(7)];
    expect(validateDeck(deck, CARD_DB)).toEqual([]);
    expect(getOwnedCount(save, trophyCardNo(7))).toBe(1);
    expect(getOwnedCount(save, trophyCardNo(8))).toBe(0);
    expect(checkDeckCards(save, deck).shortages).toEqual([]);
    // 持っていない番号・2枚は足りない
    expect(checkDeckCards(save, [...starterDeckNos().slice(0, 14), trophyCardNo(8)]).shortages).toEqual([{ no: trophyCardNo(8), missing: 1 }]);
    expect(checkDeckCards(save, [...starterDeckNos().slice(0, 13), trophyCardNo(7), trophyCardNo(7)]).shortages).toEqual([{ no: trophyCardNo(7), missing: 1 }]);
    // 全カード無制限（開発用）でも、受け取っていない番号は使えない
    expect(getOwnedCount({ ...save, unlockAll: true }, trophyCardNo(8))).toBe(0);
    expect(ownedTrophyDefs(save).map((d) => d.name)).toEqual(['トロフィあげ（7）']);
  });

  it('デッキに入れて対戦できる（エンジンが ふつうの おてあげ として扱う）', () => {
    const deck = [...starterDeckNos().slice(0, 14), trophyCardNo(7)];
    const { state } = createGame({ seed: 'trophy', decks: { p1: deck, p2: starterDeckNos() }, cardDb: CARD_DB });
    const trophyCard = Object.values(state.cards).find((c) => c.no === trophyCardNo(7));
    expect(trophyCard).toBeDefined();
    expect(state.cardDefs[trophyCardNo(7)]?.name).toBe('トロフィあげ（7）');
  });

  it('トレードに出せない（受け取った交換の中身にトロフィーがあれば弾く）。所持数の表（collection）には入らない', () => {
    expect(cleanOffer({ [trophyCardNo(7)]: 1 })).toBeNull();
    expect(cleanOffer({ 1: 1 })).toEqual({ 1: 1 });
    expect(normalizeCollection({ 1: 2, [trophyCardNo(7)]: 1 })).toEqual({ 1: 2 });
  });

  it('セーブ（形式版数9）に、番号と受け取った時刻を書く。同じ番号・範囲外は整える', () => {
    const save = { ...createDefaultSave(), trophies: [{ number: 9999, receivedAt: 5 }, { number: 1, receivedAt: 6 }] };
    expect(decodeSave(encodeSave(normalizeSave(save))).trophies).toEqual([
      { number: 1, receivedAt: 6 },
      { number: 9999, receivedAt: 5 },
    ]);
    expect(
      normalizeSave({
        ...save,
        trophies: [
          { number: 3, receivedAt: 1 },
          { number: 3, receivedAt: 2 },
          { number: 0, receivedAt: 1 },
          { number: 10000, receivedAt: 1 },
        ],
      }).trophies,
    ).toEqual([{ number: 3, receivedAt: 1 }]);
  });
});

describe('J05 郵便受け', () => {
  type Call = { url: string; body?: string };
  function stubMailbox(numbers: number[]) {
    const calls: Call[] = [];
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      calls.push({ url, body: init?.body as string | undefined });
      const body = url.includes('/mailbox/ack') ? { ok: true } : { trophies: numbers.map((number) => ({ number, created: 1 })) };
      return new Response(JSON.stringify(body), { status: 200 });
    });
    return calls;
  }
  function registered() {
    const s = createDefaultSave();
    s.userIdRegistered = true;
    s.ranking.token = 'ab'.repeat(16);
    return s;
  }

  it('届いたトロフィーはセーブに入り、受け取ったと知らせる。10分たたないうちは確かめ直さない', async () => {
    forgetMailbox();
    const calls = stubMailbox([5, 9]);
    const save = registered();
    const update = (fn: (d: typeof save) => void) => fn(save);
    const t0 = 1_800_000_000_000;
    expect(await checkMailbox(save, update, t0)).toEqual([5, 9]);
    expect(save.trophies.map((t) => t.number)).toEqual([5, 9]);
    expect(JSON.parse(calls.find((c) => c.url.includes('/mailbox/ack'))!.body!).numbers).toEqual([5, 9]);
    // メニューに戻っても（5分後）確かめない。10分後には確かめる（同じ番号は増えない）
    const n = calls.length;
    expect(await checkMailbox(save, update, t0 + 5 * 60e3)).toEqual([]);
    expect(calls.length).toBe(n);
    expect(await checkMailbox(save, update, t0 + MAILBOX_EVERY_MS)).toEqual([]);
    expect(calls.length).toBeGreaterThan(n);
    expect(save.trophies).toHaveLength(2);
    vi.unstubAllGlobals();
  });

  it(`セーブに入るのは ${TROPHIES_MAX}個まで。入らない分は受け取ったと知らせない（郵便受けに残る）`, async () => {
    forgetMailbox();
    const save = registered();
    save.trophies = Array.from({ length: TROPHIES_MAX - 1 }, (_, i) => ({ number: i + 1, receivedAt: 1 }));
    const calls = stubMailbox([500, 501]);
    const update = (fn: (d: typeof save) => void) => fn(save);
    expect(await checkMailbox(save, update, 1_800_000_000_000)).toEqual([500]);
    expect(save.trophies).toHaveLength(TROPHIES_MAX);
    expect(JSON.parse(calls.find((c) => c.url.includes('/mailbox/ack'))!.body!).numbers).toEqual([500]);
    vi.unstubAllGlobals();
  });
});
