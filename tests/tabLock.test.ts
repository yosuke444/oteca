import { describe, expect, it } from 'vitest';
import { type CookieJar, persist, wipe } from '../src/save/cookieStore';
import { createDefaultSave } from '../src/save/saveData';
import { saveBackupInfo } from '../src/save/backupReminder';
import { savePendingTrade } from '../src/trade/pendingStore';
import { HEARTBEAT_MS, type LockLike, OWNER_KEY, STALE_MS, type TabEnv, TabGuard, tabGuard } from '../src/tabLock/tabGuard';

/** 同じブラウザの「みんなで使う localStorage」。書いたら、ほかのタブにだけ storage イベントを送る（送るのは flush の時） */
class SharedStorage {
  map = new Map<string, string>();
  private tabs = new Map<string, (key: string | null) => void>();
  private queue: (() => void)[] = [];
  view(id: string) {
    const notify = (k: string) => {
      for (const [tid, fn] of this.tabs) if (tid !== id) this.queue.push(() => fn(k));
    };
    return {
      getItem: (k: string) => this.map.get(k) ?? null,
      setItem: (k: string, v: string) => {
        this.map.set(k, v);
        notify(k);
      },
      removeItem: (k: string) => {
        this.map.delete(k);
        notify(k);
      },
    };
  }
  listen(id: string, fn: (key: string | null) => void) {
    this.tabs.set(id, fn);
    return () => void this.tabs.delete(id);
  }
  flush() {
    const q = this.queue.splice(0);
    for (const f of q) f();
  }
}

/** navigator.locks のまね（1つの名前・ifAvailable と steal だけ） */
class FakeLocks implements LockLike {
  holder: { reject: (e: unknown) => void } | null = null;
  request(_name: string, opts: { ifAvailable?: boolean; steal?: boolean }, cb: (lock: unknown) => Promise<void>): Promise<void> {
    if (opts.ifAvailable && this.holder) return cb(null);
    if (opts.steal && this.holder) {
      const h = this.holder;
      this.holder = null;
      h.reject(new Error('AbortError'));
    }
    return new Promise<void>((resolve, reject) => {
      const h = { reject };
      this.holder = h;
      void cb({}).then(() => {
        if (this.holder === h) this.holder = null;
        resolve();
      });
    });
  }
}

type Clock = { now: number; timers: Map<number, { fn: () => void; ms: number; next: number }>; seq: number };

function makeEnv(id: string, shared: SharedStorage, locks: LockLike | null, clock: Clock): TabEnv & { hide: () => void; setHidden: (h: boolean) => void } {
  let onHide = () => {};
  let onVis = () => {};
  let isHidden = false;
  return {
    hidden: () => isHidden,
    onVisibility: (fn) => {
      onVis = fn;
      return () => {};
    },
    setHidden: (h) => {
      isHidden = h;
      onVis();
    },
    id,
    locks,
    storage: shared.view(id),
    now: () => clock.now,
    wait: async (ms) => {
      clock.now += ms;
    },
    setInterval: (fn, ms) => {
      const k = ++clock.seq;
      clock.timers.set(k, { fn, ms, next: clock.now + ms });
      return k;
    },
    clearInterval: (k) => void clock.timers.delete(k as number),
    onStorage: (fn) => shared.listen(id, fn),
    onPageHide: (fn) => {
      onHide = fn;
      return () => {};
    },
    hide: () => onHide(),
  };
}

function advance(clock: Clock, ms: number) {
  const end = clock.now + ms;
  for (;;) {
    const due = [...clock.timers.values()].filter((t) => t.next <= end).sort((a, b) => a.next - b.next)[0];
    if (!due) break;
    clock.now = due.next;
    due.next += due.ms;
    due.fn();
  }
  clock.now = end;
}

const newClock = (): Clock => ({ now: 1_000_000, timers: new Map(), seq: 0 });
const tick = () => new Promise((r) => setTimeout(r, 0));

