import { ByteReader, FORMAT_VERSION, readSaveV1 } from './binary';
import type { SaveData } from './saveData';

/**
 * 形式版数を見て、古い形式なら最新の SaveData へ変換する（SPEC §12-3）
 *
 * 形式を変える時の手順（CLAUDE.md 守ること7）：
 *  1. binary.ts の FORMAT_VERSION を上げ、encodeSave の末尾に項目を足す
 *  2. 新しい形式の読み方（readSaveV2 など）を READERS に足す
 *  3. 1つ前の形式から変換する関数を UPGRADES に足す
 *  4. テスト V05 に、古い形式のバイト列を読めることの確認を足す
 */

/** 形式版数ごとの読み方。読んだ結果は「その版の形」 */
const READERS: Record<number, (r: ByteReader) => unknown> = {
  1: readSaveV1,
};

/** 版 n の形 → 版 n+1 の形 への変換。今は形式版数1しか無いので空 */
const UPGRADES: Record<number, (old: unknown) => unknown> = {};

/** バイト列 → 最新の SaveData。読めなければエラー */
export function decodeSave(bytes: Uint8Array): SaveData {
  const r = new ByteReader(bytes);
  const version = r.byte();
  const read = READERS[version];
  if (!read) throw new Error(`形式版数 ${version} は読めません`);
  let data = read(r);
  if (!r.done) throw new Error('データの後ろに余分なバイトがあります');
  data = migrate(version, data);
  return data as SaveData;
}

/** 版 from の形のデータを、最新の形まで順に変換する */
export function migrate(from: number, data: unknown): unknown {
  let v = from;
  let d = data;
  while (v < FORMAT_VERSION) {
    const up = UPGRADES[v];
    if (!up) throw new Error(`形式版数 ${v} からの変換がありません`);
    d = up(d);
    v += 1;
  }
  return d;
}
