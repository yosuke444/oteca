import { ByteWriter, type SaveDataV3 } from '../src/save/binary';
import { defaultDeckName } from '../src/save/saveData';
import { encodeTransferBytes } from '../src/save/transferCode';
import { sealBytes } from '../src/save/cookieStore';

/**
 * 古い形式（形式版数1〜3。v2.0-A まで）の書き方を、テストのために残したもの。
 * 当時の encodeSave と同じ並び（SPEC §12-3 の「形式版数1〜3」）。
 * 固定の16進（save.migrate.test.ts の V1〜V3_FIXTURE_HEX）と同じバイト列になることもテストで確かめる。
 */
export function encodeOldSave(data: SaveDataV3, version: 1 | 2 | 3): Uint8Array {
  const w = new ByteWriter();
  w.byte(version);
  w.uint(data.saveVersion);
  w.uint(data.saveCounter);
  w.text(data.playerName);
  const s = data.settings;
  w.byte((s.bgm << 4) | s.se);
  w.byte((s.fxSpeed << 2) | (s.reduceFx ? 2 : 0) | (s.hints ? 1 : 0));
  w.uint(data.selectedDeck);
  data.decks.forEach((deck, i) => {
    w.text(deck.name === defaultDeckName(i) ? '' : deck.name);
    w.uint(deck.cards.length);
    for (const no of deck.cards) w.uint(no);
  });
  w.uint(data.stats.wins);
  w.uint(data.stats.losses);
  w.uint(data.coins);
  w.byte(data.unlockAll ? 1 : 0);
  w.uint(data.collection.length);
  for (const c of data.collection) {
    w.uint(c.no);
    w.uint(c.qty);
  }
  w.uint(data.story.cleared.length);
  for (const n of data.story.cleared) w.uint(n);
  if (version >= 2) {
    for (let i = 0; i < 4; i++) {
      w.uint(data.cpuStats[i]?.wins ?? 0);
      w.uint(data.cpuStats[i]?.losses ?? 0);
    }
  }
  if (version >= 3) w.byte(data.settings.lang === 'kanji' ? 1 : 0);
  return w.toBytes();
}

/** 古い形式の引き継ぎコード（v2.0-A までは圧縮なし。目印 0x01） */
export function oldTransferCode(data: SaveDataV3, version: 1 | 2 | 3, salt: number): string {
  return encodeTransferBytes(encodeOldSave(data, version), salt);
}

/** 古い形式の Cookie の中身（暗号文） */
export function oldCookie(data: SaveDataV3, version: 1 | 2 | 3): string {
  return sealBytes(encodeOldSave(data, version));
}

export const toHex = (bytes: Uint8Array) => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
export const hexToBytes = (hex: string) => new Uint8Array(hex.match(/../g)!.map((h) => parseInt(h, 16)));
