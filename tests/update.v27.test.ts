import { describe, expect, it } from 'vitest';
import { buildId, protocolVersion } from '../src/config/version';
import { makeMsg } from '../src/net/protocol';
import { type SessionStatus } from '../src/net/session';
import { TradeSession, type TradeView } from '../src/net/tradeSession';
import { MemoryHub } from '../src/net/transport';
import { checkForUpdate, fetchLatest, isOutdated, latestVersion, outdatedNow, parseVersion, reloadUrl, resetUpdateForTest, versionUrl, withoutV } from '../src/update/update';
import { BUILT_PROTOCOL, currentProtocol, isTooOld, readProtocol } from '../worker/src/logic/version';
import { pickPairs, type Waiter } from '../worker/src/logic/queue';
import { FakeClock, makePeer, settle } from './net.helpers';

/**
 * v2.7 新しい版のお知らせと、版が違う人どうしが つながらない仕組み（確認 ①〜⑦。画面は scripts/update-e2e.mjs）
 */

/** version.json を返すにせの fetch（呼ばれた URL と設定も覚える） */
function fakeFetch(body: unknown, status = 200) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fn = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    if (body instanceof Error) throw body;
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
  }) as unknown as typeof fetch;
  return { fn, calls };
}

describe('① version.json の番号が違うと「新しい版がある」', () => {
  it('ビルドID が違えば古い版。同じなら古くない', () => {
    expect(isOutdated({ build: 'abc1234', protocol: 15 }, { build: 'def5678', protocol: 15 })).toBe(true);
    expect(isOutdated({ build: 'abc1234', protocol: 15 }, { build: 'abc1234', protocol: 15 })).toBe(false);
    // プロトコル版数が大きい時も古い
    expect(isOutdated({ build: 'abc1234', protocol: 16 }, { build: 'abc1234', protocol: 15 })).toBe(true);
  });

  it('取りに行くと、覚えて「古い版」になる。キャッシュを使わず、URL に時刻を付ける', async () => {
    resetUpdateForTest();
    const f = fakeFetch({ build: 'zzz9999', protocol: protocolVersion });
    await checkForUpdate(f.fn);
    expect(latestVersion()).toEqual({ build: 'zzz9999', protocol: protocolVersion });
    expect(outdatedNow()).toBe(buildId !== 'zzz9999');
    expect(f.calls[0].init?.cache).toBe('no-store');
    expect(f.calls[0].url).toMatch(/version\.json\?t=\d+$/);
    expect(versionUrl(123, '/oteca/')).toBe('/oteca/version.json?t=123');
    // 今の版と同じなら、古くない
    resetUpdateForTest();
    await checkForUpdate(fakeFetch({ build: buildId, protocol: protocolVersion }).fn);
    expect(outdatedNow()).toBe(false);
  });
});

describe('② 取れない時は何も出さない', () => {
  it('オフライン・404・壊れた中身は null。前に分かった結果はそのまま', async () => {
    for (const f of [fakeFetch(new TypeError('offline')), fakeFetch({}, 404), fakeFetch('<html>', 200), fakeFetch({ build: '', protocol: 'x' })]) {
      expect(await fetchLatest(f.fn)).toBeNull();
    }
    resetUpdateForTest();
    await checkForUpdate(fakeFetch(new TypeError('offline')).fn);
    expect(latestVersion()).toBeNull();
    expect(outdatedNow()).toBe(false);
    // 一度「新しい版がある」と分かった後に取れなくなっても、消さない
    await checkForUpdate(fakeFetch({ build: 'zzz9999', protocol: protocolVersion }).fn);
    await checkForUpdate(fakeFetch(new TypeError('offline')).fn);
    expect(latestVersion()?.build).toBe('zzz9999');
    resetUpdateForTest();
  });

  it('version.json の形を確かめる', () => {
    expect(parseVersion({ build: 'a1b2c3d', protocol: 15 })).toEqual({ build: 'a1b2c3d', protocol: 15 });
    expect(parseVersion({ build: 'A B', protocol: 15 })).toBeNull();
    expect(parseVersion({ build: 'a', protocol: 0 })).toBeNull();
    expect(parseVersion(null)).toBeNull();
  });
});

