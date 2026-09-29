import { encodeSave } from './binary';
import { crc16Text } from './crc16';
import { decodeSave } from './migrate';
import type { SaveData } from './saveData';
import { decryptDigits, encryptDigits } from './vigenere';

/**
 * データ引き継ぎの数字コード（SPEC §12-4）
 * 1. SaveData → バイト列  2. 先頭に 0x01 を付けて10進数の数字列 P に
 * 3. ソルト s（2桁）  4〜5. 数字版ヴィジュネル暗号  6. チェック値 = CRC16(P) mod 10000
 * 7. s + 暗号 + チェック値 を4桁ずつハイフンで区切る
 */

const SALT_DIGITS = 2;
const CHECK_DIGITS = 4;

export type DecodeResult = { ok: true; data: SaveData } | { ok: false; reason: 'format' | 'check' | 'data' };

/** コードを作る。salt を省略するとランダム（同じデータでも毎回違うコードになる） */
export function encodeTransferCode(data: SaveData, salt = Math.floor(Math.random() * 100)): string {
  const bytes = encodeSave(data);
  const plain = bytesToDecimal(bytes);
  const cipher = encryptDigits(plain, salt);
  const check = String(crc16Text(plain) % 10000).padStart(CHECK_DIGITS, '0');
  const digits = String(salt).padStart(SALT_DIGITS, '0') + cipher + check;
  return groupDigits(digits);
}

/** コードを読む。ハイフン・空白など数字以外は無視する */
export function decodeTransferCode(code: string): DecodeResult {
  const digits = code.replace(/[^0-9]/g, '');
  if (digits.length < SALT_DIGITS + 1 + CHECK_DIGITS) return { ok: false, reason: 'format' };
  const salt = Number(digits.slice(0, SALT_DIGITS));
  const cipher = digits.slice(SALT_DIGITS, -CHECK_DIGITS);
  const check = Number(digits.slice(-CHECK_DIGITS));
  const plain = decryptDigits(cipher, salt);
  if (crc16Text(plain) % 10000 !== check) return { ok: false, reason: 'check' };
  try {
    return { ok: true, data: decodeSave(decimalToBytes(plain)) };
  } catch {
    return { ok: false, reason: 'data' };
  }
}

/** 4桁ずつハイフンで区切る */
export function groupDigits(digits: string): string {
  return digits.match(/.{1,4}/g)?.join('-') ?? '';
}

/** 0x01 + バイト列 → 10進数の数字列（先頭の0が消えないように 0x01 を付ける） */
function bytesToDecimal(bytes: Uint8Array): string {
  let hex = '01';
  for (const b of bytes) hex += b.toString(16).padStart(2, '0');
  return BigInt(`0x${hex}`).toString(10);
}

/** 10進数の数字列 → バイト列（先頭の 0x01 を確かめて外す） */
function decimalToBytes(plain: string): Uint8Array {
  if (!/^[1-9][0-9]*$/.test(plain)) throw new Error('数字列が不正です');
  let hex = BigInt(plain).toString(16);
  if (hex.length % 2 === 1) hex = `0${hex}`;
  if (!hex.startsWith('01')) throw new Error('先頭の目印がありません');
  const out = new Uint8Array(hex.length / 2 - 1);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(2 + i * 2, 4 + i * 2), 16);
  return out;
}
