// カード・ボス・パック・アイコンの絵を、表示用に作り直す（元の画像は変えない）。v2.4 から WebP で書き出す（軽くして絵が出るまでのラグを減らす）
// 元の画像は公開しない（assets-original/ は git にも入れない。.gitignore）
//   assets-original/cards/*.png   → public/cards/<id>.webp      おてあげ 800×600・アイテム 512×512
//   assets-original/story/*.png   → public/story/boss_<id>.webp  800×800
//   assets-original/packs/*.png   → public/packs/pack_<id>.webp  600×900
//   assets-original/images/*.png  → public/images/<名前>.webp    コイン・プレゼント・デイリー 256×256。おてあげの絵は余白を切り取るだけ
// 元の画像のファイル名は日本語でもよい：カードは cards.json の名前（「おてさげ.png」）、ボスは story.json のボスの名前（「おてあげドラゴン.png」）、
//   パックは packs.json の名前（「元祖パック.png」「元祖.png」）、アイコンは コイン・プレゼント・あいたはこ・デイリー・おてあげ
// やること（v2.3）：
//   1. 端に写りこんだ線（スクリーンショットの枠・色つきの線など）を切り落とす
//   2. 白に近い色を白にそろえる（乗算で表示した時に、うすい四角が見えないように）
//   3. 余白を切り取る
//   4. 縦横の比率を変えずに、決まった大きさの中に収める（まわりに少しだけ余白。余った所は白。引き伸ばし・ゆがみなし）
//   5. WebP（画質 0.92。白い背景は白のまま＝乗算でなじむ）で書き出す。300KB を超える時だけ画質を少しずつ下げる
// トロフィあげ（trophy*.png）は まだ仮の絵のまま：作らない（元の画像は art_hold/ に置いておく）
// ファイル名がカードの id でない時（「おてさげ.png」など）は、cards.json の名前から id に直す。
// 使い方：node scripts/prepare-art.mjs
import { chromium } from '@playwright/test';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, extname, join } from 'node:path';

/** 置く大きさ（幅・高さ・まわりの余白） */
const BOX = {
  otege: [800, 600, 18],
  item: [512, 512, 16],
  boss: [800, 800, 24],
  pack: [600, 900, 18],
  icon: [256, 256, 8],
};
const IMAGE_PAD = 4;
/** WebP の画質（0〜1）。見た目が荒れない値 */
const QUALITY = 0.92;
const ICONS = new Set(['coin', 'present', 'present_open', 'daily']);
const MAX_BYTES = 300 * 1024;

const cards = JSON.parse(readFileSync('src/data/cards.json', 'utf8')).cards;
const bosses = JSON.parse(readFileSync('src/data/story.json', 'utf8')).stages.filter((s) => s.kind === 'boss' && s.boss);
const packs = JSON.parse(readFileSync('src/data/packs.json', 'utf8')).packs;
/** アイコンの日本語の名前 → ファイル名 */
const ICON_NAMES = { コイン: 'coin', プレゼント: 'present', あいたはこ: 'present_open', 空いた箱: 'present_open', デイリー: 'daily', おてあげ: 'otege_up' };
const stemOf = (file) => basename(file, extname(file)).normalize('NFC');
/** ボスの元の画像の名前（boss_dragon・dragon・おてあげドラゴン）→ boss_<id>（わからなければ null） */
function bossFileOf(file) {
  const stem = stemOf(file);
  const b = bosses.find((s) => stem === `boss_${s.boss}` || stem === s.boss || stem === s.name.normalize('NFC'));
  return b ? `boss_${b.boss}` : null;
}
/** パックの元の画像の名前（pack_ganso・ganso・元祖パック・元祖）→ pack_<id>（わからなければ null） */
function packFileOf(file) {
  const stem = stemOf(file);
  const p = packs.find((x) => stem === `pack_${x.id}` || stem === x.id || stem === x.name.normalize('NFC') || stem === x.short.normalize('NFC'));
  return p ? `pack_${p.id}` : null;
}
/** アイコン・おてあげの絵の名前（coin・コイン など）→ ファイル名 */
function imageFileOf(file) {
  const stem = stemOf(file);
  return ICON_NAMES[stem] ?? stem;
}
const webp = (name) => `${name}.webp`;
const byId = new Map(cards.map((c) => [c.id, c]));
const byName = new Map(cards.map((c) => [c.name.normalize('NFC'), c]));

