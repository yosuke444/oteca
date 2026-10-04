import { describe, expect, it } from 'vitest';
import { encodeSave } from '../src/save/binary';
import { decodeSave } from '../src/save/migrate';
import { createDefaultSave, normalizeSave } from '../src/save/saveData';
import { decodeTransferCode, encodeTransferBytes } from '../src/save/transferCode';
import { formatUserId, hexToUserId, isUserId, newUserId, normalizeUserId, parseUserIdInput, userIdToHex } from '../src/save/userId';
import { makeRandom } from './save.helpers';

/** ユーザーID（v2.0-J。SPEC §11-9・§12-3f・テスト J01） */
describe('J01 ユーザーID', () => {
  it('15桁の数字で、先頭は0以外。乱数の端でも範囲に入る', () => {
    const r = makeRandom(5);
    const seen = new Set<string>();
    for (let i = 0; i < 2000; i++) {
      const id = newUserId((n) => new Uint8Array(n).map(() => r.int(0, 255)));
      expect(id).toMatch(/^[1-9][0-9]{14}$/);
      seen.add(id);
    }
    // ほぼ重ならない
    expect(seen.size).toBeGreaterThan(1990);
    expect(newUserId((n) => new Uint8Array(n))).toBe('100000000000000');
    expect(newUserId((n) => new Uint8Array(n).fill(255))).toMatch(/^[1-9][0-9]{14}$/);
    expect(isUserId(newUserId())).toBe(true);
  });

  it('表示は5桁ずつ区切る。入力は区切り・空白・全角の数字を許す', () => {
    expect(formatUserId('123456789012345')).toBe('12345-67890-12345');
    expect(parseUserIdInput('12345-67890-12345')).toBe('123456789012345');
    expect(parseUserIdInput(' １２３４５ ６７８９０ １２３４５ ')).toBe('123456789012345');
    expect(parseUserIdInput('012345678901234')).toBe('');
    expect(parseUserIdInput('1234')).toBe('');
    expect(normalizeUserId('abc')).toBe('');
  });

  it('バイト列の8バイトの場所に入れても同じ ID に戻る。範囲外はエラー', () => {
    for (const id of ['100000000000000', '999999999999999', '123456789012345']) expect(hexToUserId(userIdToHex(id))).toBe(id);
    expect(userIdToHex('')).toBe('');
    expect(hexToUserId('')).toBe('');
    expect(() => hexToUserId('ffffffffffffffff')).toThrow('ユーザーID');
    expect(() => hexToUserId('0000000000000001')).toThrow('ユーザーID');
  });

  it('新しいセーブは、起動するまでユーザーID が無い（起動の時に1回だけ作る）。読み直しても変わらない', () => {
    const d = createDefaultSave();
    expect(d.userId).toBe('');
    expect(d.userIdRegistered).toBe(false);
    const withId = { ...d, userId: '555556666677777', userIdRegistered: true };
    const back = decodeSave(encodeSave(withId));
    expect(back.userId).toBe('555556666677777');
    expect(back.userIdRegistered).toBe(true);
    // 形の変な ID は消す（次の起動で作り直す）。登録の印も外す
    expect(normalizeSave({ ...d, userId: '12', userIdRegistered: true })).toMatchObject({ userId: '', userIdRegistered: false });
  });

  it('token（サーバーの合言葉）は16バイトの16進数', async () => {
    const { newToken } = await import('../src/save/userId');
    expect(newToken()).toMatch(/^[0-9a-f]{32}$/);
    expect(newToken()).not.toBe(newToken());
  });

  it('引き継ぎコードにもユーザーID が入る（同じ人が別の端末で続けると、同じユーザーID）', async () => {
    const d = { ...createDefaultSave(), userId: '314159265358979', userIdRegistered: true };
    const got = await decodeTransferCode(encodeTransferBytes(encodeSave(d), 12));
    expect(got.ok && got.data.userId).toBe('314159265358979');
    expect(got.ok && got.data.userIdRegistered).toBe(true);
  });
});
