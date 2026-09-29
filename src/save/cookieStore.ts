import { fromBase64Url, toBase64Url } from './base64url';
import { encodeSave } from './binary';
import { crc16Text } from './crc16';
import { decodeSave } from './migrate';
import type { SaveData } from './saveData';
import { decrypt64, encrypt64 } from './vigenere';

/**
 * Cookie への保存（SPEC §12-5）と localStorage の控え（§12-1）
 * バイト列 → base64url → 64文字版ヴィジュネル暗号 → 3500文字ごとに分割して保存。
 */

export const COOKIE_PREFIX = 'oteca_s';
export const COOKIE_META = 'oteca_meta';
export const LOCAL_KEY = 'oteca_save';
export const CHUNK_SIZE = 3500;
/** 400日 */
export const MAX_AGE = 34560000;

/** document.cookie と同じ読み書きができるもの（テストでは偽物を渡す） */
export type CookieJar = { get(): string; set(cookie: string): void };

export type KeyValueStore = { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void };

export function browserCookieJar(): CookieJar {
  return {
    get: () => document.cookie,
    set: (c) => {
      document.cookie = c;
    },
  };
}

// ---------------------------------------------------------------- 暗号化した文字列

/** SaveData → Cookie に入れる暗号文 */
export function sealSave(data: SaveData): string {
  return encrypt64(toBase64Url(encodeSave(data)));
}

/** 暗号文 → SaveData（読めなければエラー） */
export function openSave(sealed: string): SaveData {
  return decodeSave(fromBase64Url(decrypt64(sealed)));
}

// ---------------------------------------------------------------- Cookie

export function parseCookies(text: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const part of text.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    map.set(part.slice(0, i).trim(), part.slice(i + 1).trim());
  }
  return map;
}

function cookieAttrs(maxAge: number, secure: boolean): string {
  return `; path=/; max-age=${maxAge}; SameSite=Lax${secure ? '; Secure' : ''}`;
}

/** 分割して書く。前回より分割数が減った時は、余った Cookie を消す */
export function writeCookies(jar: CookieJar, sealed: string, secure: boolean, chunkSize = CHUNK_SIZE): void {
  const chunks: string[] = [];
  for (let i = 0; i < sealed.length; i += chunkSize) chunks.push(sealed.slice(i, i + chunkSize));
  const old = parseCookies(jar.get());
  chunks.forEach((c, i) => jar.set(`${COOKIE_PREFIX}${i}=${c}${cookieAttrs(MAX_AGE, secure)}`));
  for (let i = chunks.length; old.has(`${COOKIE_PREFIX}${i}`); i++) {
    jar.set(`${COOKIE_PREFIX}${i}=${cookieAttrs(0, secure)}`);
  }
  // 分割数とチェック値（暗号文全体の CRC16）
  const meta = `${chunks.length}.${crc16Text(sealed).toString(16)}`;
  jar.set(`${COOKIE_META}=${meta}${cookieAttrs(MAX_AGE, secure)}`);
}

/** 分割された Cookie を結合する。欠けやチェック値の不一致があれば null */
export function readCookies(jar: CookieJar): string | null {
  const map = parseCookies(jar.get());
  const meta = map.get(COOKIE_META);
  if (!meta) return null;
  const [countText, check] = meta.split('.');
  const count = Number(countText);
  if (!Number.isInteger(count) || count < 1 || count > 100) return null;
  let sealed = '';
  for (let i = 0; i < count; i++) {
    const part = map.get(`${COOKIE_PREFIX}${i}`);
    if (part === undefined) return null;
    sealed += part;
  }
  return crc16Text(sealed).toString(16) === check ? sealed : null;
}

export function clearCookies(jar: CookieJar, secure: boolean): void {
  const map = parseCookies(jar.get());
  for (const name of map.keys()) {
    if (name === COOKIE_META || name.startsWith(COOKIE_PREFIX)) jar.set(`${name}=${cookieAttrs(0, secure)}`);
  }
}

// ---------------------------------------------------------------- まとめて保存・読み込み

export type SaveStorage = { jar: CookieJar; local: KeyValueStore | null; secure: boolean };

/** Cookie（主）と localStorage（控え）の両方に保存する */
export function persist(storage: SaveStorage, data: SaveData): void {
  const sealed = sealSave(data);
  writeCookies(storage.jar, sealed, storage.secure);
  try {
    storage.local?.setItem(LOCAL_KEY, `${crc16Text(sealed).toString(16)}.${sealed}`);
  } catch {
    // localStorage が使えない環境（容量・プライベートモード）は控えなしで続ける
  }
}

/** 両方から読み、保存回数カウンタが新しい方を返す。どちらも読めなければ null */
export function load(storage: SaveStorage): SaveData | null {
  const candidates: SaveData[] = [];
  const fromCookie = readCookies(storage.jar);
  const c = fromCookie !== null ? tryOpen(fromCookie) : null;
  if (c) candidates.push(c);

  let localText: string | null = null;
  try {
    localText = storage.local?.getItem(LOCAL_KEY) ?? null;
  } catch {
    localText = null;
  }
  if (localText) {
    const i = localText.indexOf('.');
    const sealed = localText.slice(i + 1);
    if (i > 0 && crc16Text(sealed).toString(16) === localText.slice(0, i)) {
      const l = tryOpen(sealed);
      if (l) candidates.push(l);
    }
  }
  if (candidates.length === 0) return null;
  return candidates.reduce((a, b) => (b.saveCounter > a.saveCounter ? b : a));
}

export function wipe(storage: SaveStorage): void {
  clearCookies(storage.jar, storage.secure);
  try {
    storage.local?.removeItem(LOCAL_KEY);
  } catch {
    // 何もしない
  }
}

function tryOpen(sealed: string): SaveData | null {
  try {
    return openSave(sealed);
  } catch {
    return null;
  }
}
