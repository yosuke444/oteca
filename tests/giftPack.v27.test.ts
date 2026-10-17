import { afterEach, describe, expect, it, vi } from 'vitest';
import gifts from '../src/data/gifts.json';
import { PACK_DATA, SHOP_PACKS, packName } from '../src/data/packs';
import { DAILY, dailyPack } from '../src/daily/daily';
import { drawBags } from '../src/gacha/gacha';
import { GIFT_DATA, applyGift, giftKind, isReceivable, parseGiftData } from '../src/gift/gifts';
import { OWNED_PACK_BAGS, consumeOwnedPack, drawOwnedPack, ownedPackList } from '../src/gift/ownedPacks';
import { arrivedItems, arrivedTrophies, checkMailbox, clearArrived } from '../src/online/mailbox';
import { createDefaultSave, normalizeSave } from '../src/save/saveData';
import { encodeSave } from '../src/save/binary';
import { decodeSave } from '../src/save/migrate';
import { cleanOffer, giveCandidates, hasUntradable } from '../src/trade/trade';
import { assignTrophyNumbers, giftCount, giftKindOf, parseUserIds } from '../worker/src/logic/gift';

/**
 * v2.7 贈り物の共通の仕組みと「大会パック」（SPEC §7 S20）：確認 ①〜⑧ のうち、端末とサーバーの決まり。
 * Worker を通した確かめ（②まとめて贈る・⑥見つからないID・かんりログ）は scripts/worker-test.mjs、
 * ③（開いている人に5秒以内）・④（閉じていた人）を2つのタブで確かめるのは scripts/giftpack-e2e.mjs（Playwright）
 */

const taikai = PACK_DATA.packs.find((p) => p.id === 'taikai')!;

