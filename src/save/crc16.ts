/** CRC-16/CCITT-FALSE（多項式 0x1021、初期値 0xFFFF）。改ざん・入力ミスの検知用 */
export function crc16(bytes: Uint8Array): number {
  let crc = 0xffff;
  for (const b of bytes) {
    crc ^= b << 8;
    for (let i = 0; i < 8; i++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc;
}

/** 文字列（ASCII想定）の CRC16。ASCII だけなら UTF-8 にせず直接計算する（長いコードを何度も調べるため） */
export function crc16Text(text: string): number {
  if (!/^[\x00-\x7f]*$/.test(text)) return crc16(new TextEncoder().encode(text));
  let crc = 0xffff;
  for (let j = 0; j < text.length; j++) {
    crc ^= text.charCodeAt(j) << 8;
    for (let i = 0; i < 8; i++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc;
}