/** 元のファイル名 → カードの id（わからなければ null） */
function cardIdOf(file) {
  const stem = basename(file, extname(file)).normalize('NFC');
  if (byId.has(stem)) return stem;
  return byName.get(stem)?.id ?? null;
}

const browser = await chromium.launch();
const page = await browser.newPage();

/** ブラウザの canvas で作り直して WebP のバイト列を返す */
async function rework(path, mode) {
  const url = 'data:image/png;base64,' + readFileSync(path).toString('base64');
  const res = await page.evaluate(
    async ({ url, box, IMAGE_PAD, MAX_BYTES, QUALITY }) => {
      const img = new Image();
      img.src = url;
      await img.decode();
      const W = img.naturalWidth;
      const H = img.naturalHeight;
      const c = document.createElement('canvas');
      c.width = W;
      c.height = H;
      const g = c.getContext('2d');
      g.fillStyle = '#fff'; // 透明な所は白い紙として扱う
      g.fillRect(0, 0, W, H);
      g.drawImage(img, 0, 0);
      const data = g.getImageData(0, 0, W, H);
      const d = data.data;
      const at = (x, y) => (y * W + x) * 4;
      const ink = (i) => 765 - (d[i] + d[i + 1] + d[i + 2]) > 60;
      const colored = (i) => Math.max(d[i], d[i + 1], d[i + 2]) - Math.min(d[i], d[i + 1], d[i + 2]) > 30;
      /** 一様な濃さの線（スクリーンショットの灰色の帯・枠の線）。絵の線は濃さがばらつくので当たらない */
      const flat = (px) => {
        // 両はしの1割は見ない（となりの辺の帯と重なる角を除く）
        const v = px.slice(Math.floor(px.length * 0.1), Math.ceil(px.length * 0.9)).map((i) => Math.min(d[i], d[i + 1], d[i + 2]));
        const m = v.reduce((a, b) => a + b, 0) / v.length;
        const sd = Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / v.length);
        return m < 245 && sd <= 12;
      };

      // 1. 端の線を切り落とす：線の半分以上が色つきの線は外側から4本まで、一様な濃さの線（灰色の帯など）は40本まで
      const cut = { top: 0, bottom: 0, left: 0, right: 0 };
      const line = {
        top: (k) => Array.from({ length: W }, (_, x) => at(x, k)),
        bottom: (k) => Array.from({ length: W }, (_, x) => at(x, H - 1 - k)),
        left: (k) => Array.from({ length: H }, (_, y) => at(k, y)),
        right: (k) => Array.from({ length: H }, (_, y) => at(W - 1 - k, y)),
      };
      for (const side of Object.keys(cut)) {
        for (let k = 0; k < 40; k++) {
          const px = line[side](k);
          const isColored = k < 4 && px.filter(colored).length / px.length >= 0.5;
          if (isColored || flat(px)) {
            cut[side] = k + 1;
            continue;
          }
          // 枠の外側の白いすき間（数px）は飛ばして、その内側の枠の線も見る
          const blank = px.filter((i) => Math.min(d[i], d[i + 1], d[i + 2]) < 245).length / px.length < 0.1;
          if (blank && k < 8) continue;
          break;
        }
      }
      const x0c = cut.left;
      const y0c = cut.top;
      const x1c = W - 1 - cut.right;
      const y1c = H - 1 - cut.bottom;

      // 2. 白に近い色を白に
      for (let i = 0; i < d.length; i += 4) {
        if (Math.min(d[i], d[i + 1], d[i + 2]) >= 245) d[i] = d[i + 1] = d[i + 2] = 255;
      }
      // 写りこんだ小さなごみを消す：SPECK 個以下の点で、まわり ALONE px 以内にほかの線が無いもの。
      // （濁点など、字や絵のすぐそばの短い線は残す。まわり 2px までつながっていれば1つの線とみなす）
      const SPECK = 12;
      const ALONE = 12;
      const specks = [];
      const label = new Int32Array(W * H).fill(-1);
      const groups = [];
      for (let y = y0c; y <= y1c; y++) {
        for (let x = x0c; x <= x1c; x++) {
          if (label[y * W + x] >= 0 || !ink(at(x, y))) continue;
          const n = groups.length;
          const group = [];
          const stack = [[x, y]];
          label[y * W + x] = n;
          while (stack.length) {
            const [px, py] = stack.pop();
            group.push([px, py]);
            for (let oy = -2; oy <= 2; oy++) {
              for (let ox = -2; ox <= 2; ox++) {
                const nx = px + ox;
                const ny = py + oy;
                if (nx < x0c || nx > x1c || ny < y0c || ny > y1c || label[ny * W + nx] >= 0 || !ink(at(nx, ny))) continue;
                label[ny * W + nx] = n;
                stack.push([nx, ny]);
              }
            }
          }
          groups.push(group);
        }
      }
      groups.forEach((group, n) => {
        if (group.length > SPECK) return;
        const near = group.some(([px, py]) => {
          for (let ny = Math.max(y0c, py - ALONE); ny <= Math.min(y1c, py + ALONE); ny++) {
            for (let nx = Math.max(x0c, px - ALONE); nx <= Math.min(x1c, px + ALONE); nx++) {
              const l = label[ny * W + nx];
              if (l >= 0 && l !== n) return true;
            }
          }
          return false;
        });
        if (near) return;
        for (const [px, py] of group) d.fill(255, at(px, py), at(px, py) + 3);
        specks.push(`${group[0][0]},${group[0][1]}(${group.length}px)`);
      });
      g.putImageData(data, 0, 0);

      // 3. 余白を切り取る（絵の入っている範囲）
      let x0 = W, y0 = H, x1 = -1, y1 = -1;
      for (let y = y0c; y <= y1c; y++) {
        for (let x = x0c; x <= x1c; x++) {
          if (!ink(at(x, y))) continue;
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
        }
      }
      if (x1 < 0) return { error: '絵が見つからない' };
      const w = x1 - x0 + 1;
      const h = y1 - y0 + 1;

      // 4. 置き直す
      const out = document.createElement('canvas');
      let dx, dy, dw, dh;
      if (box) {
        const [BW, BH, PAD] = box;
        out.width = BW;
        out.height = BH;
        const s = Math.min((BW - PAD * 2) / w, (BH - PAD * 2) / h);
        dw = w * s;
        dh = h * s;
        dx = (BW - dw) / 2;
        dy = (BH - dh) / 2;
      } else {
        out.width = w + IMAGE_PAD * 2;
        out.height = h + IMAGE_PAD * 2;
        [dx, dy, dw, dh] = [IMAGE_PAD, IMAGE_PAD, w, h];
      }
      const o = out.getContext('2d');
      o.fillStyle = '#fff';
      o.fillRect(0, 0, out.width, out.height);
      o.imageSmoothingEnabled = true;
      o.imageSmoothingQuality = 'high';
      o.drawImage(c, x0, y0, w, h, dx, dy, dw, dh);
      // 5. WebP で書き出す。大きすぎる時だけ、画質を少しずつ下げて MAX_BYTES 以下にする
      let quality = QUALITY;
      let data64 = out.toDataURL('image/webp', quality).split(',')[1];
      while (data64.length * 0.75 > MAX_BYTES && quality > 0.7) {
        quality = Math.round((quality - 0.05) * 100) / 100;
        data64 = out.toDataURL('image/webp', quality).split(',')[1];
      }
      return {
        png: data64,
        info: { from: `${W}×${H}`, cut, specks, bbox: [x0, y0, w, h], to: `${out.width}×${out.height}`, scale: +(dw / w).toFixed(2), quality },
      };
    },
    { url, box: mode === 'image' ? null : BOX[mode], IMAGE_PAD, MAX_BYTES, QUALITY },
  );
  if (res.error) throw new Error(`${path}: ${res.error}`);
  return { bytes: Buffer.from(res.png, 'base64'), info: res.info };
}

