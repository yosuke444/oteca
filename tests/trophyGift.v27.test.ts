import { afterEach, describe, expect, it, vi } from 'vitest';
import raw from '../src/data/cards.json';
import packs from '../src/data/packs.json';
import { CARD_DB, cardById, trophyCardNo, trophyDef } from '../src/data/cards';
import { validateDeck } from '../src/engine';
import type { GameState, Side } from '../src/engine/types';
import { DEFAULT_RULES } from '../src/engine/rules';
import { GIFT_CLOSE_REPLACED, GIFT_MAX_FAILURES, GIFT_POLL_MS, GIFT_RETRY_MS, giftMenuCheck, startGiftLink, type GiftSocket } from '../src/online/giftLink';
import { setGiftHold } from '../src/online/giftHold';
import { arrivedTrophies, checkMailbox, clearArrived, shownArrived } from '../src/online/mailbox';
import { createDefaultSave } from '../src/save/saveData';
import { cleanOffer, giveCandidates, hasUntradable, isTradable } from '../src/trade/trade';
import { GIFT_HOLD_ROUTES, giftVisible } from '../src/scenes/Menu/GiftArrival';
import { listCards } from '../src/scenes/DeckEdit/cardList';
import { arrange, deckOf, eventsOf, forceDice, ok, startMain } from './helpers';
import { protocolVersion } from '../src/config/version';

/**
 * v2.7 トロフィあげ を カードとして使えるように（SPEC §7 S20）：確認 ①〜⑧。
 * ⑤ を Worker とブラウザで確かめるのは scripts/trophy-gift-e2e.mjs（Playwright・手元の Worker）。Worker 単体は scripts/worker-test.mjs
 */

const T7 = trophyCardNo(7);

describe('① トロフィあげ の数値どおりに動く（HP100・1-2 相手に30・3-4 相手に40・5-6 回復20）', () => {
  it('カードの定義（cards.json の trophy）', () => {
    const d = trophyDef(7);
    if (d.kind !== 'otege') throw new Error('おてあげ');
    expect(d.hp).toBe(100);
    expect(d.rarity).toBe('normal');
    expect(d.moves).toEqual([
      { faces: [1, 2], effects: [{ type: 'damage', amount: 30 }] },
      { faces: [3, 4], effects: [{ type: 'damage', amount: 40 }] },
      { faces: [5, 6], effects: [{ type: 'heal', amount: 20 }] },
    ]);
    expect((raw as { trophy: { hp: number } }).trophy.hp).toBe(100);
    expect(cardById('trophy_7')?.no).toBe(T7);
  });

  it('対戦で：目ごとのダメージと回復', () => {
    const game = (): GameState => {
      let s = startMain({ decks: { p1: [T7, ...deckOf([['oteage', 3], ['mutsuashi', 3], ['sanbon', 3], ['hasami', 3], ['yotsuashi', 2]])], p2: deckOf([['mutsuashi', 3], ['oteage', 3], ['sanbon', 3], ['hasami', 3], ['yotsuashi', 3]]) } });
      s = arrange(s, 'p1', { active: 'trophy_7' });
      return arrange(s, 'p2', { active: 'mutsuashi' });
    };
    const act = (s: GameState, side: Side) => s.players[side].active!;
    for (const [face, opp] of [[1, 30], [2, 30], [3, 40], [4, 40]] as const) {
      const s = game();
      const r = ok(forceDice(s, face), { type: 'END_TURN', player: 'p1' });
      const dmg = eventsOf(r.events, 'Damaged');
      expect(dmg.map((d) => [r.state.cards[d.uid].owner, d.amount]), `目${face}`).toEqual([['p2', opp]]);
    }
    for (const face of [5, 6]) {
      let s = game();
      s = { ...s, cards: { ...s.cards, [act(s, 'p1')]: { ...s.cards[act(s, 'p1')], hp: 50 } } };
      const r = ok(forceDice(s, face), { type: 'END_TURN', player: 'p1' });
      expect(eventsOf(r.events, 'Damaged'), `目${face}`).toEqual([]);
      expect(r.state.cards[act(s, 'p1')].hp, `目${face}`).toBe(70);
    }
  });
});

