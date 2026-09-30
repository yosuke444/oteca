// 5-2 の確認：タイトル・メニュー・画面切り替え（ページめくり）・勝ち／負けの演出・待機中の動き
// 使い方：node scripts/shots-5-2.mjs 0（1280×720）／1（844×390）
import { SIZES, clickText, launch, openPage, setSpeed, shot, waitIdle } from './pw.mjs';
import { playToEnd } from './play-local.mjs';

const size = SIZES[Number(process.argv[2] ?? 0)];
const n = (k) => `5-2_${size.name}_${k}`;
const browser = await launch();
const { page, errors } = await openPage(browser, size);
const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);

// S00 タイトル：ロゴが書き順どおりに描かれていく → 「タップしてはじめる」が点滅
await page.waitForTimeout(250);
await shot(page, n('01_title_drawing'));
await page.waitForTimeout(2600);
await shot(page, n('02_title_done'));

// タップ → メニュー（ページがめくれる途中を撮る）
await page.mouse.click(size.width / 2, size.height / 2);
await page.waitForTimeout(220);
await shot(page, n('03_pageturn'));
await page.getByRole('button', { name: 'デッキへんしゅう' }).waitFor();
await page.waitForTimeout(600);
await shot(page, n('04_menu'));
// ストーリー（じゅんびちゅう）を押すと、ふせんが揺れて「もうすこし まってね」
await page.getByRole('button', { name: /ストーリー/ }).click();
await page.waitForTimeout(250);
await shot(page, n('05_menu_locked'));
log('title/menu');

// 待機中：10秒操作しないと「ターンおわり」ボタンが揺れる
await clickText(page, 'デバッグたいせん');
await clickText(page, 'ひとりで りょうほう');
await waitIdle(page, 30000);
for (let i = 0; i < 2; i++) {
  await page.locator('.battle-hand .battle-card:not(.is-dim)').first().click();
  await clickText(page, 'バトルばに だす');
  await waitIdle(page, 30000);
}
await page.waitForTimeout(10600);
const nudge = await page.locator('.battle-end.is-nudge').count();
await shot(page, n('06_idle_nudge'));
log('10秒後に ターンおわり が揺れている:', nudge > 0);
if (!nudge) throw new Error('10秒たっても揺れない');
await page.locator('[aria-label="メニュー"]').click();
await clickText(page, 'おてあげする（こうさん）');
await clickText(page, 'おてあげする', { exact: true });
await page.locator('.result').waitFor();
await clickText(page, 'メニューへ');

// 勝ち：ひとりで両方あやつる対戦を最後まで（さいそく）→ 「○○ の かち！」の演出
await page.getByRole('button', { name: 'デッキへんしゅう' }).waitFor();
await setSpeed(page, 'さいそく');
await clickText(page, 'デバッグたいせん');
await clickText(page, 'ひとりで りょうほう');
await playToEnd(page, n('play'));
for (const [i, ms] of [350, 650, 1000, 1500, 2800].entries()) {
  await page.waitForTimeout(i === 0 ? ms : ms - [350, 650, 1000, 1500, 2800][i - 1]);
  await shot(page, n(`07_win_${i + 1}`));
}
log('win');

// 負け：かんたんCPU に降参 → 「まけ…」の演出
await clickText(page, 'メニューへ');
await clickText(page, 'デバッグたいせん');
await clickText(page, 'かんたんCPU と たいせん');
await page.locator('.battle').waitFor();
await page.waitForTimeout(800);
await page.locator('[aria-label="メニュー"]').click();
await clickText(page, 'おてあげする（こうさん）');
await clickText(page, 'おてあげする', { exact: true });
await page.locator('.result').waitFor();
for (const [i, ms] of [400, 800, 1200, 1900, 2800].entries()) {
  await page.waitForTimeout(i === 0 ? ms : ms - [400, 800, 1200, 1900, 2800][i - 1]);
  await shot(page, n(`08_lose_${i + 1}`));
}
log('lose. errors', errors.length ? errors : 'なし');
await browser.close();
