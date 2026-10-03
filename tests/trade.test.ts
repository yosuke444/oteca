import { describe, expect, it } from 'vitest';
import { cardById } from '../src/data/cards';
import { type PendingTrade, TRADE_PICK_MS, TradeSession, type TradeView } from '../src/net/tradeSession';
import { MemoryHub } from '../src/net/transport';
import { createDefaultSave } from '../src/save/saveData';
import { type Offer, TRADE_MAX_CARDS, TRADE_MAX_KINDS, applyTrade, brokenDecks, canAdd, cleanOffer, offerFits } from '../src/trade/trade';
import { FakeClock, settle } from './net.helpers';
import { makeRandom } from './save.helpers';

const no = (id: string) => cardById(id)!.no;

describe('H01 出せる内容', () => {
  it('所持数まで。99種類・合計99枚まで', () => {
    const s = createDefaultSave();
    const o: Offer = { [no('oteage')]: 4 };
    expect(canAdd(s, o, no('oteage'))).toBe(true); // 5枚持っている
    o[no('oteage')] = 5;
    expect(canAdd(s, o, no('oteage'))).toBe(false);
    expect(offerFits(s, { [no('oteage')]: 6 })).toBe(false);
    expect(canAdd(s, {}, no('kami'))).toBe(false); // 持っていない
    s.collection[no('kami')] = 999;
    expect(canAdd(s, { [no('kami')]: TRADE_MAX_CARDS }, no('kami'))).toBe(false);
  });
  it('壊れた offer・存在しないカード・上限越えは受け取らない', () => {
    expect(cleanOffer({ 1: 2, 9: 1 })).toEqual({ 1: 2, 9: 1 });
    expect(cleanOffer({ 1: 0 })).toEqual({});
    expect(cleanOffer({ 999: 1 })).toBeNull();
    expect(cleanOffer({ 1: -1 })).toBeNull();
    expect(cleanOffer({ 1: 1.5 })).toBeNull();
    expect(cleanOffer({ 1: 100 })).toBeNull();
    expect(cleanOffer({ 1: 60, 2: 40 })).toBeNull();
    expect(cleanOffer([1, 2])).toBeNull();
    expect(TRADE_MAX_KINDS).toBe(99);
  });
});

describe('H02 交換の保存', () => {
  it('あげる・もらうを1回で。0枚は消し、999で止める。同じ交換IDは二度処理しない', () => {
    const s = createDefaultSave();
    s.collection[no('kami')] = 999;
    const give = { [no('revolution')]: 1 };
    const get = { [no('kami')]: 1, [no('hasami')]: 2 };
    expect(applyTrade(s, 'id-1', give, get)).toBe(true);
    expect(s.collection[no('revolution')]).toBeUndefined();
    expect(s.collection[no('kami')]).toBe(999);
    expect(s.collection[no('hasami')]).toBe(2);
    expect(s.trade.doneIds).toEqual(['id-1']);
    expect(applyTrade(s, 'id-1', give, get)).toBe(false);
    expect(s.collection[no('hasami')]).toBe(2);
  });
  it('所持数が足りなければ処理しない。交換IDは直近20件', () => {
    const s = createDefaultSave();
    expect(applyTrade(s, 'x', { [no('kami')]: 1 }, {})).toBe(false);
    for (let i = 0; i < 25; i++) applyTrade(s, `t${i}`, {}, {});
    expect(s.trade.doneIds).toHaveLength(20);
    expect(s.trade.doneIds[19]).toBe('t24');
  });
});

describe('H03 デッキが使えなくなる警告', () => {
  it('交換の後に使えなくなる保存デッキの名前', () => {
    const s = createDefaultSave();
    expect(brokenDecks(s, { [no('revolution')]: 1 }, {})).toEqual([s.decks[0].name]);
    expect(brokenDecks(s, {}, { [no('kami')]: 1 })).toEqual([]);
    // 1枚あげても、もらって戻れば使える
    expect(brokenDecks(s, { [no('oteage')]: 1 }, { [no('oteage')]: 1 })).toEqual([]);
  });
});