const problems = [];
const jobs = [];
for (const f of readdirSync('assets-original/cards').filter((f) => /\.png$/i.test(f))) {
  const id = cardIdOf(f);
  if (!id) {
    problems.push(`assets-original/cards/${f}：どのカードか わからない（cards.json の id か名前にしてください）`);
    continue;
  }
  const card = byId.get(id);
  jobs.push({ src: join('assets-original/cards', f), dst: join('public', card.image), mode: card.kind === 'item' ? 'item' : 'otege' });
}
const pngs = (dir) => (existsSync(dir) ? readdirSync(dir).filter((f) => /\.png$/i.test(f)) : []);
for (const f of pngs('assets-original/story')) {
  const name = bossFileOf(f);
  if (!name) problems.push(`assets-original/story/${f}：どのボスか わからない（boss_<id> か、ボスの名前にしてください）`);
  else jobs.push({ src: join('assets-original/story', f), dst: join('public/story', webp(name)), mode: 'boss' });
}
for (const f of pngs('assets-original/packs')) {
  const name = packFileOf(f);
  if (!name) problems.push(`assets-original/packs/${f}：どのパックか わからない（pack_<id> か、パックの名前にしてください）`);
  else jobs.push({ src: join('assets-original/packs', f), dst: join('public/packs', webp(name)), mode: 'pack' });
}
for (const f of pngs('assets-original/images')) {
  const stem = imageFileOf(f);
  if (/^trophy/i.test(stem)) continue; // トロフィあげは まだ仮の絵のまま
  jobs.push({ src: join('assets-original/images', f), dst: join('public/images', webp(stem)), mode: ICONS.has(stem) ? 'icon' : 'image' });
}

