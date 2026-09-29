import {
  DECK_NAME_MAX,
  DECK_SLOTS,
  NAME_MAX,
  SAVE_VERSION,
  VOLUME_MAX,
  type SaveData,
  defaultDeckName,
} from './saveData';

/**
 * セーブデータ ⇔ バイト列（SPEC §12-3）
 * 数値は LEB128（小さい数は1バイト、大きい数は2バイト以上になる可変長整数）。
 * 項目を増やす時は末尾に足し、FORMAT_VERSION を上げ、migrate.ts に読み方を足す。
 */

/** 形式版数（バイト列の先頭1バイト） */
export const FORMAT_VERSION = 1;

/** 読み込み時の上限（壊れたデータで固まらないように） */
const LIMITS = { deckCards: 60, collection: 10000, story: 10000, cardNo: 65535 };

const utf8 = new TextEncoder();
const utf8Strict = new TextDecoder('utf-8', { fatal: true });

export class ByteWriter {
  private bytes: number[] = [];

  byte(v: number): void {
    this.bytes.push(v & 0xff);
  }

  /** 符号なし LEB128 */
  uint(v: number): void {
    if (!Number.isSafeInteger(v) || v < 0) throw new Error(`LEB128 で書けない数です: ${v}`);
    let n = v;
    do {
      let b = n % 128;
      n = Math.floor(n / 128);
      if (n > 0) b |= 0x80;
      this.bytes.push(b);
    } while (n > 0);
  }

  /** 長さ + UTF-8 */
  text(s: string): void {
    const b = utf8.encode(s);
    this.uint(b.length);
    for (const x of b) this.bytes.push(x);
  }

  toBytes(): Uint8Array {
    return new Uint8Array(this.bytes);
  }
}

export class ByteReader {
  private pos = 0;
  constructor(private readonly bytes: Uint8Array) {}

  byte(): number {
    if (this.pos >= this.bytes.length) throw new Error('データが途中で終わっています');
    return this.bytes[this.pos++];
  }

  uint(): number {
    let result = 0;
    let mul = 1;
    for (let i = 0; i < 8; i++) {
      const b = this.byte();
      result += (b & 0x7f) * mul;
      if ((b & 0x80) === 0) {
        if (!Number.isSafeInteger(result)) break;
        return result;
      }
      mul *= 128;
    }
    throw new Error('数値が大きすぎます');
  }

  /** 上限つきの数値 */
  uintMax(max: number): number {
    const v = this.uint();
    if (v > max) throw new Error(`値が範囲外です: ${v} > ${max}`);
    return v;
  }

  text(maxChars: number): string {
    const len = this.uintMax(maxChars * 4);
    const out: number[] = [];
    for (let i = 0; i < len; i++) out.push(this.byte());
    const s = utf8Strict.decode(new Uint8Array(out));
    if ([...s].length > maxChars) throw new Error('文字が長すぎます');
    return s;
  }

  get done(): boolean {
    return this.pos === this.bytes.length;
  }
}

/** 最新の形式でバイト列にする */
export function encodeSave(data: SaveData): Uint8Array {
  const w = new ByteWriter();
  w.byte(FORMAT_VERSION);
  w.uint(data.saveVersion);
  w.uint(data.saveCounter);
  w.text(data.playerName);
  const s = data.settings;
  w.byte((s.bgm << 4) | s.se);
  w.byte((s.fxSpeed << 2) | (s.reduceFx ? 2 : 0) | (s.hints ? 1 : 0));
  w.uint(data.selectedDeck);
  data.decks.forEach((deck, i) => {
    // 既定名なら長さ0（コードを短くするため）
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
  return w.toBytes();
}

/** 形式版数1の本体を読む（先頭の形式版数1バイトは読み終わっている前提） */
export function readSaveV1(r: ByteReader): SaveData {
  const saveVersion = r.uint();
  if (saveVersion !== SAVE_VERSION) throw new Error(`saveVersion ${saveVersion} は読めません`);
  const saveCounter = r.uint();
  const playerName = r.text(NAME_MAX);
  const vol = r.byte();
  const flags = r.byte();
  const bgm = vol >> 4;
  const se = vol & 0x0f;
  const fxSpeed = flags >> 2;
  if (bgm > VOLUME_MAX || se > VOLUME_MAX || fxSpeed > 2) throw new Error('設定の値が範囲外です');
  const selectedDeck = r.uintMax(DECK_SLOTS - 1);
  const decks = Array.from({ length: DECK_SLOTS }, (_, i) => {
    const name = r.text(DECK_NAME_MAX) || defaultDeckName(i);
    const count = r.uintMax(LIMITS.deckCards);
    const cards = Array.from({ length: count }, () => r.uintMax(LIMITS.cardNo));
    return { name, cards };
  });
  const wins = r.uint();
  const losses = r.uint();
  const coins = r.uint();
  const unlock = r.byte();
  if (unlock > 1) throw new Error('unlockAll の値が不正です');
  const collection = Array.from({ length: r.uintMax(LIMITS.collection) }, () => ({
    no: r.uintMax(LIMITS.cardNo),
    qty: r.uint(),
  }));
  const cleared = Array.from({ length: r.uintMax(LIMITS.story) }, () => r.uint());
  return {
    saveVersion: SAVE_VERSION,
    saveCounter,
    playerName,
    settings: { bgm, se, fxSpeed: fxSpeed as 0 | 1 | 2, reduceFx: (flags & 2) !== 0, hints: (flags & 1) !== 0 },
    decks,
    selectedDeck,
    stats: { wins, losses },
    coins,
    collection,
    unlockAll: unlock === 1,
    story: { cleared },
  };
}