describe('② トレードに出せない（ストーリー限定と同じ扱い・同じ表示）', () => {
  it('出せない・受け取らない。一覧には「げんてい」で灰色に出る', () => {
    expect(isTradable(T7)).toBe(false);
    expect(hasUntradable({ [T7]: 1 })).toBe(true);
    expect(cleanOffer({ [T7]: 1 })).toBeNull();
    const save = { ...createDefaultSave(), trophies: [{ number: 7, receivedAt: 1 }] };
    const list = giveCandidates(save);
    expect(list.find((c) => c.no === T7)).toEqual({ no: T7, limited: true });
    // ストーリーの限定カードと同じ形
    const usagi = cardById('oteage_usagi')!.no;
    expect(giveCandidates({ ...save, collection: { ...save.collection, [usagi]: 1 } }).find((c) => c.no === usagi)).toEqual({ no: usagi, limited: true });
  });
});

describe('③ パックから出ない', () => {
  it('どのパックの枠にも入っていない（カードの一覧 CARD_LIST にも無い）', () => {
    const ids = JSON.stringify(packs);
    expect(ids).not.toMatch(/trophy/);
    expect(Object.values(CARD_DB).some((c) => c.no >= 50000)).toBe(false);
  });
});

describe('④ スーパーの「デッキに1枚まで」の枠を使わない', () => {
  it('スーパー1枚と トロフィあげ 2枚を同じデッキに入れられる', () => {
    const superNo = cardById('kami')!.no;
    const deck = [superNo, T7, trophyCardNo(8), ...deckOf([['oteage', 3], ['mutsuashi', 3], ['sanbon', 3], ['hasami', 3]])];
    expect(deck).toHaveLength(15);
    expect(validateDeck(deck, CARD_DB, DEFAULT_RULES)).toEqual([]);
  });

  it('デッキ編集の一覧：持っていれば「ぜんぶ」と「げんてい」に出る。スーパーで絞ると出ない', () => {
    const save = { ...createDefaultSave(), trophies: [{ number: 7, receivedAt: 1 }] };
    expect(listCards(save, 'all', null, 'no').some((c) => c.no === T7)).toBe(true);
    expect(listCards(save, 'all', 'limited', 'no').some((c) => c.no === T7)).toBe(true);
    expect(listCards(save, 'super', null, 'no').some((c) => c.no === T7)).toBe(false);
  });
});

/** 郵便受けの Worker の代わり（渡し済みにするのは「受け取った」が届いた時だけ） */
function fakeServer() {
  const box = new Map<number, boolean>();
  let failAck = false;
  let failGet = false;
  const calls: string[] = [];
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    calls.push(url);
    if (url.includes('/mailbox/ack')) {
      if (failAck) throw new Error('切れた');
      for (const n of JSON.parse(String(init?.body)).numbers as number[]) if (box.has(n)) box.set(n, true);
      return new Response('{"ok":true}');
    }
    if (failGet) throw new Error('切れた');
    return new Response(JSON.stringify({ trophies: [...box].filter(([, d]) => !d).map(([number]) => ({ number, created: 1 })) }));
  });
  return {
    give: (n: number) => box.set(n, false),
    delivered: (n: number) => box.get(n) === true,
    calls,
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
  vi.useRealTimers();
  clearArrived();
});

describe('⑧ 途中で通信が切れても1枚だけ届く（① セーブに入れる → ② 受け取ったと返す → ③ 渡し済み）', () => {
  it('② が届かない：セーブには1枚。次に確かめた時は足さずに ② だけやり直し、③ になる', async () => {
    const srv = fakeServer();
    srv.give(3001);
    const save = registered();
    const update = (fn: (d: typeof save) => void) => fn(save);
    srv.setFailAck(true);
    expect(await checkMailbox(save, update)).toEqual([3001]);
    expect(save.trophies.map((t) => t.number)).toEqual([3001]);
    expect(srv.delivered(3001)).toBe(false);
    srv.setFailAck(false);
    expect(await checkMailbox(save, update)).toEqual([]);
    expect(save.trophies.map((t) => t.number)).toEqual([3001]);
    expect(srv.delivered(3001)).toBe(true);
    // 演出は1回だけ
    expect(arrivedTrophies()).toEqual([3001]);
  });

  it('① の前に切れた：セーブは0枚・郵便受けに残る（0枚にならない）。つながったら1枚', async () => {
    const srv = fakeServer();
    srv.give(3002);
    const save = registered();
    const update = (fn: (d: typeof save) => void) => fn(save);
    srv.setFailGet(true);
    expect(await checkMailbox(save, update)).toEqual([]);
    expect(save.trophies).toEqual([]);
    expect(srv.delivered(3002)).toBe(false);
    srv.setFailGet(false);
    expect(await checkMailbox(save, update)).toEqual([3002]);
    expect(save.trophies.map((t) => t.number)).toEqual([3002]);
    expect(srv.delivered(3002)).toBe(true);
  });

  it('知らせが続けて来ても（確かめている途中にもう一度）、1枚だけ', async () => {
    const srv = fakeServer();
    srv.give(3003);
    const save = registered();
    // セーブの書き換えが画面に届くのが遅い（React は次に描く時に書き換える）：入ったのを見てから「受け取った」と返す
    let view = registered();
    const update = (fn: (d: typeof save) => void) => {
      fn(save);
      setTimeout(() => (view = structuredClone(save)), 120);
    };
    const a = checkMailbox(() => view, update);
    const b = checkMailbox(() => view, update);
    await Promise.all([a, b]);
    await checkMailbox(() => view, update);
    expect(save.trophies.map((t) => t.number)).toEqual([3003]);
    expect(arrivedTrophies()).toEqual([3003]);
    expect(srv.delivered(3003)).toBe(true);
  });

  it('セーブに入らなかった（画面が閉じた など）：「受け取った」と返さない（郵便受けに残る）', async () => {
    const srv = fakeServer();
    srv.give(3005);
    const save = registered();
    expect(await checkMailbox(() => save, () => {})).toEqual([]);
    expect(srv.delivered(3005)).toBe(false);
    expect(arrivedTrophies()).toEqual([]);
  });
});

