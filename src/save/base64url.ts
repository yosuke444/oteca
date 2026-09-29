import { ALPHABET64 } from './vigenere';

/** バイト列 → base64url（= なし） */
export function toBase64Url(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    const chars = Math.min(4, Math.ceil(((bytes.length - i) * 8) / 6));
    for (let j = 0; j < chars; j++) out += ALPHABET64[(n >> (18 - 6 * j)) & 63];
  }
  return out;
}

/** base64url → バイト列。表に無い文字があればエラー */
export function fromBase64Url(text: string): Uint8Array {
  const out: number[] = [];
  let buf = 0;
  let bits = 0;
  for (const c of text) {
    const v = ALPHABET64.indexOf(c);
    if (v < 0) throw new Error('base64url として読めません');
    buf = ((buf << 6) | v) & 0x3fff; // 使い終わった上の桁は捨てる
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((buf >> bits) & 0xff);
    }
  }
  return new Uint8Array(out);
}
