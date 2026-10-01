import { describe, expect, it } from 'vitest';
// @ts-expect-error 型定義の無い .mjs（調べ方を scripts/find-jp.mjs と共通にする）
import { findJapanese, listFiles, stripComments } from '../scripts/find-jp.mjs';
import { CARD_LIST } from '../src/data/cards';
import { DICTS, LANGS, local, setLang, t } from '../src/i18n';

/** ことば（UPDATE_v2 §2・SPEC §6-4b・§16-2b） */

/** 辞書を「キーの道すじ → 値」に平らにする */
function flatten(obj: unknown, path = ''): Map<string, unknown> {
  const out = new Map<string, unknown>();
  if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
    for (const [k, v] of Object.entries(obj)) for (const [p, x] of flatten(v, path ? `${path}.${k}` : k)) out.set(p, x);
  } else out.set(path, obj);
  return out;
}

/** 関数の文言を、それらしい値で呼んでみる（引数の数だけ 7 / 'あ' / true を渡す） */
function sample(v: unknown): string[] {
  if (typeof v === 'string') return [v];
  if (Array.isArray(v)) return v.flatMap(sample);
  if (typeof v === 'function') {
    const outs: string[] = [];
    for (const arg of [7, 'テスト', true, false, 0, 1, 2]) {
      const args = Array.from({ length: v.length }, () => arg);
      const r = (v as (...a: unknown[]) => unknown)(...args);
      outs.push(...sample(r));
    }
    return outs;
  }
  return [];
}

describe('I01 画面のコードに日本語の直書きが無い', () => {
  it('src/scenes・src/ui・src/fx・App・src/battle・src/state・soundMap（コメントは除く）', () => {
    const files = listFiles();
    expect(files.length).toBeGreaterThan(40);
    const hits = findJapanese(files) as { file: string; line: number; text: string }[];
    expect(hits.map((h) => `${h.file}:${h.line} ${h.text}`)).toEqual([]);
  });

  it('調べ方の確認：コメントは除き、文字列・テンプレート・JSX の文字は見つける', () => {
    const src = [
      '// コメント',
      '/* ブロック',
      '   コメント */',
      "const a = 'ひらがな';",
      'const b = `x ${y} カタカナ`;',
      'const c = <p>漢字</p>;',
      "const d = '// ではない ' + `/* でもない */`;",
    ].join('\n');
    const lines = stripComments(src).split('\n');
    const jp = /[぀-ヿ一-鿿]/;
    expect(lines.map((l: string) => jp.test(l))).toEqual([false, false, false, true, true, true, true]);
  });
});

describe('I02 にほんご・日本語の辞書が同じキーを持つ', () => {
  const hira = flatten(DICTS.hira);
  const kanji = flatten(DICTS.kanji);

  it('キーが同じ（片方にしかないキーが無い）', () => {
    expect([...kanji.keys()].sort()).toEqual([...hira.keys()].sort());
    expect(hira.size).toBeGreaterThan(300);
  });

  it('同じキーは同じ種類（文字・関数・配列）。関数は引数の数も同じ', () => {
    for (const [k, v] of hira) {
      const w = kanji.get(k);
      expect(typeof w, k).toBe(typeof v);
      expect(Array.isArray(w), k).toBe(Array.isArray(v));
      if (Array.isArray(v)) expect((w as unknown[]).length, k).toBe(v.length);
      if (typeof v === 'function') expect((w as () => unknown).length, k).toBe(v.length);
    }
  });

  it('どの文言も空でない（関数は呼んだ結果も）', () => {
    for (const lang of LANGS) {
      for (const [k, v] of flatten(DICTS[lang])) {
        for (const s of sample(v)) expect(s.trim().length, `${lang} ${k}`).toBeGreaterThan(0);
      }
    }
  });

  it('日本語の辞書は漢字を使い、にほんごの辞書とは違う文になっている（ある程度）', () => {
    let differ = 0;
    let withKanji = 0;
    for (const [k, v] of hira) {
      const a = sample(v).join('|');
      const b = sample(kanji.get(k)).join('|');
      if (a !== b) differ += 1;
      if (/[一-鿿]/.test(b)) withKanji += 1;
    }
    expect(differ).toBeGreaterThan(hira.size * 0.6);
    expect(withKanji).toBeGreaterThan(hira.size * 0.5);
  });

  it('setLang で t() が切りかわる', () => {
    setLang('kanji');
    expect(t()).toBe(DICTS.kanji);
    setLang('hira');
    expect(t()).toBe(DICTS.hira);
  });
});

describe('I03 カードの効果文が両方の言語にあり、名前は1つ', () => {
  it('アイテムの text・afterUseNote', () => {
    for (const c of CARD_LIST) {
      expect(typeof c.name).toBe('string');
      if (c.kind !== 'item') continue;
      expect(local(c.text, 'hira').length, c.id).toBeGreaterThan(0);
      expect(local(c.text, 'kanji').length, c.id).toBeGreaterThan(0);
      expect(local(c.text, 'kanji'), c.id).not.toBe(local(c.text, 'hira'));
      if (c.afterUseNote) {
        expect(local(c.afterUseNote, 'hira').length).toBeGreaterThan(0);
        expect(local(c.afterUseNote, 'kanji').length).toBeGreaterThan(0);
      }
    }
  });
});