/** 届け係の WebSocket の代わり */
function fakeSockets() {
  const list: (GiftSocket & { url: string; closed: boolean })[] = [];
  const open = (url: string) => {
    const s = { url, closed: false, onopen: null, onmessage: null, onclose: null, onerror: null, close: () => void (s.closed = true) } as GiftSocket & { url: string; closed: boolean };
    list.push(s);
    return s;
  };
  return { list, open, last: () => list[list.length - 1] };
}
function fakeDoc() {
  let fn: (() => void) | null = null;
  const d = {
    visibilityState: 'visible',
    addEventListener: (_k: 'visibilitychange', f: () => void) => void (fn = f),
    removeEventListener: () => void (fn = null),
    set: (v: 'visible' | 'hidden') => {
      d.visibilityState = v;
      fn?.();
    },
  };
  return d;
}

describe('⑤ 開いている人には すぐ届く（届け係の知らせ）', () => {
  it('つないだら確かめ、「gift」の知らせで すぐ確かめる。待っている間は何も送らず、確かめにも行かない', () => {
    vi.useFakeTimers();
    const ws = fakeSockets();
    const check = vi.fn();
    const stop = startGiftLink({ getSave: registered, update: () => {}, openSocket: ws.open, check, doc: fakeDoc() });
    expect(check).toHaveBeenCalledTimes(0); // つながった時に確かめる（2回確かめない）
    expect(ws.last().url).toMatch(/^wss?:\/\/.*\/gift-link\?userId=[^&]*&token=[0-9a-f]+$/);
    ws.last().onopen!();
    expect(check).toHaveBeenCalledTimes(1); // つないだ時（閉じていた間に届いた物）
    vi.advanceTimersByTime(10 * GIFT_POLL_MS);
    expect(check).toHaveBeenCalledTimes(1); // つながっている間は60秒ごとに確かめない
    giftMenuCheck();
    expect(check).toHaveBeenCalledTimes(1); // メニューに戻っても確かめない
    ws.last().onmessage!({ data: '{"t":"gift"}' });
    expect(check).toHaveBeenCalledTimes(2);
    stop();
  });

  it('切れたら自動でつなぎ直す（その間は60秒ごと・メニューで確かめる）。裏に回ったら切り、表に戻ったら つなぎ直して確かめる', () => {
    vi.useFakeTimers();
    const ws = fakeSockets();
    const check = vi.fn();
    const doc = fakeDoc();
    const stop = startGiftLink({ getSave: registered, update: () => {}, openSocket: ws.open, check, doc });
    ws.last().onopen!();
    ws.last().onclose!();
    expect(ws.list).toHaveLength(1);
    vi.advanceTimersByTime(GIFT_RETRY_MS[0]);
    expect(ws.list).toHaveLength(2);
    const n = check.mock.calls.length;
    giftMenuCheck();
    expect(check).toHaveBeenCalledTimes(n + 1);
    vi.advanceTimersByTime(GIFT_POLL_MS);
    expect(check).toHaveBeenCalledTimes(n + 2);
    ws.last().onopen!();
    // 裏に回った：切る。つなぎ直さない・確かめない
    doc.set('hidden');
    expect(ws.last().closed).toBe(true);
    const m = check.mock.calls.length;
    vi.advanceTimersByTime(5 * GIFT_POLL_MS);
    expect(ws.list).toHaveLength(2);
    expect(check).toHaveBeenCalledTimes(m);
    // 表に戻った：つなぎ直し、つながったら確かめる
    doc.set('visible');
    expect(ws.list).toHaveLength(3);
    ws.last().onopen!();
    expect(check).toHaveBeenCalledTimes(m + 1);
    stop();
  });

  it('ほかのタブ・端末に替えられた（4000）・失敗が続いた時は、つなぎ直さない（60秒ごとに確かめる）', () => {
    vi.useFakeTimers();
    const ws = fakeSockets();
    const check = vi.fn();
    const stop = startGiftLink({ getSave: registered, update: () => {}, openSocket: ws.open, check, doc: fakeDoc() });
    ws.last().onopen!();
    ws.last().onclose!({ code: GIFT_CLOSE_REPLACED });
    vi.advanceTimersByTime(5 * 60e3);
    expect(ws.list).toHaveLength(1);
    expect(check.mock.calls.length).toBeGreaterThanOrEqual(5);
    stop();
    // 一度もつながらずに失敗が続く（token が違う など）
    const ws2 = fakeSockets();
    const stop2 = startGiftLink({ getSave: registered, update: () => {}, openSocket: ws2.open, check: vi.fn(), doc: fakeDoc() });
    for (let i = 0; i < 20; i++) {
      ws2.last().onclose?.();
      vi.advanceTimersByTime(60e3);
    }
    expect(ws2.list).toHaveLength(GIFT_MAX_FAILURES + 1); // はじめの1回と、つなぎ直し6回
    stop2();
  });

  it('WebSocket が使えない時は、起動した時・メニューに戻った時・60秒ごとに確かめる', () => {
    vi.useFakeTimers();
    const check = vi.fn();
    const stop = startGiftLink({ getSave: registered, update: () => {}, openSocket: null, check, doc: fakeDoc() });
    expect(check).toHaveBeenCalledTimes(1);
    giftMenuCheck();
    expect(check).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(GIFT_POLL_MS);
    expect(check).toHaveBeenCalledTimes(3);
    vi.advanceTimersByTime(GIFT_POLL_MS);
    expect(check).toHaveBeenCalledTimes(4);
    stop();
  });
});

