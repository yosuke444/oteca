// カードの絵が出るまでのラグを測る（v2.4）。回線を遅くした状態（Fast 3G 相当）で、公開用のビルドを開いて測る。
// 使い方：npm run build → npx vite preview --port 4173 --strictPort（別の窓で）→ node scripts/measure-art.mjs [回数]
// 測るもの：
//  1. 起動してタイトル（「タップして はじめる」）が出るまでの時間
//  2. パックガチャで、カードをめくってから（表が見え始めてから）絵が出るまでの時間（3まいガチャの3枚 × 回数）
//  3. 全画像（dist の cards・story・packs・images）の合計の大きさ
import { chromium } from '@playwright/test';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const URL = process.env.OTECA_PREVIEW ?? 'http://localhost:4173/oteca/';
const RUNS = Number(process.argv[2] ?? 3);
/** Chrome の DevTools の「Fast 3G」（下り 1.44Mbps・上り 675kbps・往復 562.5ms） */
const FAST_3G = { offline: false, latency: 562.5, downloadThroughput: (1.44 * 1024 * 1024) / 8, uploadThroughput: (675 * 1024) / 8 };

function imageBytes() {
  let total = 0;
  let count = 0;
  for (const d of ['cards', 'story', 'packs', 'images']) {
    const dir = join('dist', d);
    for (const f of readdirSync(dir)) {
      if (!/\.(png|webp|jpe?g)$/i.test(f)) continue;
      total += statSync(join(dir, f)).size;
      count += 1;
    }
  }
  return { total, count };
}

const median = (a) => {
  const s = [...a].sort((x, y) => x - y);
  return s.length ? s[Math.floor(s.length / 2)] : NaN;
};

const browser = await chromium.launch();
const titleMs = [];
const lags = [];
for (let run = 0; run < RUNS; run++) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  await cdp.send('Network.emulateNetworkConditions', FAST_3G);
  page.setDefaultTimeout(120000);
  await page.goto(URL, { waitUntil: 'commit' });
  const t = await page.waitForFunction(() => {
    const el = document.querySelector('.title-scene__tap');
    return el && el.getBoundingClientRect().height > 0 ? performance.now() : null;
  }, null, { polling: 'raf', timeout: 120000 });
  titleMs.push(await t.jsonValue());
  // タイトル → ことば → なまえ → チュートリアルを とばす → メニュー
  await page.mouse.click(640, 360);
  const lang = page.getByRole('button', { name: /にほんご/ });
  const name = page.getByTestId('name-ok');
  await lang.or(name).first().waitFor();
  if (await lang.isVisible().catch(() => false)) await lang.click();
  await name.click();
  await page.getByTestId('tutorial-skip').click();
  await page.getByRole('button', { name: /^(とばす|飛ばす)$/ }).click();
  await page.getByTestId('menu-gacha').click();
  // 「パックを ひこう」の案内が出たら閉じる
  await page.getByTestId('gacha-buy-three').waitFor();
  await page.waitForTimeout(500);
  await page.getByTestId('gacha-buy-three').click();
  const ok = page.getByRole('button', { name: /ひく|引く/ }).last();
  if (await ok.isVisible({ timeout: 1500 }).catch(() => false)) await ok.click();
  await page.getByTestId('gacha-opening').waitFor();
  for (let i = 0; i < 3; i++) {
    const bag = page.getByTestId(`gacha-bag-${i}`);
    await bag.waitFor();
    // めくり始め（表が見え始めた）と、絵が出た時を、画面の中で測る
    await page.evaluate(() => {
      const w = window;
      w.__lag = { flip: 0, img: 0 };
      const tick = () => {
        const front = document.querySelector('.gacha-reveal__front');
        if (front) {
          const m = new DOMMatrixReadOnly(getComputedStyle(front).transform);
          if (!w.__lag.flip && Math.abs(m.a) > 0.05) w.__lag.flip = performance.now();
          const img = front.querySelector('img');
          if (!w.__lag.img && img && img.complete && img.naturalWidth > 0 && img.getBoundingClientRect().width > 0) w.__lag.img = performance.now();
        }
        if (!w.__lag.flip || !w.__lag.img) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    await bag.click({ force: true });
    const r = await page.waitForFunction(() => (window.__lag.flip && window.__lag.img ? window.__lag : null), null, { polling: 100, timeout: 60000 }).catch(() => null);
    const v = r ? await r.jsonValue() : null;
    if (v) lags.push(Math.max(0, v.img - v.flip));
    const next = page.getByTestId('gacha-next');
    await next.waitFor({ timeout: 60000 }).catch(async (e) => {
      await page.screenshot({ path: `screenshots/measure_art_stuck_${run}_${i}.png` });
      throw e;
    });
    if (i < 2) await next.dispatchEvent('click');
  }
  await ctx.close();
}
await browser.close();
const img = imageBytes();
console.log(JSON.stringify({ runs: RUNS, titleMs: titleMs.map(Math.round), titleMedian: Math.round(median(titleMs)), lagsMs: lags.map(Math.round), lagMedian: Math.round(median(lags)), lagMax: Math.round(Math.max(...lags)), images: img }, null, 1));