/** 種付きの乱数（mulberry32） */
function seeded(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('① 大会パックの中身と確率がデイリーパックと同じ', () => {
  it('中身（ノーマル・スーパー）が同じ。売らない（光らない）。袋の数も同じ', () => {
    const daily = dailyPack();
    expect(taikai.normal).toEqual(daily.normal);
    expect(taikai.super).toEqual(daily.super);
    expect(taikai.purchasable).toBe(false);
    expect(SHOP_PACKS.some((p) => p.id === 'taikai')).toBe(false);
    expect(OWNED_PACK_BAGS).toBe(DAILY.allClear.bags);
  });

  it('同じ乱数なら、デイリーパックと同じ袋（同じカード・光らない）', () => {
    for (let s = 1; s <= 200; s++) {
      const a = drawOwnedPack(taikai, seeded(s));
      const b = drawBags(dailyPack(), DAILY.allClear.bags, seeded(s));
      expect(a).toEqual(b);
      expect(a.every((bag) => !bag.glow && !bag.guaranteed)).toBe(true);
    }
  });

  it('名前と見た目：にほんごは「たいかいパック」、日本語は「大会パック」。青い袋（color taikai）', () => {
    expect(packName(taikai, 'hira')).toBe('たいかいパック');
    expect(packName(taikai, 'kanji')).toBe('大会パック');
    expect(taikai.color).toBe('taikai');
  });
});

describe('もっている パック（ガチャ画面から開ける。期限なし）', () => {
  it('1つ開けると1つ減り、カードが所持数に足される（0になったら消える）。もっていなければ開けない', () => {
    const save = { ...createDefaultSave(), ownedPacks: { taikai: 2 } };
    expect(ownedPackList(save).map((x) => [x.pack.id, x.count])).toEqual([['taikai', 2]]);
    const bags = drawOwnedPack(taikai, seeded(3));
    const before = { ...save.collection };
    const results = consumeOwnedPack(save, 'taikai', bags)!;
    expect(results).toHaveLength(OWNED_PACK_BAGS);
    expect(save.ownedPacks).toEqual({ taikai: 1 });
    for (const r of results) expect(save.collection[r.no]).toBeGreaterThan((before[r.no] ?? 0) - 0);
    consumeOwnedPack(save, 'taikai', drawOwnedPack(taikai, seeded(4)));
    expect(save.ownedPacks).toEqual({});
    expect(consumeOwnedPack(save, 'taikai', bags)).toBeNull();
  });

  it('セーブ（形式版数12）に残る', () => {
    const save = normalizeSave({ ...createDefaultSave(), ownedPacks: { taikai: 3 }, giftIds: [11, 12] });
    expect(decodeSave(encodeSave(save))).toMatchObject({ ownedPacks: { taikai: 3 }, giftIds: [11, 12] });
  });
});

describe('贈り物のデータ（gifts.json）', () => {
  it('トロフィあげ と 大会パック（1人に最初は3つ・1〜10）。後でコイン・カードもデータを足すだけ', () => {
    expect(GIFT_DATA.kinds.map((k) => [k.id, k.type])).toEqual([
      ['trophy', 'trophy'],
      ['pack_taikai', 'pack'],
    ]);
    expect(giftKind('pack_taikai')).toMatchObject({ pack: 'taikai', defaultCount: 3, maxCount: 10 });
    // データを足すだけで、コイン・カードも受け取れる
    const more = parseGiftData({ ...gifts, kinds: [...gifts.kinds, { id: 'coins', type: 'coins', defaultCount: 100, maxCount: 1000, arrival: 'gift' }] });
    expect(more.kinds.map((k) => k.id)).toContain('coins');
    expect(() => parseGiftData({ kinds: [{ id: 'x', type: 'pack', pack: 'nope', defaultCount: 1, maxCount: 1, arrival: 'gift' }] })).toThrow('packs.json');
  });

  it('受け取る：もっている パックに足し、贈り物の番号を覚える（同じ番号は二重にしない）', () => {
    const save = createDefaultSave();
    expect(applyGift(save, { id: 7, kind: 'pack_taikai', count: 3 })).toBe(true);
    expect(save.ownedPacks).toEqual({ taikai: 3 });
    expect(save.giftIds).toEqual([7]);
    expect(applyGift(save, { id: 7, kind: 'pack_taikai', count: 3 })).toBe(false);
    expect(save.ownedPacks).toEqual({ taikai: 3 });
    // 知らない種類・範囲外の数・トロフィー（番号で届く）は受け取らない
    expect(isReceivable({ id: 8, kind: 'nope', count: 1 })).toBe(false);
    expect(isReceivable({ id: 8, kind: 'pack_taikai', count: 11 })).toBe(false);
    expect(isReceivable({ id: 8, kind: 'trophy', count: 1 })).toBe(false);
  });
});

/** 郵便受けの Worker の代わり（渡し済みにするのは「受け取った」が届いた時だけ） */
function fakeServer() {
  const trophies = new Map<number, boolean>();
  const gifts = new Map<number, { kind: string; count: number; done: boolean }>();
  let failAck = false;
  let failGet = false;
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    if (url.includes('/mailbox/ack')) {
      if (failAck) throw new Error('切れた');
      const b = JSON.parse(String(init?.body)) as { numbers: number[]; giftIds: number[] };
      for (const n of b.numbers ?? []) if (trophies.has(n)) trophies.set(n, true);
      for (const id of b.giftIds ?? []) if (gifts.has(id)) gifts.get(id)!.done = true;
      return new Response('{"ok":true}');
    }
    if (failGet) throw new Error('切れた');
    return new Response(
      JSON.stringify({
        trophies: [...trophies].filter(([, d]) => !d).map(([number]) => ({ number, created: 1 })),
        gifts: [...gifts].filter(([, g]) => !g.done).map(([id, g]) => ({ id, kind: g.kind, count: g.count, created: 1 })),
      }),
    );
  });
  return {
    giveTrophy: (n: number) => trophies.set(n, false),
    giveGift: (id: number, kind: string, count: number) => gifts.set(id, { kind, count, done: false }),
    giftDone: (id: number) => gifts.get(id)?.done === true,
    trophyDone: (n: number) => trophies.get(n) === true,
    setFailAck: (v: boolean) => (failAck = v),
    setFailGet: (v: boolean) => (failGet = v),
  };
}
function registered() {
  const s = createDefaultSave();
  s.userIdRegistered = true;
  s.ranking.token = 'ab'.repeat(16);
  return s;
}

afterEach(() => {
  vi.unstubAllGlobals();
  clearArrived();
});