type T = { s: TradeSession; views: TradeView[]; save: ReturnType<typeof createDefaultSave>; pending: PendingTrade | null; resumes: string[] };

function trader(hub: MemoryHub, clock: FakeClock, id: string, playerId = `pl-${id}`, save = createDefaultSave()): T {
  const r = makeRandom(id.charCodeAt(id.length - 1));
  const x: T = { s: null as unknown as TradeSession, views: [], save, pending: null, resumes: [] };
  const s = new TradeSession(hub.create(id), {
    name: id,
    playerId,
    protocol: 5,
    appVersion: '0',
    doneIds: () => x.save.trade.doneIds,
    pending: () => x.pending,
    canGive: (o) => offerFits(x.save, o),
    clock,
    randomBytes: (n) => new Uint8Array(n).map(() => r.int(0, 255)),
  });
  s.onChange = (v) => x.views.push(v);
  s.onExecute = (t) => applyTrade(x.save, t.tradeId, t.give, t.get, { partial: true });
  s.onPending = (p) => (x.pending = p);
  s.onResume = (d, p) => {
    x.resumes.push(d);
    if (d === 'apply') applyTrade(x.save, p.tradeId, p.give, p.get);
  };
  x.s = s;
  return x;
}

async function pairUp(room = '5555') {
  const hub = new MemoryHub();
  const clock = new FakeClock();
  const a = trader(hub, clock, 'ta');
  const b = trader(hub, clock, 'tb');
  a.s.join(room);
  clock.advance(5);
  b.s.join(room);
  await settle(hub);
  clock.advance(TRADE_PICK_MS + 300);
  await settle(hub);
  return { hub, clock, a, b };
}

const last = (t: T) => t.views.at(-1)!;

describe('H04 通信で交換する', () => {
  it('2人で交換でき、両者の所持数が正しく変わる', async () => {
    const { hub, a, b } = await pairUp();
    expect(last(a).status).toBe('trading');
    expect(last(a).oppName).toBe('tb');
    a.s.setOffer({ [no('revolution')]: 1 });
    b.s.setOffer({ [no('oteage')]: 2, [no('kusuri')]: 1 });
    await settle(hub);
    expect(last(a).oppOffer).toEqual({ [no('oteage')]: 2, [no('kusuri')]: 1 });
    a.s.setLock(true);
    b.s.setLock(true);
    await settle(hub);
    expect(last(a)).toMatchObject({ myLock: true, oppLock: true });
    expect(a.s.commit()).toBe(true);
    await settle(hub);
    // 片方だけの最終確認では交換しない
    expect(a.save.collection[no('revolution')]).toBe(1);
    expect(b.save.collection[no('revolution')]).toBe(1);
    expect(a.pending).not.toBeNull();
    expect(b.s.commit()).toBe(true);
    await settle(hub);
    expect(a.save.collection[no('revolution')]).toBeUndefined();
    expect(a.save.collection[no('oteage')]).toBe(7);
    expect(a.save.collection[no('kusuri')]).toBe(3);
    expect(b.save.collection[no('revolution')]).toBe(2);
    expect(b.save.collection[no('oteage')]).toBe(3);
    expect(a.save.trade.doneIds).toEqual(b.save.trade.doneIds);
    expect(a.pending).toBeNull();
    expect(b.pending).toBeNull();
    // 次の交換へ（内容は空）
    expect(last(a)).toMatchObject({ myOffer: {}, oppOffer: {}, myLock: false });
  });

  it('どちらかが内容を変えると、両者のロック・最終確認が外れる', async () => {
    const { hub, a, b } = await pairUp();
    a.s.setOffer({ [no('oteage')]: 1 });
    await settle(hub);
    a.s.setLock(true);
    b.s.setLock(true);
    await settle(hub);
    b.s.setOffer({ [no('mitsume')]: 1 });
    await settle(hub);
    expect(last(a)).toMatchObject({ myLock: false, oppLock: false });
    expect(last(b)).toMatchObject({ myLock: false, oppLock: false });
    expect(a.s.commit()).toBe(false);
  });

  it('片側0枚（プレゼント）も交換できる。続けて2回目の交換もでき、交換IDが変わる', async () => {
    const { hub, a, b } = await pairUp();
    for (let k = 0; k < 2; k++) {
      a.s.setOffer({ [no('oteage')]: 1 });
      await settle(hub);
      a.s.setLock(true);
      b.s.setLock(true);
      await settle(hub);
      a.s.commit();
      b.s.commit();
      await settle(hub);
    }
    expect(a.save.collection[no('oteage')]).toBe(3);
    expect(b.save.collection[no('oteage')]).toBe(7);
    expect(new Set(a.save.trade.doneIds).size).toBe(2);
  });

  it('3人目は まんいん', async () => {
    const { hub, clock } = await pairUp('7777');
    const c = trader(hub, clock, 'tc');
    c.s.join('7777');
    await settle(hub);
    clock.advance(TRADE_PICK_MS + 300);
    await settle(hub);
    expect(last(c).status).toBe('full');
  });

  it('同じ部屋番号でも、対戦の部屋とはぶつからない（部屋の名前が違う）', async () => {
    const { tradeRoomName, roomName } = await import('../src/net/protocol');
    expect(tradeRoomName('1234')).not.toBe(roomName('1234'));
  });
});