describe('⑤ フレンド部屋・トレードで版が違うと始まらず、両方に文が出る', () => {
  it('フレンド部屋：古い方は「自分が古い（さいよみこみ）」、新しい方は「相手が古い」。対戦は始まらない', async () => {
    const hub = new MemoryHub();
    const clock = new FakeClock();
    const oldP = makePeer(hub, clock, 'old', { protocol: 14 });
    const newP = makePeer(hub, clock, 'new', { protocol: 15 });
    const got: Record<string, SessionStatus[]> = { old: [], new: [] };
    oldP.s.onStatus = (s) => got.old.push(s);
    newP.s.onStatus = (s) => got.new.push(s);
    oldP.s.join('5555');
    clock.advance(10);
    newP.s.join('5555');
    await settle(hub);
    clock.advance(2000);
    await settle(hub);
    expect(got.old.at(-1)).toEqual({ kind: 'version', older: true });
    expect(got.new.at(-1)).toEqual({ kind: 'version', older: false });
    expect(oldP.starts).toEqual([]);
    expect(newP.starts).toEqual([]);
  });

  it('トレード：同じように、古い方と新しい方で違う文（versionOlder）', async () => {
    const hub = new MemoryHub();
    const clock = new FakeClock();
    const mk = (id: string, protocol: number) => {
      const views: TradeView[] = [];
      const s = new TradeSession(hub.create(id), { name: id, playerId: `p-${id}`, protocol, appVersion: '0', doneIds: () => [], pending: () => null, canGive: () => true, clock, randomBytes: (n) => new Uint8Array(n).fill(id.length) });
      s.onChange = (v) => views.push(v);
      return { s, views };
    };
    const a = mk('old', 14);
    const b = mk('newer', 15);
    a.s.join('7777');
    b.s.join('7777');
    await settle(hub);
    clock.advance(2000);
    await settle(hub);
    expect(a.views.at(-1)).toMatchObject({ status: 'version', versionOlder: true });
    expect(b.views.at(-1)).toMatchObject({ status: 'version', versionOlder: false });
  });

  it('受け取る側でも版を確かめる：違う版の対戦のメッセージは受け取らない', async () => {
    const hub = new MemoryHub();
    const clock = new FakeClock();
    const a = makePeer(hub, clock, 'a', { protocol: 15 });
    const b = makePeer(hub, clock, 'b', { protocol: 15 });
    a.s.join('8888');
    clock.advance(10);
    b.s.join('8888');
    await settle(hub);
    clock.advance(2000);
    await settle(hub);
    expect(a.starts).toHaveLength(1);
    // 古い版の形の「操作」が届いても、受け取らない（記録に残るだけ）
    b.t.send(makeMsg('action', 14, { seq: 1, game: a.starts[0].game, action: { type: 'END_TURN' } } as never));
    await settle(hub);
    expect((a.s.debugLog() as { ignored: string[] }).ignored.some((x) => x.startsWith('action v14'))).toBe(true);
  });
});

describe('⑥ レートで版が違う人どうしは組まれない（受付係）', () => {
  const w = (n: number, protocol: number): Waiter => ({ id: `w${n}`, playerId: String(100000000000000 + n), protocol, lastOpponentId: '', name: '', rate: 100, trophies: 0, tab: '', joinedAt: n, seq: n });

  it('同じ版の人どうしだけ組む', () => {
    expect(pickPairs([w(1, 14), w(2, 15)])).toEqual([]);
    expect(pickPairs([w(1, 14), w(2, 15), w(3, 15)]).map((p) => [p.a.id, p.b.id])).toEqual([['w2', 'w3']]);
  });

  it('今の版は、公開している version.json の版（読めない時だけ Worker を作った時の版）。それより古い申し込みは断る', () => {
    expect(BUILT_PROTOCOL).toBe(protocolVersion);
    expect(currentProtocol(null)).toBe(protocolVersion);
    expect(currentProtocol(protocolVersion + 1)).toBe(protocolVersion + 1);
    // Worker を先に新しい版でデプロイしても、公開しているゲームが前の版なら、その版の人は断らない
    expect(currentProtocol(protocolVersion - 1)).toBe(protocolVersion - 1);
    expect(isTooOld(protocolVersion - 1, currentProtocol(protocolVersion - 1))).toBe(false);
    expect(isTooOld(protocolVersion - 1, currentProtocol(null))).toBe(true);
    expect(isTooOld(protocolVersion, currentProtocol(null))).toBe(false);
    expect(readProtocol({ build: 'x', protocol: 16 })).toBe(16);
    expect(readProtocol({ protocol: '16' })).toBeNull();
  });
});

describe('⑦ 「さいよみこみ」は ?v=新しい番号 を付けて開き直し、開いた後は ?v= を消す', () => {
  it('ほかの ?debug=1 などは残す', () => {
    expect(reloadUrl('https://x.github.io/oteca/?debug=1', 'abc1234')).toBe('https://x.github.io/oteca/?debug=1&v=abc1234');
    expect(reloadUrl('https://x.github.io/oteca/?v=old', 'abc1234')).toBe('https://x.github.io/oteca/?v=abc1234');
    expect(withoutV('https://x.github.io/oteca/?debug=1&v=abc1234')).toBe('https://x.github.io/oteca/?debug=1');
    expect(withoutV('https://x.github.io/oteca/?debug=1')).toBeNull();
  });
});
