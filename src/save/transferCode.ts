import { encodeSave } from './binary';
import { type CompressEngine, deflateRaw, inflateRaw } from './compress';
import { crc16Text } from './crc16';
import { decodeSave } from './migrate';
import type { SaveData } from './saveData';
import { decryptDigits, encryptDigits } from './vigenere';

/**
 * データ引き継ぎの数字コード（SPEC §12-4）
 * 1. SaveData → バイト列  1b. deflate-raw で圧縮（v2.0-B。短くならない時はしない）
 * 2. 先頭に目印（圧縮 0x02／圧縮なし 0x01）を付けて10進数の数字列 P に
 * 3. ソルト s（2桁）  4〜5. 数字版ヴィジュネル暗号  6. チェック値 = CRC16(P) mod 10000
 * 7. s + 暗号 + チェック値 を4桁ずつハイフンで区切る
 * v2.0-A までのコード（目印 0x01）もそのまま読める。
 */

const SALT_DIGITS = 2;
const CHECK_DIGITS = 4;
/** 目印：圧縮なし（v2.0-A までのコードはすべてこれ） */
const MARK_RAW = 0x01;
/** 目印：deflate-raw で圧縮 */
const MARK_DEFLATE = 0x02;

export type DecodeResult = { ok: true; data: SaveData } | { ok: false; reason: 'format' | 'check' | 'data' };

export type CodeOptions = {
  /** ソルト（省略するとランダム。同じデータでも毎回違うコードになる） */
  salt?: number;
  /** 圧縮に使うもの（テスト用。省略すると CompressionStream、使えなければ fflate） */
  engine?: CompressEngine;
};

/** コードを作る */
export async function encodeTransferCode(data: SaveData, opts: CodeOptions = {}): Promise<string> {
  const raw = encodeSave(data);
  const packed = await deflateRaw(raw, opts.engine);
  const salt = opts.salt ?? Math.floor(Math.random() * 100);
  return packed.length < raw.length ? encodeTransferBytes(packed, salt, MARK_DEFLATE) : encodeTransferBytes(raw, salt, MARK_RAW);
}

/**
 * バイト列 → コード（テストで、古い形式のバイト列から当時と同じコードを作るのにも使う）
 * @param mark 目印（0x01＝圧縮なし／0x02＝圧縮）
 */
export function encodeTransferBytes(bytes: Uint8Array, salt: number, mark = MARK_RAW): string {
  const plain = bytesToDecimal(bytes, mark);
  const cipher = encryptDigits(plain, salt);
  const check = String(crc16Text(plain) % 10000).padStart(CHECK_DIGITS, '0');
  const digits = String(salt).padStart(SALT_DIGITS, '0') + cipher + check;
  return groupDigits(digits);
}

/** コードを読む。ハイフン・空白など数字以外は無視する */
export async function decodeTransferCode(code: string, opts: Pick<CodeOptions, 'engine'> = {}): Promise<DecodeResult> {
  const digits = code.replace(/[^0-9]/g, '');
  if (digits.length < SALT_DIGITS + 1 + CHECK_DIGITS) return { ok: false, reason: 'format' };
  const salt = Number(digits.slice(0, SALT_DIGITS));
  const cipher = digits.slice(SALT_DIGITS, -CHECK_DIGITS);
  const check = Number(digits.slice(-CHECK_DIGITS));
  const plain = decryptDigits(cipher, salt);
  if (crc16Text(plain) % 10000 !== check) return { ok: false, reason: 'check' };
  try {
    const { mark, bytes } = decimalToBytes(plain);
    const raw = mark === MARK_DEFLATE ? await inflateRaw(bytes, opts.engine) : bytes;
    return { ok: true, data: decodeSave(raw) };
  } catch {
    return { ok: false, reason: 'data' };
  }
}

/** 4桁ずつハイフンで区切る */
export function groupDigits(digits: string): string {
  return digits.match(/.{1,4}/g)?.join('-') ?? '';
}

/** 目印 + バイト列 → 10進数の数字列（先頭の0が消えないように目印を付ける） */
function bytesToDecimal(bytes: Uint8Array, mark: number): string {
  let hex = mark.toString(16).padStart(2, '0');
  for (const b of bytes) hex += b.toString(16).padStart(2, '0');
  return BigInt(`0x${hex}`).toString(10);
}

/** 10進数の数字列 → 目印とバイト列 */
function decimalToBytes(plain: string): { mark: number; bytes: Uint8Array } {
  if (!/^[1-9][0-9]*$/.test(plain)) throw new Error('数字列が不正です');
  let hex = BigInt(plain).toString(16);
  if (hex.length % 2 === 1) hex = `0${hex}`;
  const mark = parseInt(hex.slice(0, 2), 16);
  if (mark !== MARK_RAW && mark !== MARK_DEFLATE) throw new Error('先頭の目印がありません');
  const out = new Uint8Array(hex.length / 2 - 1);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(2 + i * 2, 4 + i * 2), 16);
  return { mark, bytes: out };
}
