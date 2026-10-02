import { describe, expect, it } from 'vitest';
import { decodeTransferCode, encodeTransferCode } from '../src/save/transferCode';
import { randomSave } from './save.helpers';

/** 重いテスト（npm run test:slow）：引き継ぎコードの数字を1か所ずつ全部変えてみる（約10万通り） */

/** i 桁目の数字を変える（d はハイフンを除いた数字だけのコード。ハイフン入りでも読めることは V03 で確かめる） */
function changeDigit(d: string, index: number, delta: number): string {
  return d.slice(0, index) + String((d.charCodeAt(index) - 48 + delta) % 10) + d.slice(index + 1);
}


describe('引き継ぎコード（重い）', () => {
  it('V02 コードの数字を1つ変えると復元に失敗する', async () => {
    // 読めてしまった変え方（あってはいけない）。expect を10万回呼ぶと遅いので、まとめて1回で確かめる
    const accepted: string[] = [];
    let tried = 0;
    for (let s = 0; s < 40; s++) {
      const code = (await encodeTransferCode(randomSave(5000 + s), { salt: s })).replace(/-/g, '');
      const len = code.length;
      // 数字の場所すべてについて、別の数字に変えてみる（最初の3件は 1〜9 の全部のずらし方）
      const deltas = s < 3 ? [1, 2, 3, 4, 5, 6, 7, 8, 9] : [1 + (s % 9)];
      for (let i = 0; i < len; i++) {
        for (const d of deltas) {
          const r = await decodeTransferCode(changeDigit(code, i, d));
          tried += 1;
          if (r.ok) accepted.push(`seed ${s} 位置 ${i} +${d}`);
        }
      }
    }
    expect(tried).toBeGreaterThan(40 * 300);
    expect(accepted).toEqual([]);
  }, 180000); // コードが長くなった（デッキ20個）ので、調べる数も多い（約10万通り）
});
