import { describe, expect, it } from 'vitest';
import { starterDeckNos } from '../src/data/starterDeck';
import { toBase64Url } from '../src/save/base64url';
import { encodeSave } from '../src/save/binary';
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
import { decodeSave, migrate } from '../src/save/migrate';
import { createDefaultSave, type SaveData } from '../src/save/saveData';
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
  const d = createDefaultSave(starterDeckNos());
  d.collection = Array.from({ length: 2500 }, (_, i) => ({ no: i + 1, qty: 200 + (i % 50) }));
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

    // 属性：path=/・400日・SameSite=Lax・（https なら）Secure
    for (const w of jar.writes) expect(w).toMatch(/; path=\/; max-age=34560000; SameSite=Lax; Secure$/);

    // 小さいデータで保存し直すと、余った分割 Cookie は消える
    const small = createDefaultSave(starterDeckNos());
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
    const data = createDefaultSave(starterDeckNos());
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

describe('形式の移行', () => {
  /**
   * 形式版数1で保存したバイト列（16進）。今後形式を変えても、これが読めなければいけない。
   * 中身：名前「おてか」、BGM 3・効果音 9・はやい・演出をへらす ON・ヒント OFF、
   *      スロット2（index 1）を選択、デッキ1＝No1×3・名前なし、デッキ2＝名前「つよい」No7・No9、
   *      3勝2敗、コイン5、unlockAll、所持 No12×4、ストーリー 1・2 クリア、保存回数 300
   */
  const V1_FIXTURE_HEX =
    '0101ac0209e3818ae381a6e3818b3906010003010101' +
    '09e381a4e38288e38184020709000000000000030205' +
    '01010c04020102';

  const V1_EXPECTED: SaveData = {
    saveVersion: 1,
    saveCounter: 300,
    playerName: 'おてか',
    settings: { bgm: 3, se: 9, fxSpeed: 1, reduceFx: true, hints: false },
    decks: [
      { name: 'デッキ1', cards: [1, 1, 1] },
      { name: 'つよい', cards: [7, 9] },
      { name: 'デッキ3', cards: [] },
      { name: 'デッキ4', cards: [] },
      { name: 'デッキ5', cards: [] },
    ],
    selectedDeck: 1,
    stats: { wins: 3, losses: 2 },
    coins: 5,
    collection: [{ no: 12, qty: 4 }],
    unlockAll: true,
    story: { cleared: [1, 2] },
  };

  const hexToBytes = (hex: string) => new Uint8Array(hex.match(/../g)!.map((h) => parseInt(h, 16)));

  it('V05 古い形式版数のデータを migrate で読める（形式版数1の保存データ）', () => {
    expect(decodeSave(hexToBytes(V1_FIXTURE_HEX))).toEqual(V1_EXPECTED);
  });

  it('V05 今の形式で書いたものは、固定のバイト列と一致する（形式を黙って変えていない）', () => {
    const hex = [...encodeSave(V1_EXPECTED)].map((b) => b.toString(16).padStart(2, '0')).join('');
    expect(hex).toBe(V1_FIXTURE_HEX);
  });

  it('V05 読めない形式版数・余分なバイト・壊れた値はエラーになる', () => {
    const bytes = hexToBytes(V1_FIXTURE_HEX);
    const future = bytes.slice();
    future[0] = 99;
    expect(() => decodeSave(future)).toThrow('形式版数 99');
    expect(() => decodeSave(new Uint8Array([...bytes, 0]))).toThrow('余分');
    expect(() => decodeSave(bytes.slice(0, -1))).toThrow();
    expect(migrate(1, V1_EXPECTED)).toEqual(V1_EXPECTED);
  });
});
