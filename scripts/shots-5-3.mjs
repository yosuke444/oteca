// 5-3 の確認：こうかおん テスト。全部の効果音を書き出して大きさと長さを測る＋ボタンを押して撮る
// 使い方：node scripts/shots-5-3.mjs 0（1280×720）／1（844×390）
import { SIZES, clickText, launch, openPage, shot, toMenu } from './pw.mjs';

const size = SIZES[Number(process.argv[2] ?? 0)];
const browser = await launch();
const { page, errors } = await openPage(browser, size);
await toMenu(page, size);
await page.waitForTimeout(900);
await shot(page, `5-3_${size.name}_menu_debug`);
await clickText(page, 'こうかおん テスト');
await page.getByTestId('soundtest').waitFor();
await page.waitForTimeout(700);
const results = await page.evaluate(() => window.__otecaSoundCheck());
console.table(results);
const bad = results.filter((r) => r.peak < 0.05 || r.peak > 1.0);
if (bad.length) console.log('大きさが気になる音:', bad.map((r) => r.key));
const win = results.find((r) => r.key === 'jingle_win');
const lose = results.find((r) => r.key === 'jingle_lose');
console.log('jingle_win', win.seconds, 's（目安 約3秒）／ jingle_lose', lose.seconds, 's（目安 約2.5秒）');
// 全部のボタンを押す（▶ と ×5）→ エラーが出ない
for (const btn of await page.locator('[data-se]').all()) await btn.click();
await page.locator('[data-burst="se_click"]').click();
await page.getByRole('button', { name: /おおきい ダメージ/ }).click();
await page.waitForTimeout(400);
await shot(page, `5-3_${size.name}_soundtest`);
console.log(size.name, 'errors', errors.length ? errors : 'なし');
await browser.close();
