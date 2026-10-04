import { NG_WORDS } from '../config/ngwords';

/**
 * ほかの人の名前の禁止語（UPDATE_v2 §8-4・§10）。ゲームと Worker（worker/）の両方で使う。
 */

/** ひらがな・小文字・空白なしにそろえる（禁止語を比べるため） */
function fold(s: string): string {
  return s
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60))
    .replace(/[\s・ー\-_.]/g, '');
}

/** ほかの人の名前を出す時：禁止語がふくまれていたら nameless（「ななし」。言語ごとの文字は呼ぶ側が渡す） */
export function safeName(name: string, nameless: string): string {
  const f = fold(name);
  return NG_WORDS.some((w) => f.includes(fold(w))) ? nameless : name;
}
