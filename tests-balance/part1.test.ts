import { it } from 'vitest';
import { OTEGE, baseDecks, calc, writeRaw } from './lib';

/** 1. 計算で出す強さ（全おてあげ） */
it('1. 計算で出す強さ', () => {
  writeRaw('part1', OTEGE.map(calc));
  // 3 の基準のデッキ（まとめに載せる）
  writeRaw('decks', baseDecks());
});