describe('H05 最終確認の直後にページが閉じられた', () => {
  it('相手は済ませた・自分は保存の前に閉じた → 次に同じ相手と入ると仕上がる（二重にならない）', async () => {
    const { hub, clock, a, b } = await pairUp('8888');
    a.s.setOffer({ [no('revolution')]: 1 });
    await settle(hub);
    a.s.setLock(true);
    b.s.setLock(true);
    await settle(hub);
    b.s.commit();
    await settle(hub);
    // a は最終確認を押して commit を送ったが、交換を保存する前にページが閉じられた（onExecute が呼ばれない）
    a.s.onExecute = () => {};
    a.s.onPending = (p) => {
      if (p) a.pending = p;
    };
    a.s.commit();
    await settle(hub);
    expect(b.save.collection[no('revolution')]).toBe(2);
    expect(a.save.collection[no('revolution')]).toBe(1); // まだ減っていない
    expect(a.pending).not.toBeNull();
    a.s.leave();
    b.s.leave();
    await settle(hub);
    // 入り直す（同じセーブ・同じ playerId）
    const a2 = trader(hub, clock, 'ta2', 'pl-ta', a.save);
    a2.pending = a.pending;
    const b2 = trader(hub, clock, 'tb2', 'pl-tb', b.save);
    a2.s.join('8888');
    b2.s.join('8888');
    await settle(hub);
    clock.advance(TRADE_PICK_MS + 300);
    await settle(hub);
    expect(a2.resumes).toEqual(['apply']);
    expect(a2.pending).toBeNull();
    expect(a2.save.collection[no('revolution')]).toBeUndefined();
    expect(b2.save.collection[no('revolution')]).toBe(2);
    expect(b2.resumes).toEqual([]);
  });

  it('どちらも済ませていなければ取り消す（カードはそのまま）', async () => {
    const { hub, clock, a, b } = await pairUp('9999');
    a.s.setOffer({ [no('revolution')]: 1 });
    await settle(hub);
    a.s.setLock(true);
    b.s.setLock(true);
    await settle(hub);
    // a の commit は届かなかった（送る前に閉じた）
    a.pending = { tradeId: 'zzz', give: { [no('revolution')]: 1 }, get: {}, oppPlayerId: 'pl-tb', room: '9999' };
    a.s.leave();
    b.s.leave();
    await settle(hub);
    const a2 = trader(hub, clock, 'ta3', 'pl-ta', a.save);
    a2.pending = a.pending;
    const b2 = trader(hub, clock, 'tb3', 'pl-tb', b.save);
    a2.s.join('9999');
    b2.s.join('9999');
    await settle(hub);
    clock.advance(TRADE_PICK_MS + 300);
    await settle(hub);
    expect(a2.resumes).toEqual(['drop']);
    expect(a2.pending).toBeNull();
    expect(a2.save.collection[no('revolution')]).toBe(1);
    expect(b2.save.collection[no('revolution')]).toBe(1);
  });
});

