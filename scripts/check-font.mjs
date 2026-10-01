// フォント Yomogi で、日本語（漢字）の辞書とカードの効果文に出てくる字が欠けないか確かめる（UPDATE_v2 §2-2）
// Google Fonts の CSS（文字の範囲 unicode-range ごとに分かれている）を取り寄せ、使っている字がどこかの範囲に入っているかを見る。
// 使い方：node scripts/check-font.mjs（インターネットにつながっている時）
import { readFileSync } from 'node:fs';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const css = await (await fetch('https://fonts.googleapis.com/css2?family=Yomogi&display=swap', { headers: { 'User-Agent': UA } })).text();
const ranges = [];
for (const m of css.matchAll(/unicode-range:\s*([^;]+);/g)) {
  for (const part of m[1].split(',')) {
    const r = part.trim().replace(/^U\+/i, '');
    const [a, b] = r.includes('-') ? r.split('-') : [r, r];
    ranges.push([parseInt(a, 16), parseInt(b ?? a, 16)]);
  }
}
if (ranges.length === 0) throw new Error('Yomogi の文字の範囲が取れなかった');

const text = [readFileSync('src/i18n/ja-kanji.ts', 'utf8'), readFileSync('src/i18n/ja-hira.ts', 'utf8'), readFileSync('src/data/cards.json', 'utf8')].join('\n');
const used = new Set([...text].filter((c) => /[　-ヿ㐀-鿿＀-￯]/.test(c)));
const covered = (c) => {
  const cp = c.codePointAt(0);
  return ranges.some(([a, b]) => cp >= a && cp <= b);
};
const missing = [...used].filter((c) => !covered(c));
console.log(`Yomogi の範囲 ${ranges.length} 個。使っている字 ${used.size} 字（漢字 ${[...used].filter((c) => /[一-鿿]/.test(c)).length} 字）`);
console.log(missing.length ? `欠ける字：${missing.join(' ')}` : '欠ける字は ありません');
process.exitCode = missing.length ? 1 : 0;
