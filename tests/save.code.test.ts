import { describe, expect, it } from 'vitest';
import { encodeSave } from '../src/save/binary';
import { deflateRaw, inflateRaw, streamAvailable } from '../src/save/compress';
import { createDefaultSave } from '../src/save/saveData';
import { decodeTransferCode, encodeTransferBytes, encodeTransferCode } from '../src/save/transferCode';
import { decryptDigits } from '../src/save/vigenere';
import { codeLengthPatterns, randomSave } from './save.helpers';


const digits = (code: string) => code.replace(/-/g, '').length;

/** コードの目印（復号した数字列の先頭バイト。0x01＝圧縮なし／0x02＝圧縮） */
function markOf(code: string): number {
  const d = code.replace(/[^0-9]/g, '');
  const plain = decryptDigits(d.slice(2, -4), Number(d.slice(0, 2)));
  const hex = BigInt(plain).toString(16);
  return parseInt(hex.length % 2 ? `0${hex.slice(0, 1)}` : hex.slice(0, 2), 16);
}

describe('引き継ぎコード', () => {
  it('V01 SaveData → 数字コード → SaveData で完全に元に戻る（ランダムなデータで1000回）', async () => {
    for (let i = 0; i < 1000; i++) {
      const data = randomSave(i);
      const code = await encodeTransferCode(data, { salt: i % 100 });
      expect(code).toMatch(/^[0-9]{1,4}(-[0-9]{1,4})*$/);
      const back = await decodeTransferCode(code);
      expect(back, `seed ${i}`).toEqual({ ok: true, data });
    }
  });

  it('V01 使わない値 hints（v1.3 でヒント削除）も、true・false のまま読み書きされる（前に作ったコードが読める）', async () => {
    for (const hints of [true, false]) {
      const data = createDefaultSave();
      data.settings.hints = hints;
      expect(await decodeTransferCode(await encodeTransferCode(data, { salt: 7 }))).toEqual({ ok: true, data });
    }
  });

  it('V01 同じデータでもソルトで毎回違うコードになる', async () => {
    const data = createDefaultSave();
    const a = await encodeTransferCode(data, { salt: 12 });
    const b = await encodeTransferCode(data, { salt: 57 });
    expect(a).not.toBe(b);
    expect(await decodeTransferCode(a)).toEqual(await decodeTransferCode(b));
  });

  it('V02 桁が足りない・数字が無いコードも失敗する', async () => {
    const code = await encodeTransferCode(createDefaultSave(), { salt: 3 });
    expect((await decodeTransferCode(code.slice(0, -1))).ok).toBe(false);
    expect((await decodeTransferCode(code.slice(1))).ok).toBe(false);
    expect((await decodeTransferCode('')).ok).toBe(false);
    expect((await decodeTransferCode('abc')).ok).toBe(false);
  });

  it('V03 ハイフン・空白入りのコードも読める', async () => {
    const data = randomSave(77);
    const code = await encodeTransferCode(data, { salt: 42 });
    const d = code.replace(/-/g, '');
    const variants = [
      d,
      code.replace(/-/g, ' '),
      ` ${code}\n`,
      code.replace(/-/g, ' - '),
      d.replace(/(.{3})/g, '$1　'), // 全角空白
      d.replace(/(.{5})/g, '$1\n'),
    ];
    for (const v of variants) expect(await decodeTransferCode(v)).toEqual({ ok: true, data });
  });
});

describe('V11 引き継ぎコードの圧縮（deflate-raw）', () => {
  it('このテストの環境では CompressionStream（deflate-raw）が使える', () => {
    expect(streamAvailable()).toBe(true);
  });

  it('CompressionStream と予備の fflate のどちらで作ったコードも、どちらでも読める', async () => {
    for (let i = 0; i < 60; i++) {
      const data = randomSave(9000 + i);
      const byStream = await encodeTransferCode(data, { salt: i, engine: 'stream' });
      const byFflate = await encodeTransferCode(data, { salt: i, engine: 'fflate' });
      for (const code of [byStream, byFflate]) {
        expect(await decodeTransferCode(code, { engine: 'stream' }), `seed ${i}`).toEqual({ ok: true, data });
        expect(await decodeTransferCode(code, { engine: 'fflate' }), `seed ${i}`).toEqual({ ok: true, data });
      }
    }
  });

  it('圧縮と元に戻すのは、どちらの組み合わせでも同じバイト列になる', async () => {
    const bytes = encodeSave(randomSave(3));
    for (const a of ['stream', 'fflate'] as const) {
      for (const b of ['stream', 'fflate'] as const) expect(await inflateRaw(await deflateRaw(bytes, a), b)).toEqual(bytes);
    }
  });

  it('デッキが入っていれば圧縮したコード（目印 0x02）になり、圧縮しない時より短い', async () => {
    const data = randomSave(11);
    const code = await encodeTransferCode(data, { salt: 5 });
    expect(markOf(code)).toBe(2);
    expect(digits(code)).toBeLessThan(digits(encodeTransferBytes(encodeSave(data), 5)));
  });

  it('古い（圧縮なし。目印 0x01）の形のコードも読める', async () => {
    for (let i = 0; i < 30; i++) {
      const data = randomSave(7000 + i);
      const raw = encodeTransferBytes(encodeSave(data), i);
      expect(markOf(raw)).toBe(1);
      expect(await decodeTransferCode(raw)).toEqual({ ok: true, data });
    }
  });

  it('圧縮した中身が壊れていたら「データが違う」として失敗する（チェック値は合っていても）', async () => {
    const broken = encodeTransferBytes(new Uint8Array([0xff, 0xff, 0xff, 0x00, 0x12]), 9, 2);
    expect(await decodeTransferCode(broken)).toEqual({ ok: false, reason: 'data' });
  });
});

describe('V13 引き継ぎコードの桁数（UPDATE_v2 §3-4 の3パターン）', () => {
  it('初期状態／全48種を各10枚・20スロットすべて15枚／それに8文字のデッキ名', async () => {
    const patterns = codeLengthPatterns('0123456789abcdef');
    const lines: string[] = [];
    const packedAll: number[] = [];
    for (const [label, data] of patterns) {
      const packed = digits(await encodeTransferCode(data, { salt: 0 }));
      const plain = digits(encodeTransferBytes(encodeSave(data), 0));
      lines.push(`${label}: ${packed}けた（あっしゅく なしなら ${plain}けた）`);
      expect(await decodeTransferCode(await encodeTransferCode(data, { salt: 1 }))).toEqual({ ok: true, data });
      expect(packed).toBeLessThanOrEqual(plain);
      packedAll.push(packed);
    }
    console.log(`[V13] ${lines.join(' / ')}`);
    // 今の長さ（約240・790・1520桁）から大きく伸びていないこと（形式を変えて長くなったら気づけるように）
    expect(packedAll[0]).toBeLessThan(300);
    expect(packedAll[1]).toBeLessThan(900);
    expect(packedAll[2]).toBeLessThan(1700);
  });
});