describe('④ 閉じていた人は、次に開いた時に受け取る（郵便受け）・⑤ 途中で通信が切れても二重に届かない', () => {
  it('届いた大会パックはセーブに入り、受け取ったと知らせ、演出を待つ', async () => {
    const srv = fakeServer();
    srv.giveGift(101, 'pack_taikai', 3);
    const save = registered();
    await checkMailbox(save, (fn) => fn(save));
    expect(save.ownedPacks).toEqual({ taikai: 3 });
    expect(save.giftIds).toEqual([101]);
    expect(srv.giftDone(101)).toBe(true);
    expect(arrivedItems()).toEqual([{ key: 'g101', kind: 'gift', giftId: 101, giftKind: 'pack_taikai', count: 3 }]);
  });

  it('「受け取った」が届かない：セーブには3つだけ。次に確かめた時は足さずに知らせだけやり直す', async () => {
    const srv = fakeServer();
    srv.giveGift(102, 'pack_taikai', 3);
    const save = registered();
    srv.setFailAck(true);
    await checkMailbox(save, (fn) => fn(save));
    expect(save.ownedPacks).toEqual({ taikai: 3 });
    expect(srv.giftDone(102)).toBe(false);
    srv.setFailAck(false);
    await checkMailbox(save, (fn) => fn(save));
    await checkMailbox(save, (fn) => fn(save));
    expect(save.ownedPacks).toEqual({ taikai: 3 });
    expect(srv.giftDone(102)).toBe(true);
    expect(arrivedItems()).toHaveLength(1);
  });

  it('セーブに入る前に切れた：0のまま郵便受けに残る。つながったら3つ', async () => {
    const srv = fakeServer();
    srv.giveGift(103, 'pack_taikai', 3);
    const save = registered();
    srv.setFailGet(true);
    await checkMailbox(save, (fn) => fn(save));
    expect(save.ownedPacks).toEqual({});
    srv.setFailGet(false);
    await checkMailbox(save, (fn) => fn(save));
    expect(save.ownedPacks).toEqual({ taikai: 3 });
  });

  it('セーブが書けなかった（画面が閉じた など）：「受け取った」と返さない（郵便受けに残る）', async () => {
    const srv = fakeServer();
    srv.giveGift(104, 'pack_taikai', 3);
    const save = registered();
    await checkMailbox(() => save, () => {});
    expect(srv.giftDone(104)).toBe(false);
    expect(arrivedItems()).toEqual([]);
  });

  it('上限（1種類 999こ）を超える贈り物は受け取らない（郵便受けに残し、失わない）', async () => {
    const srv = fakeServer();
    srv.giveGift(106, 'pack_taikai', 3);
    const save = registered();
    save.ownedPacks = { taikai: 998 };
    await checkMailbox(save, (fn) => fn(save));
    expect(save.ownedPacks).toEqual({ taikai: 998 });
    expect(srv.giftDone(106)).toBe(false);
    expect(arrivedItems()).toEqual([]);
  });

  it('⑦ トロフィあげ と大会パックが一緒に届いても、両方とも今までどおり', async () => {
    const srv = fakeServer();
    srv.giveTrophy(77);
    srv.giveGift(105, 'pack_taikai', 2);
    const save = registered();
    expect(await checkMailbox(save, (fn) => fn(save))).toEqual([77]);
    expect(save.trophies.map((t) => t.number)).toEqual([77]);
    expect(save.ownedPacks).toEqual({ taikai: 2 });
    expect(srv.trophyDone(77)).toBe(true);
    expect(srv.giftDone(105)).toBe(true);
    expect(arrivedTrophies()).toEqual([77]);
    expect(arrivedItems().map((a) => a.key)).toEqual(['t77', 'g105']);
  });
});

describe('⑥ ユーザーID をまとめて入れる（改行・カンマ・スペース。5-5-5 の - は有っても無くても）', () => {
  it('形の正しいID・形の正しくないものに分ける（同じIDは1つ）', () => {
    const { ids, bad } = parseUserIds('12345-67890-12345, 223456789012345\n323456789012345　12345-67890-12345 abc 1234');
    expect(ids).toEqual(['123456789012345', '223456789012345', '323456789012345']);
    expect(bad).toEqual(['abc', '1234']);
  });

  it('贈れる種類と数（大会パックは1〜10。トロフィあげは番号で贈る）', () => {
    const k = giftKindOf('pack_taikai')!;
    expect(giftCount(k, 3)).toBe(3);
    expect(giftCount(k, 0)).toBeNull();
    expect(giftCount(k, 11)).toBeNull();
    expect(giftKindOf('trophy')).toBeNull();
    expect(giftKindOf('nope')).toBeNull();
  });

  it('トロフィあげをまとめて：最初の番号から順に、使われている番号は飛ばす', () => {
    expect(assignTrophyNumbers(3, 10, new Set([11]), 9999)).toEqual([10, 12, 13]);
    expect(assignTrophyNumbers(3, 9998, new Set(), 9999)).toEqual([9998, 9999, null]);
  });
});

describe('⑧ 大会パックはトレードに出せない', () => {
  it('パックはカードではないので、トレードの一覧に出ず、送っても受け取らない', () => {
    const save = { ...createDefaultSave(), ownedPacks: { taikai: 3 } };
    expect(giveCandidates(save).some((c) => String(c.no) === 'taikai')).toBe(false);
    expect(cleanOffer({ taikai: 1 })).toBeNull();
    expect(hasUntradable({ taikai: 1 } as never)).toBe(true);
  });
});
