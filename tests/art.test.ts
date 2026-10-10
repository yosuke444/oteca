import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CARD_LIST as CARDS, trophyDef } from '../src/data/cards';
import { CardArt } from '../src/ui/card/CardArt';

/** PNG の幅と高さ（ファイルの頭の IHDR から） */
function pngSize(path: string): [number, number] {
  const b = readFileSync(path);
  return [b.readUInt32BE(16), b.readUInt32BE(20)];
}

const files = (dir: string): string[] =>
  existsSync(dir) ? readdirSync(dir, { recursive: true, encoding: 'utf8' }).map((f) => join(dir, f).replace(/\\/g, '/')) : [];

describe('画像（v2.3）', () => {
  it('public/ の画像の名前は英数字だけ（日本語の名前のまま置かれていない）', () => {
    const bad = files('public').filter((f) => /\.(png|jpe?g|webp)$/i.test(f) && /[^\x20-\x7e]/.test(f));
    expect(bad).toEqual([]);
  });

  it('カードの絵：おてあげ 800×600、アイテム 512×512', () => {
    for (const c of CARDS) {
      const p = join('public', c.image);
      if (!existsSync(p)) continue; // まだ届いていない絵（仮の絵で動く）
      expect([c.id, ...pngSize(p)]).toEqual([c.id, ...(c.kind === 'item' ? [512, 512] : [800, 600])]);
    }
  });

  it('ボスの絵 800×800、パック 600×900、コイン・プレゼント・デイリー 256×256', () => {
    for (const f of files('public/story').filter((f) => f.endsWith('.png'))) expect([f, ...pngSize(f)]).toEqual([f, 800, 800]);
    for (const f of files('public/packs').filter((f) => f.endsWith('.png'))) expect([f, ...pngSize(f)]).toEqual([f, 600, 900]);
    for (const n of ['coin', 'present', 'present_open', 'daily']) {
      const f = `public/images/${n}.png`;
      if (existsSync(f)) expect([f, ...pngSize(f)]).toEqual([f, 256, 256]);
    }
  });

  it('1枚 300KB 以下', () => {
    const big = files('public')
      .filter((f) => /\.(png|jpe?g|webp)$/i.test(f) && statSync(f).size > 300 * 1024)
      .map((f) => `${f} ${Math.round(statSync(f).size / 1024)}KB`);
    expect(big).toEqual([]);
  });

  it('トロフィあげは仮の絵のまま：絵が置いてあっても読み込まない（public/ に置かない）', () => {
    expect(files('public').filter((f) => /trophy/i.test(f))).toEqual([]);
    const html = renderToStaticMarkup(createElement(CardArt, { def: trophyDef(3), seed: 't' }));
    expect(html).not.toContain('<img');
    expect(html).toContain('trophy-doodle');
    // ふつうのカードは絵を読み込む
    expect(renderToStaticMarkup(createElement(CardArt, { def: CARDS[0], seed: 't' }))).toContain('<img');
  });
});
