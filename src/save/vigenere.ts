/**
 * ヴィジュネル暗号（SPEC §12-1）
 * 鍵の文字を1つずつずらしながら、元の文字を鍵の分だけずらす。
 * 鍵はプログラムの中にあるので、本気で調べれば解読できる。目的は「見ても意味がわからない」こと。
 */

/** 固定の鍵文字列（64文字の表に含まれる文字だけで書く） */
const KEY_TEXT = 'Oteca-Otege_Card-Battle-Note-v1';

// ---------------------------------------------------------------- 数字版（引き継ぎコード用）

/** 鍵文字列を数字列にしたもの（各文字の文字コードをつなげる） */
export const KEY_DIGITS: string = [...KEY_TEXT].map((c) => c.charCodeAt(0)).join('');

/** C[i] = (P[i] + K[(i + salt) mod 鍵の長さ]) mod 10 */
export function encryptDigits(plain: string, salt: number): string {
  let out = '';
  for (let i = 0; i < plain.length; i++) {
    const k = KEY_DIGITS.charCodeAt((i + salt) % KEY_DIGITS.length) - 48;
    out += String((plain.charCodeAt(i) - 48 + k) % 10);
  }
  return out;
}

export function decryptDigits(cipher: string, salt: number): string {
  let out = '';
  for (let i = 0; i < cipher.length; i++) {
    const k = KEY_DIGITS.charCodeAt((i + salt) % KEY_DIGITS.length) - 48;
    out += String((cipher.charCodeAt(i) - 48 - k + 10) % 10);
  }
  return out;
}

// ---------------------------------------------------------------- 64文字版（Cookie用）

/** base64url と同じ64文字の表 */
export const ALPHABET64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

const INDEX64 = new Map([...ALPHABET64].map((c, i) => [c, i]));
const KEY64 = [...KEY_TEXT].map((c) => INDEX64.get(c)!);

export function encrypt64(plain: string): string {
  return shift64(plain, 1);
}

export function decrypt64(cipher: string): string {
  return shift64(cipher, -1);
}

function shift64(text: string, dir: 1 | -1): string {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const p = INDEX64.get(text[i]);
    if (p === undefined) throw new Error('64文字の表に無い文字があります');
    out += ALPHABET64[(p + dir * KEY64[i % KEY64.length] + 64) % 64];
  }
  return out;
}