describe('⑥ 対戦中・ガチャの演出中・トレードの途中は割り込まず、終わってから出す', () => {
  it('対戦などの画面・印が立っている間は出さない', () => {
    expect(GIFT_HOLD_ROUTES).toEqual(expect.arrayContaining(['battle', 'tutorial', 'title']));
    expect(giftVisible(7, 'battle', false)).toBe(false);
    // 対戦が終わった（リザルト・メニュー）
    expect(giftVisible(7, 'result', false)).toBe(true);
    expect(giftVisible(7, 'menu', false)).toBe(true);
    // ガチャの演出中・トレードの途中（画面が立てる印）
    setGiftHold('gacha', true);
    expect(giftVisible(7, 'gacha', false)).toBe(false);
    setGiftHold('gacha', false);
    expect(giftVisible(7, 'gacha', false)).toBe(true);
    setGiftHold('trade', true);
    expect(giftVisible(7, 'trade', false)).toBe(false);
    setGiftHold('trade', false);
    // チュートリアルの続き（メニューでの案内）の間
    expect(giftVisible(7, 'menu', true)).toBe(false);
    expect(giftVisible(undefined, 'menu', false)).toBe(false);
  });
});

describe('⑦ 閉じていた人は、次に開いた時に受け取る', () => {
  it('起動した時に郵便受けを確かめる（届け係につながる前に）', async () => {
    const srv = fakeServer();
    srv.give(3004);
    const save = registered();
    const update = (fn: (d: typeof save) => void) => fn(save);
    const stop = startGiftLink({ getSave: () => save, update, openSocket: null, doc: fakeDoc() });
    await vi.waitFor(() => expect(save.trophies.map((t) => t.number)).toEqual([3004]));
    expect(srv.delivered(3004)).toBe(true);
    expect(arrivedTrophies()).toEqual([3004]);
    shownArrived(3004);
    expect(arrivedTrophies()).toEqual([]);
    stop();
  });
});

describe('全体', () => {
  it('プロトコル版数を上げた（17 以上。v2.7 のバランス調整で 18）', () => {
    expect(protocolVersion).toBeGreaterThanOrEqual(17);
  });
});