describe('H04b 突き合わせで見つかったこと', () => {
  const trade = async (hub: MemoryHub, a: T, b: T, give: Offer) => {
    a.s.setOffer(give);
    await settle(hub);
    a.s.setLock(true);
    b.s.setLock(true);
    await settle(hub);
    a.s.commit();
    b.s.commit();
    await settle(hub);
  };

  it('交換したあと相手が入り直しても、もう一度交換できる', async () => {
    const { hub, clock, a, b } = await pairUp('1212');
    await trade(hub, a, b, { [no('oteage')]: 1 });
    expect(a.save.collection[no('oteage')]).toBe(4);
    b.s.leave();
    await settle(hub);
    const b2 = trader(hub, clock, 'tb9', 'pl-tb', b.save);
    b2.s.join('1212');
    await settle(hub);
    clock.advance(TRADE_PICK_MS + 300);
    await settle(hub);
    expect(last(a).status).toBe('trading');
    await trade(hub, a, b2, { [no('oteage')]: 1 });
    expect(a.save.collection[no('oteage')]).toBe(3);
    expect(b2.save.collection[no('oteage')]).toBe(7);
    expect(a.pending).toBeNull();
  });

  it('最終確認のあとに相手が内容を変えたら、自分の とちゅうの交換の記録も消える', async () => {
    const { hub, a, b } = await pairUp('1313');
    a.s.setOffer({ [no('oteage')]: 1 });
    await settle(hub);
    a.s.setLock(true);
    b.s.setLock(true);
    await settle(hub);
    a.s.commit();
    expect(a.pending).not.toBeNull();
    b.s.setOffer({ [no('mitsume')]: 1 });
    await settle(hub);
    expect(a.pending).toBeNull();
    expect(last(a)).toMatchObject({ myCommit: false, myLock: false });
  });

  it('所持数が足りない内容は OK にも最終確認にもできない。どちらも空なら OK にできない', async () => {
    const { hub, a, b } = await pairUp('1414');
    expect(a.s.setLock(true)).toBe(false);
    a.s.setOffer({ [no('revolution')]: 1 });
    await settle(hub);
    a.save.collection[no('revolution')] = 0; // 別のタブで減った
    expect(a.s.setLock(true)).toBe(false);
    a.save.collection[no('revolution')] = 1;
    a.s.setLock(true);
    b.s.setLock(true);
    await settle(hub);
    a.save.collection[no('revolution')] = 0;
    expect(a.s.commit()).toBe(false);
    expect(b.save.collection[no('revolution')]).toBe(1);
  });

  it('同じ commit がもう一度届いても、二度処理しない', async () => {
    const { hub, a, b } = await pairUp('1515');
    const send = b.s['transport'].send.bind(b.s['transport']);
    // b の commit を2回送る
    b.s['transport'].send = (m: Parameters<typeof send>[0], to?: string) => {
      send(m, to);
      if (m.t === 'tradeCommit') send(m, to);
    };
    await trade(hub, a, b, { [no('oteage')]: 2 });
    expect(a.save.collection[no('oteage')]).toBe(3);
    expect(b.save.collection[no('oteage')]).toBe(7);
    expect(a.save.trade.doneIds).toHaveLength(1);
  });

  it('同じセーブ（同じ playerId）どうしは交換できない', async () => {
    const hub = new MemoryHub();
    const clock = new FakeClock();
    const a = trader(hub, clock, 'sa', 'same');
    const b = trader(hub, clock, 'sb', 'same');
    a.s.join('1616');
    b.s.join('1616');
    await settle(hub);
    clock.advance(TRADE_PICK_MS + 300);
    await settle(hub);
    expect(last(a).status).toBe('self');
  });
});
