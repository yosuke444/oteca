import { describe, expect, it } from 'vitest';
import { starterDeckNos } from '../src/data/starterDeck';
import { createDefaultSave } from '../src/save/saveData';
import { decodeTransferCode, encodeTransferCode } from '../src/save/transferCode';
import { randomSave } from './save.helpers';

/** i 桁目（ハイフンを除いた数字の位置）の数字を変える */
function changeDigit(code: string, index: number, delta: number): string {
  let n = -1;
  return code.replace(/[0-9]/g, (d) => {
    n += 1;
    return n === index ? String((Number(d) + delta) % 10) : d;
  });
}

describe('引き継ぎコード', () => {
  it('V01 SaveData → 数字コード → SaveData で完全に元に戻る（ランダムなデータで1000回）', () => {
    for (let i = 0; i < 1000; i++) {
      const data = randomSave(i);
      const code = encodeTransferCode(data, i % 100);
      expect(code).toMatch(/^[0-9]{1,4}(-[0-9]{1,4})*$/);
      const back = decodeTransferCode(code);
      expect(back, `seed ${i}`).toEqual({ ok: true, data });
    }
  });

  it('V01 同じデータでもソルトで毎回違うコードになる', () => {
    const data = createDefaultSave(starterDeckNos());
    const a = encodeTransferCode(data, 12);
    const b = encodeTransferCode(data, 57);
    expect(a).not.toBe(b);
    expect(decodeTransferCode(a)).toEqual(decodeTransferCode(b));
  });

  it('V01 コードの長さ：初期データは短く、全部埋めても SPEC の目安に収まる', () => {
    const digits = (code: string) => code.replace(/-/g, '').length;
    const full = createDefaultSave(starterDeckNos());
    full.decks = full.decks.map(() => ({ name: 'あいうえおかきく', cards: starterDeckNos() }));
    expect(digits(encodeTransferCode(createDefaultSave(starterDeckNos())))).toBeLessThan(150);
    expect(digits(encodeTransferCode(full))).toBeLessThan(620);
  });

  it('V02 コードの数字を1つ変えると復元に失敗する', () => {
    for (let s = 0; s < 40; s++) {
      const code = encodeTransferCode(randomSave(5000 + s), s);
      const len = code.replace(/-/g, '').length;
      // 数字の場所すべてについて、別の数字に変えてみる（最初の3件は 1〜9 の全部のずらし方）
      const deltas = s < 3 ? [1, 2, 3, 4, 5, 6, 7, 8, 9] : [1 + (s % 9)];
      for (let i = 0; i < len; i++) {
        for (const d of deltas) {
          const r = decodeTransferCode(changeDigit(code, i, d));
          expect(r.ok, `seed ${s} 位置 ${i} +${d}`).toBe(false);
        }
      }
    }
  });

  it('V02 桁が足りない・数字が無いコードも失敗する', () => {
    const code = encodeTransferCode(createDefaultSave(starterDeckNos()), 3);
    expect(decodeTransferCode(code.slice(0, -1)).ok).toBe(false);
    expect(decodeTransferCode(code.slice(1)).ok).toBe(false);
    expect(decodeTransferCode('').ok).toBe(false);
    expect(decodeTransferCode('abc').ok).toBe(false);
  });

  it('V03 ハイフン・空白入りのコードも読める', () => {
    const data = randomSave(77);
    const code = encodeTransferCode(data, 42);
    const digits = code.replace(/-/g, '');
    const variants = [
      digits,
      code.replace(/-/g, ' '),
      ` ${code}\n`,
      code.replace(/-/g, ' - '),
      digits.replace(/(.{3})/g, '$1　'), // 全角空白
      digits.replace(/(.{5})/g, '$1\n'),
    ];
    for (const v of variants) expect(decodeTransferCode(v)).toEqual({ ok: true, data });
  });
});