for (const j of jobs) {
  const { bytes, info } = await rework(j.src, j.mode);
  mkdirSync(join(j.dst, '..'), { recursive: true });
  writeFileSync(j.dst, bytes);
  const kb = (statSync(j.dst).size / 1024).toFixed(1);
  const cutText = Object.entries(info.cut).filter(([, v]) => v).map(([k, v]) => `${k}${v}px`).join(' ');
  console.log(`${j.src} → ${j.dst}  ${info.from} → ${info.to}  絵の範囲 ${info.bbox.join(',')}  ×${info.scale}  ${kb}KB  画質 ${info.quality}${cutText ? '  端の線を切り落とし：' + cutText : ''}${info.specks.length ? '  消した点：' + info.specks.join(' ') : ''}`);
  // 同じ名前の古い PNG が public に残っていたら消す（ゲームは WebP を読む）
  const oldPng = j.dst.replace(/\.webp$/, '.png');
  if (existsSync(oldPng)) unlinkSync(oldPng);
  if (bytes.length > MAX_BYTES) problems.push(`${j.dst} が ${kb}KB（300KB を超えた）`);
}
const missing = cards.filter((c) => c.image && !jobs.some((j) => j.dst.replace(/\\/g, '/') === `public/${c.image}`));
for (const c of missing) problems.push(`No ${c.no} ${c.name}（${c.image}）の元の画像が無い`);
await browser.close();
console.log(problems.length ? '\n' + problems.join('\n') : '\nすべて OK');
