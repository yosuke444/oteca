import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { CARD_LIST as CARDS, trophyDef } from '../src/data/cards';
import { CardArt } from '../src/ui/card/CardArt';
import { CardDetail } from '../src/ui/card/CardDetail';
import { CardMini } from '../src/ui/card/CardMini';
import { itemArtUrl } from '../src/ui/card/ItemArt';
import { FxSettingsProvider } from '../src/fx/fxSettings';

/** 演出の設定の中で描く（ふせんは演出の速さを読む） */
const html = (el: ReturnType<typeof createElement>) => renderToStaticMarkup(createElement(FxSettingsProvider, { fxSpeed: 0, reduceFx: false, children: el }));

// カードの部品は ことばの設定（セーブ）を読むので、テストでは初期のセーブを渡す
vi.mock('../src/state/SaveContext', async () => {
  const { createDefaultSave } = await import('../src/save/saveData');
  const save = createDefaultSave(false);
  return { useSave: () => ({ save }) };
});

/** 画像の幅と高さ（PNG はファイルの頭の IHDR、WebP は VP8 ・VP8L・VP8X の かたまりから） */
function pngSize(path: string): [number, number] {
  const b = readFileSync(path);
  if (b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') {
    const kind = b.toString('ascii', 12, 16);
    if (kind === 'VP8 ') return [b.readUInt16LE(26) & 0x3fff, b.readUInt16LE(28) & 0x3fff];
    if (kind === 'VP8L') {
      const v = b.readUInt32LE(21);
      return [(v & 0x3fff) + 1, ((v >> 14) & 0x3fff) + 1];
    }
    if (kind === 'VP8X') return [b.readUIntLE(24, 3) + 1, b.readUIntLE(27, 3) + 1];
    throw new Error(`${path}：WebP の形が わからない`);
  }
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
    for (const f of files('public/story').filter((f) => f.endsWith('.webp'))) expect([f, ...pngSize(f)]).toEqual([f, 800, 800]);
    for (const f of files('public/packs').filter((f) => f.endsWith('.webp'))) expect([f, ...pngSize(f)]).toEqual([f, 600, 900]);
    for (const n of ['coin', 'present', 'present_open', 'daily']) {
      const f = `public/images/${n}.webp`;
      if (existsSync(f)) expect([f, ...pngSize(f)]).toEqual([f, 256, 256]);
    }
  });

  it('v2.4：絵は WebP だけ（public に PNG を置かない）。cards.json の絵も .webp', () => {
    const pngs = ['cards', 'story', 'packs', 'images'].flatMap((d) => files(`public/${d}`)).filter((f) => /.png$/i.test(f));
    expect(pngs).toEqual([]);
    for (const c of CARDS) if (c.image) expect(c.image, c.id).toMatch(/.webp$/);
    for (const f of ['cards', 'story', 'packs', 'images'].flatMap((d) => files(`public/${d}`)).filter((f) => !f.endsWith('.gitkeep'))) {
      const b = readFileSync(f);
      expect([f, b.toString('ascii', 0, 4), b.toString('ascii', 8, 12)]).toEqual([f, 'RIFF', 'WEBP']);
    }
  });

  it('1枚 300KB 以下', () => {
    const big = files('public')
      .filter((f) => /\.(png|jpe?g|webp)$/i.test(f) && statSync(f).size > 300 * 1024)
      .map((f) => `${f} ${Math.round(statSync(f).size / 1024)}KB`);
    expect(big).toEqual([]);
  });

  it('トロフィあげの絵（v2.7）：public/cards/trophy.webp（800×600）を読み込む。番号を重ねる', () => {
    const found = files('public').filter((f) => /trophy|トロフィ/i.test(f));
    expect(found.map((f) => f.split('\\').join('/'))).toEqual(['public/cards/trophy.webp']);
    expect(pngSize(found[0])).toEqual([800, 600]);
    const html = renderToStaticMarkup(createElement(CardArt, { def: trophyDef(3), seed: 't' }));
    expect(html).toContain('data-src="/cards/trophy.webp"');
    expect(html).toContain('data-testid="trophy-no"');
    // ふつうのカードは絵を読み込む（v2.4：読み込み係で読み終わるまでは、絵の場所を空けて待つ）
    expect(renderToStaticMarkup(createElement(CardArt, { def: CARDS[0], seed: 't' }))).toContain(`data-src="/${CARDS[0].image}"`);
  });

  it('アイテムのふせんに絵（v2.3）：絵が置いてあるアイテムは ふせんの中に絵。絵が無いアイテムは今までの ふせん のまま', () => {
    const items = CARDS.filter((c) => c.kind === 'item');
    expect(items.map((c) => c.id).sort()).toEqual(['hikikae', 'himitsu_yaiba', 'kimyou_drink', 'kusuri', 'supodori', 'yabaitsubo']);
    for (const c of items) {
      expect(existsSync(join('public', c.image))).toBe(true);
      expect(itemArtUrl(c)).toContain(c.image);
      for (const h of [
        html(createElement(CardMini, { def: c, seed: 't', variant: 'tile' })),
        html(createElement(CardMini, { def: c, seed: 't', variant: 'slot' })),
        html(createElement(CardDetail, { def: c, seed: 't' })),
      ]) {
        expect(h).toContain('has-art');
        expect(h).toContain(c.image);
        // ふせんの形と色はそのまま
        expect(h).toContain(`sticky--${c.color ?? 'yellow'}`);
      }
    }
    // 絵の無いアイテム：絵を出さない（無い絵を読みに行かない）
    const noArt = { ...items[0], image: 'cards/no_such_item.webp' };
    expect(itemArtUrl(noArt)).toBeNull();
    const plain = html(createElement(CardMini, { def: noArt, seed: 't', variant: 'tile' }));
    expect(plain).not.toContain('has-art');
    expect(plain).not.toContain('<img');
    // おてあげは今までどおり（ふせんの絵は付けない）
    expect(itemArtUrl(CARDS[0])).toBeNull();
  });
});
