// 画面のコードに日本語の直書きが残っていないかを調べる（UPDATE_v2 §2-3）。コメントは除く。
// 使い方：node scripts/find-jp.mjs（見つかった行を出す。テスト tests/i18n.test.ts の I01 と同じ調べ方）
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** 日本語の文字（ひらがな・カタカナ・漢字・全角の記号） */
export const JP = /[　-ヿ㐀-䶿一-鿿＀-￯]/;

/**
 * コメントを空白に置きかえる（文字列・テンプレート文字列の中の // や /* は消さない）。行番号は変えない。
 * 正規表現リテラル（/…/）は見分けない。中に引用符や // を含む正規表現を画面のコードに書くと、調べ方がずれることがある
 */
export function stripComments(src) {
  let out = '';
  let i = 0;
  let quote = null; // ' " `
  const tpl = []; // テンプレートの ${ の深さ
  while (i < src.length) {
    const c = src[i];
    const d = src[i + 1];
    if (quote) {
      if (c === '\\') {
        out += c + (d ?? '');
        i += 2;
        continue;
      }
      if (quote === '`' && c === '$' && d === '{') {
        tpl.push(0);
        quote = null;
        out += '${';
        i += 2;
        continue;
      }
      if (c === quote) quote = null;
      out += c;
      i += 1;
      continue;
    }
    if (c === '/' && d === '/') {
      while (i < src.length && src[i] !== '\n') i += 1;
      continue;
    }
    if (c === '/' && d === '*') {
      i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) {
        out += src[i] === '\n' ? '\n' : ' ';
        i += 1;
      }
      i += 2;
      continue;
    }
    if (tpl.length > 0) {
      if (c === '{') tpl[tpl.length - 1] += 1;
      if (c === '}') {
        if (tpl[tpl.length - 1] === 0) {
          tpl.pop();
          quote = '`';
          out += c;
          i += 1;
          continue;
        }
        tpl[tpl.length - 1] -= 1;
      }
    }
    if (c === '"' || c === "'" || c === '`') quote = c;
    out += c;
    i += 1;
  }
  return out;
}

/** 調べる場所：画面に出る文字を作るコード（scenes・ui・fx・App・音の名前の表） */
export const SCREEN_DIRS = ['src/scenes', 'src/ui', 'src/fx', 'src/App.tsx', 'src/audio/soundMap.ts', 'src/battle', 'src/state', 'src/admin'];

export function listFiles(entries = SCREEN_DIRS) {
  const out = [];
  const walk = (p) => {
    if (statSync(p).isDirectory()) for (const f of readdirSync(p)) walk(join(p, f));
    else if (/\.(ts|tsx)$/.test(p)) out.push(p.replace(/\\/g, '/'));
  };
  for (const e of entries) walk(e);
  return out;
}

/** 日本語の直書きがある行 { file, line, text } */
export function findJapanese(files = listFiles()) {
  const hits = [];
  for (const file of files) {
    const lines = stripComments(readFileSync(file, 'utf8')).split('\n');
    lines.forEach((text, i) => {
      if (JP.test(text)) hits.push({ file, line: i + 1, text: text.trim() });
    });
  }
  return hits;
}

if (process.argv[1]?.endsWith('find-jp.mjs')) {
  const hits = findJapanese(listFiles(process.argv.length > 2 ? process.argv.slice(2) : SCREEN_DIRS));
  const byFile = new Map();
  for (const h of hits) byFile.set(h.file, (byFile.get(h.file) ?? 0) + 1);
  for (const [f, n] of [...byFile].sort((a, b) => b[1] - a[1])) console.log(String(n).padStart(4), f);
  console.log(`合計 ${hits.length} 行`);
}
