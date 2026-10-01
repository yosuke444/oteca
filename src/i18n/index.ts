import type { LocalText } from '../engine/types';
import { type Dict, hira } from './ja-hira';
import { kanji } from './ja-kanji';

/**
 * ことば（UPDATE_v2 §2・SPEC §6-4b）
 * - hira：にほんご（ひらがな中心。初期値）／ kanji：日本語（漢字）
 * - 画面のコンポーネントは useT()（言語を変えると描き直される）、React の外（演出・対戦ログ）は t() を使う
 */
export type Lang = 'hira' | 'kanji';
export const LANGS: readonly Lang[] = ['hira', 'kanji'];
export const DICTS: Record<Lang, Dict> = { hira, kanji };
export type { Dict };

let current: Lang = 'hira';

/** 今の言語を決める（App が描く前に呼ぶ） */
export function setLang(lang: Lang): void {
  current = LANGS.includes(lang) ? lang : 'hira';
}

export function currentLang(): Lang {
  return current;
}

/** 今の言語の辞書（React の外から使う） */
export function t(): Dict {
  return DICTS[current];
}

export type { LocalText };

/** 2つの言語を持つ文から、今の言語の文を取り出す */
export function local(text: LocalText | undefined, lang: Lang = current): string {
  return text ? text[lang] : '';
}
