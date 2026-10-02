import { describe, expect, it } from 'vitest';
import { STARTER_COINS, STARTER_DECK_NAME, starterCollection, starterDeckNos } from '../src/data/starterDeck';
import { checkSavedDeck } from '../src/save/collection';
import { toBase64Url } from '../src/save/base64url';
import {
  CHUNK_SIZE,
  COOKIE_META,
  type CookieJar,
  type KeyValueStore,
  load,
  parseCookies,
  persist,
  readCookies,
  sealSave,
  writeCookies,
} from '../src/save/cookieStore';
import { DECK_SLOTS, createDefaultSave, defaultDeckName, normalizeSave, type SaveData } from '../src/save/saveData';
import { randomSave } from './save.helpers';

/** document.cookie のまねをする偽物（max-age=0 で消える） */
function fakeJar(): CookieJar & { store: Map<string, string>; writes: string[] } {
  const store = new Map<string, string>();
  const writes: string[] = [];
  return {
    store,
    writes,
    get: () => [...store].map(([k, v]) => `${k}=${v}`).join('; '),
    set: (c) => {
      writes.push(c);
      const [pair, ...attrs] = c.split(';');
      const i = pair.indexOf('=');
      const name = pair.slice(0, i).trim();
      if (attrs.some((a) => a.trim() === 'max-age=0')) store.delete(name);
      else store.set(name, pair.slice(i + 1));
    },
  };
}

function fakeLocal(): KeyValueStore & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return { map, getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v), removeItem: (k) => void map.delete(k) };
}

/** 分割が起きるくらい大きいデータ */
function bigSave(): SaveData {
  const d = createDefaultSave();
  d.collection = Object.fromEntries(Array.from({ length: 4000 }, (_, i) => [i + 1, 200 + (i % 50)]));
  return d;
}

describe('Cookie への保存', () => {
  it('V04 Cookie の分割保存・結合が正しい', () => {
    const jar = fakeJar();
    const data = bigSave();
    const sealed = sealSave(data);
    expect(sealed.length).toBeGreaterThan(CHUNK_SIZE * 2);

    writeCookies(jar, sealed, true);
    const names = [...jar.store.keys()].filter((k) => k.startsWith('oteca_s'));
    expect(names).toEqual(['oteca_s0', 'oteca_s1', 'oteca_s2', ...names.slice(3)]);
    for (const n of names) expect(jar.store.get(n)!.length).toBeLessThanOrEqual(CHUNK_SIZE);
    expect(jar.store.get(COOKIE_META)!.startsWith(`${names.length}.`)).toBe(true);
    expect(readCookies(jar)).toBe(sealed);

    // 属性：path＝公開パス（テストでは /）・400日・SameSite=Lax・（https なら）Secure
    for (const w of jar.writes) expect(w).toMatch(/; path=\/; max-age=34560000; SameSite=Lax; Secure$/);

    // 小さいデータで保存し直すと、余った分割 Cookie は消える
    const small = createDefaultSave();
    writeCookies(jar, sealSave(small), false);
    expect([...jar.store.keys()].filter((k) => k.startsWith('oteca_s'))).toEqual(['oteca_s0']);
    expect(readCookies(jar)).toBe(sealSave(small));
  });

  it('V04 分割の1つが欠けたり書き換えられたりしたら読まない', () => {
    const jar = fakeJar();
    writeCookies(jar, sealSave(bigSave()), false);
    const broken = fakeJar();
    for (const [k, v] of jar.store) if (k !== 'oteca_s1') broken.store.set(k, v);
    expect(readCookies(broken)).toBeNull();

    const tampered = fakeJar();
    for (const [k, v] of jar.store) tampered.store.set(k, k === 'oteca_s0' ? `B${v.slice(1)}` : v);
    expect(readCookies(tampered)).toBeNull();
  });

  it('V04 Cookie の中身は暗号化されていて、そのままでは読めない', () => {
    const data = createDefaultSave();
    data.playerName = 'ABCDEFGH';
    const sealed = sealSave(data);
    expect(sealed).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(sealed).not.toContain(toBase64Url(new TextEncoder().encode('ABCDEFGH')).slice(0, 6));
  });

  it('V04 Cookie と localStorage の両方に保存し、保存回数が新しい方を読む', () => {
    const jar = fakeJar();
    const local = fakeLocal();
    const storage = { jar, local, secure: false };
    const a = randomSave(1);
    a.saveCounter = 5;
    persist(storage, a);
    expect(load(storage)).toEqual(a);

    // Cookie だけ消えても localStorage から戻る
    jar.store.clear();
    expect(load(storage)).toEqual(a);

    // Cookie の方が新しければ Cookie を使う
    const b = { ...randomSave(2), saveCounter: 9 };
    writeCookies(jar, sealSave(b), false);
    expect(load(storage)).toEqual(b);

    // localStorage の方が新しければそちら
    const c = { ...randomSave(3), saveCounter: 12 };
    persist({ jar: fakeJar(), local, secure: false }, c);
    expect(load(storage)).toEqual(c);

    expect(load({ jar: fakeJar(), local: fakeLocal(), secure: false })).toBeNull();
    expect(parseCookies('a=1; b=x=y').get('b')).toBe('x=y');
  });
});

