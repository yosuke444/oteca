import { webcrypto } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { sha256, sha256Fallback, toHex } from '../src/net/sha256';
import { makeRandom } from './save.helpers';

const enc = (s: string) => new TextEncoder().encode(s);

describe('予備の SHA-256', () => {
  it('よく知られた値と一致する', () => {
    expect(toHex(sha256Fallback(enc('')))).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(toHex(sha256Fallback(enc('abc')))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(toHex(sha256Fallback(enc('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq')))).toBe(
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
    );
  });

  it('crypto.subtle と同じ結果になる（長さ 0〜300 バイトのランダムなデータ 300件）', async () => {
    const r = makeRandom(42);
    for (let i = 0; i < 300; i++) {
      const data = new Uint8Array(i).map(() => r.int(0, 255));
      const expected = new Uint8Array(await webcrypto.subtle.digest('SHA-256', data));
      expect(toHex(sha256Fallback(data))).toBe(toHex(expected));
    }
  });

  it('sha256() は crypto.subtle が無い環境でも同じ値を返す', async () => {
    const data = enc('oteca-room-123456');
    const withSubtle = toHex(await sha256(data));
    const saved = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
    Object.defineProperty(globalThis, 'crypto', { value: { getRandomValues: webcrypto.getRandomValues.bind(webcrypto) }, configurable: true });
    try {
      expect(toHex(await sha256(data))).toBe(withSubtle);
    } finally {
      if (saved) Object.defineProperty(globalThis, 'crypto', saved);
    }
  });
});