for (const mode of ['Web Locks', 'localStorage だけ'] as const) {
  describe(`複数のタブ（${mode}）`, () => {
    const setup = () => {
      const shared = new SharedStorage();
      const locks = mode === 'Web Locks' ? new FakeLocks() : null;
      const clock = newClock();
      return { shared, clock, locks, envA: makeEnv('A', shared, locks, clock), envB: makeEnv('B', shared, locks, clock) };
    };

    it('1つ目のタブは動き、2つ目のタブは止まる（セーブを書けない）', async () => {
      const { envA, envB } = setup();
      const a = new TabGuard();
      const b = new TabGuard();
      expect(await a.start(envA)).toBe('active');
      expect(await b.start(envB)).toBe('blocked');
      expect(a.mayWrite()).toBe(true);
      expect(b.mayWrite()).toBe(false);
    });

    it('「この タブで あそぶ」：2つ目が動き、1つ目は止まる。止まったタブは知らせが届く前でも書けない', async () => {
      const { shared, envA, envB } = setup();
      const a = new TabGuard();
      const b = new TabGuard();
      await a.start(envA);
      await b.start(envB);
      const seen: string[] = [];
      a.subscribe((s) => seen.push(s));
      await b.takeOver();
      expect(b.state).toBe('active');
      // まだ storage イベントは届いていない（localStorage だけの時）。それでも書く直前の確かめで止まる
      expect(a.mayWrite()).toBe(false);
      expect(a.state).toBe('stolen');
      shared.flush();
      await tick();
      expect(seen).toEqual(['stolen']);
      expect(b.mayWrite()).toBe(true);
      expect(JSON.parse(shared.map.get(OWNER_KEY)!).id).toBe('B');
    });

    it('止まったタブから取り返せる（もう一度「この タブで あそぶ」）', async () => {
      const { shared, envA, envB } = setup();
      const a = new TabGuard();
      const b = new TabGuard();
      await a.start(envA);
      await b.start(envB);
      await b.takeOver();
      shared.flush();
      await tick();
      await a.takeOver();
      shared.flush();
      await tick();
      expect(a.state).toBe('active');
      expect(b.state).toBe('stolen');
      expect(b.mayWrite()).toBe(false);
    });

    it('動いているタブが対戦中なら、止まったタブから分かる', async () => {
      const { envA, envB } = setup();
      const a = new TabGuard();
      const b = new TabGuard();
      await a.start(envA);
      await b.start(envB);
      expect(b.otherInBattle()).toBe(false);
      a.setBattle(true);
      expect(b.otherInBattle()).toBe(true);
      a.setBattle(false);
      expect(b.otherInBattle()).toBe(false);
    });

    it('動いていたタブを閉じた（読み込み直した）あとは、新しいタブが動ける', async () => {
      const { shared, envA, clock, locks } = setup();
      const a = new TabGuard();
      await a.start(envA);
      envA.hide();
      // ページが閉じると鍵も手放す
      if (locks) locks.holder = null;
      const c = new TabGuard();
      expect(await c.start(makeEnv('C', shared, locks, clock))).toBe('active');
    });
  });
}

describe('localStorage だけの時の心拍', () => {
  it('心拍が続く間は2つ目が止まる。心拍が止まった札（固まった・閉じたタブ）は、しばらくすると無視される', async () => {
    const shared = new SharedStorage();
    const clock = newClock();
    const a = new TabGuard();
    await a.start(makeEnv('A', shared, null, clock));
    advance(clock, HEARTBEAT_MS * 5);
    const b = new TabGuard();
    expect(await b.start(makeEnv('B', shared, null, clock))).toBe('blocked');
    // A が固まった（心拍が来ない）：古い札
    clock.timers.clear();
    clock.now += STALE_MS + 1;
    const c = new TabGuard();
    expect(await c.start(makeEnv('C', shared, null, clock))).toBe('active');
    // A は、書く直前に札が自分でないと気づいて止まる
    expect(a.mayWrite()).toBe(false);
  });
});

describe('localStorage だけの時：裏に回ったタブ', () => {
  it('裏のタブは心拍が遅れても古いとみなさない（2つ目は止まる）。閉じたら札が外れて動ける', async () => {
    const shared = new SharedStorage();
    const clock = newClock();
    const a = new TabGuard();
    const envA = makeEnv('A', shared, null, clock);
    await a.start(envA);
    envA.setHidden(true);
    // 裏のタブはタイマーが止まる（心拍が来ない）
    clock.timers.clear();
    clock.now += 60_000;
    const b = new TabGuard();
    expect(await b.start(makeEnv('B', shared, null, clock))).toBe('blocked');
    envA.hide();
    const c = new TabGuard();
    expect(await c.start(makeEnv('C', shared, null, clock))).toBe('active');
  });
});

describe('止まったタブはセーブを書かない（書く直前の確かめ）', () => {
  it('persist・wipe・「データを まもろう」・とちゅうの交換の記録が、止まったタブでは何も書かない', async () => {
    const shared = new SharedStorage();
    const locks = new FakeLocks();
    const clock = newClock();
    await tabGuard.start(makeEnv('A', shared, locks, clock));
    const writes: string[] = [];
    const jar: CookieJar = { get: () => '', set: (c) => void writes.push(c) };
    const map = new Map<string, string>();
    const local = { getItem: () => null, setItem: (k: string, v: string) => void map.set(k, v), removeItem: (k: string) => void map.delete(k) };
    persist({ jar, local, secure: false }, createDefaultSave(false));
    expect(writes.length).toBeGreaterThan(0);

    // ほかのタブが動くタブになった
    const b = new TabGuard();
    await b.start(makeEnv('B', shared, locks, clock));
    await b.takeOver();
    writes.length = 0;
    map.clear();
    persist({ jar, local, secure: false }, { ...createDefaultSave(false), coins: 99999 });
    wipe({ jar, local, secure: false });
    saveBackupInfo(local, { firstSeenAt: 1, lastCodeAt: null, deckSavedAt: null });
    savePendingTrade(null, local);
    expect(writes).toEqual([]);
    expect(map.size).toBe(0);
    expect(tabGuard.state).toBe('stolen');
  });
});
