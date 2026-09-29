// 4-1 の確認：3人目は「まんいん」／60秒たっても相手が来ないと「ばんごうが あってるか たしかめてね」
import { SIZES, enterRoom, launch, openPage, shot, toMenu } from './pw.mjs';

const q = process.argv[2] ?? '?debug=1';
const room = String(Date.now()).slice(-6);
const started = Date.now();
const log = (...a) => console.log(`[${((Date.now() - started) / 1000).toFixed(1)}s]`, ...a);

// 1人で待つ（60秒のヒントを見る）間に、別の部屋で2人＋3人目
const bW = await launch();
const W = await openPage(bW, SIZES[1], q);
await toMenu(W.page, SIZES[1]);
await enterRoom(W.page, String(Number(room) + 1));

const browsers = [];
const pages = [];
for (const size of [SIZES[0], SIZES[1]]) {
  const b = await launch();
  browsers.push(b);
  const p = await openPage(b, size, q);
  await toMenu(p.page, size);
  await enterRoom(p.page, room);
  pages.push(p);
}
await Promise.all(pages.map((p) => p.page.locator('.battle').waitFor({ timeout: 45000 })));
log('2人の対戦が始まった');

// 3人目（1280 と 844 の2回）
for (const size of SIZES) {
  const b = await launch();
  const C = await openPage(b, size, q);
  await toMenu(C.page, size);
  await enterRoom(C.page, room);
  await C.page.getByText('このへやは まんいんだよ').waitFor({ timeout: 30000 });
  await shot(C.page, `4_${size.name}_C_full`);
  log(size.name, '3人目：まんいん');
  await b.close();
}
// 2人の対戦は続いている
for (const p of pages) if (!(await p.page.locator('.battle').count())) throw new Error('対戦が止まった');
log('2人の対戦は続いている');
for (const b of browsers) await b.close();

// 60秒のヒント
const wait = 62000 - (Date.now() - started);
if (wait > 0) await W.page.waitForTimeout(wait);
await W.page.getByText('ばんごうが あってるか たしかめてね').waitFor({ timeout: 10000 });
await shot(W.page, `4_${SIZES[1].name}_W_60s_hint`);
log('60秒のヒント');
await W.page.getByRole('button', { name: 'やめる' }).click();
await W.page.getByTestId('room-input').waitFor();
log('やめる → 入力へ。errors', W.errors, pages.map((p) => p.errors));
await bW.close();
