import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import cards from '../src/data/cards.json';
import story from '../src/data/story.json';
import tutorial from '../src/data/tutorial.json';
import { PACK_DATA } from '../src/data/packs';

/**
 * ストーリーの限定カードはトレードに出せない（v2.2）。画面の説明に「出せる」と読める文が残っていないか（v2.3）。
 * 辞書（にほんご・日本語）と、画面に出る文の入ったデータ（cards.json・story.json・tutorial.json）の全部の文を見る
 */

/** ソースの文字（'…'・"…"・`…`）を取り出す */
function literals(src: string): string[] {
  const out: string[] = [];
  const re = /'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g;
  for (let m = re.exec(src); m; m = re.exec(src)) out.push(m[1] ?? m[2] ?? m[3] ?? '');
  return out;
}

/** JSON の中の文字を全部 */
function strings(x: unknown): string[] {
  if (typeof x === 'string') return [x];
  if (Array.isArray(x)) return x.flatMap(strings);
  if (x && typeof x === 'object') return Object.values(x).flatMap(strings);
  return [];
}

const limitedNames = PACK_DATA.limited.flatMap((id) => {
  const c = (cards as { cards: { id: string; name: string }[] }).cards.find((x) => x.id === id)!;
  return [c.name, c.name.replace(/^おてあげ/, '')];
});
const TRADE = /トレード|こうかん|交換|取引|とりひき|あげられる|あげれる|わたせる|渡せる|プレゼント/;
const LIMITED = new RegExp(['げんてい', '限定', 'ボス\\s*の\\s*カード', ...limitedNames].join('|'));
/** 「出せない・できない」の意味の言い方（トレードの言葉の あとに続くもの。「パックから でないよ」などは数えない） */
const NOT = /(トレード|こうかん|交換|取引|とりひき)[^。]*?(でき(ない|ません)|[だ出]せ(ない|ません)|とりやめ)/;
/** 限定カードについて「出せる・できる・使える・あげられる」と読める言い方（はっきり まちがい） */
const WRONG = /(げんてい|限定)[^。]*?(トレード|こうかん|交換|取引|ともだち|友達)[^。]*?(だせる|出せる|できる|つかえる|使える|あげられる|わたせる|渡せる)(よ|！|。|$)/;

/** まちがいの文として見つかるか */
const isWrong = (s: string) => WRONG.test(s) || (TRADE.test(s) && LIMITED.test(s) && !NOT.test(s));

const sources: [string, string[]][] = [
  ['ja-hira.ts', literals(readFileSync('src/i18n/ja-hira.ts', 'utf8'))],
  ['ja-kanji.ts', literals(readFileSync('src/i18n/ja-kanji.ts', 'utf8'))],
  ['cards.json', strings(cards)],
  ['story.json', strings(story)],
  ['tutorial.json', strings(tutorial)],
  ['guideData.ts', literals(readFileSync('src/guide/guideData.ts', 'utf8'))],
];

describe('限定カードとトレードの説明（v2.3）', () => {
  it('限定カードとトレード（こうかん）を一緒に書いた文は、すべて「できない」の意味', () => {
    const bad: string[] = [];
    let seen = 0;
    for (const [file, list] of sources) {
      for (const s of list) {
        if (TRADE.test(s) && LIMITED.test(s)) seen++;
        if (isWrong(s)) bad.push(`${file}：${s}`);
      }
    }
    expect(bad).toEqual([]);
    // 確かめた文がある（トレードの きまり・一覧の文・不成立の知らせ・ストーリーの説明・報酬の文。両方の言語）
    expect(seen).toBeGreaterThanOrEqual(8);
  });

  it('見張りの決まりが まちがいの文を見つけられる（確かめ）', () => {
    for (const s of ['げんていカードは パックから でないよ。こうかんにも つかえるよ', 'げんていカードは ともだちに あげられるよ', '限定カードはトレードにも出せるよ', 'ボスの カードは トレードで わたせるよ']) expect(isWrong(s), s).toBe(true);
    for (const s of ['ストーリー げんてい は こうかん できません', 'コインと、げんていカード・トロフィあげは こうかん できないよ', '相手がストーリー限定のカードを出したので、交換をとりやめたよ']) expect(isWrong(s), s).toBe(false);
  });

  it('前に出ていた まちがいの文（「トレードにも だせるよ」）が、どこにも無い', () => {
    for (const [file, list] of sources) for (const s of list) expect(/トレードにも\s*(だせる|出せる)/.test(s), `${file}：${s}`).toBe(false);
  });
});