describe('V08 新しいセーブ', () => {
  it('初期カード15枚・コイン200枚、スロット1に初期デッキ（使える）、ほかは空。おしらせは出さない', () => {
    const d = createDefaultSave();
    expect(d.collection).toEqual(starterCollection());
    expect(Object.values(d.collection).reduce((a, b) => a + b, 0)).toBe(15);
    expect(d.coins).toBe(STARTER_COINS);
    expect(d.coins).toBe(200);
    expect(d.decks).toHaveLength(DECK_SLOTS);
    expect(d.decks[0]).toEqual({ name: STARTER_DECK_NAME, cards: starterDeckNos() });
    expect(checkSavedDeck(d, 0)).toEqual({ problems: [], shortages: [], usable: true });
    for (let i = 1; i < DECK_SLOTS; i++) expect(d.decks[i]).toEqual({ name: defaultDeckName(i), cards: [] });
    expect(d.unlockAll).toBe(false);
    expect(d.updateNoticeSeen).toBe(true);
    expect(d.tutorial).toEqual({ done: false, gachaInviteShown: false });
    expect(normalizeSave(d)).toEqual(d);
  });
});

describe('V12 デッキ20個を保存し、読み込み直しても残る', () => {
  it('Cookie・localStorage に20個保存して読み直す（片方が消えても残る）', () => {
    const jar = fakeJar();
    const local = fakeLocal();
    const storage = { jar, local, secure: false };
    const d = createDefaultSave();
    d.decks = d.decks.map((_, i) => ({ name: `デッキ${i + 1}ばん`.slice(0, 8), cards: i % 2 ? starterDeckNos() : [1, 2, 3, 1 + (i % 12)] }));
    d.selectedDeck = 19;
    d.saveCounter = 3;
    persist(storage, d);
    const back = load(storage)!;
    expect(back.decks).toHaveLength(20);
    expect(back).toEqual(d);
    jar.store.clear();
    expect(load(storage)).toEqual(d);
    const jar2 = fakeJar();
    persist({ jar: jar2, local: null, secure: false }, d);
    expect(load({ jar: jar2, local: null, secure: false })).toEqual(d);
  });
});

describe('保存の前の整え（normalizeSave）', () => {
  it('おかしな値が入っても、整えたものは必ず保存して読み直せる（読めずに初期化されない）', async () => {
    const { encodeSave } = await import('../src/save/binary');
    const { decodeSave } = await import('../src/save/migrate');
    for (let i = 0; i < 200; i++) {
      const d = randomSave(i);
      d.decks[i % 20].cards = [...Array.from({ length: 70 }, (_, k) => k + 1), 70000, -3, 1.5];
      d.collection[100000] = 5;
      d.collection[7] = 5000;
      d.settings.fxSpeed = 7 as 0;
      const n = normalizeSave(d);
      expect(n.decks[i % 20].cards).toHaveLength(60);
      expect(decodeSave(encodeSave(n))).toEqual(n);
    }
  });
});
