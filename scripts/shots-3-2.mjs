// 3-2 の確認：デバッグ対戦の画面、かんたんCPU との対戦（決着まで）、サイコロの目の固定・山札の上・ハッシュ・ログ保存
// 使い方：node scripts/shots-3-2.mjs 0（1280×720）／1（844×390）
import { SIZES, clickText, launch, openPage, setSpeed, shot, toMenu, waitIdle } from './pw.mjs';
import { playToEnd } from './play-local.mjs';

const size = SIZES[Number(process.argv[2] ?? 0)];
const n = (k) => `3-2_${size.name}_${k}`;
const browser = await launch();
const { page, errors } = await openPage(browser, size);
await toMenu(page, size);
await setSpeed(page, 'さいそく');
await clickText(page, 'デバッグ たいせん');
// サイコロを6に固定、1P の山札の上に「くすり」「スポドリ」
await page.getByRole('button', { name: '6', exact: true }).click();
await clickText(page, 'くすり', { exact: true });
await clickText(page, 'スポドリ', { exact: true });
await shot(page, n('01_debug_screen'));
const stackText = await page.getByTestId('stack-list').textContent();
if (!stackText.includes('くすり → スポドリ')) throw new Error('山札の上の表示が違う: ' + stackText);

await clickText(page, 'かんたんCPU と たいせん');
await waitIdle(page);
await shot(page, n('02_cpu_setup'));
const hash1 = await page.getByTestId('state-hash').textContent();

// 準備 → 最初の自分の番
// CPU が先に選び終わるのを待ってから（演出中のタップは受け付けないため）
await page.waitForTimeout(600);
await waitIdle(page);
await page.locator('.battle-hand .battle-card:not(.is-dim)').first().click();
await clickText(page, 'バトルばに だす');
await waitIdle(page, 30000);
const hash2 = await page.getByTestId('state-hash').textContent();
if (hash1 === hash2) throw new Error('ハッシュが変わらない');
await shot(page, n('03_cpu_main'));

// 相手（CPU）の番を撮る：自分が先攻なら一度ターンを終える
for (let i = 0; i < 40 && !(await page.locator('.battle-opp-banner').count()); i++) {
  const end = page.locator('.battle-end button');
  if ((await end.getAttribute('aria-disabled')) !== 'true') await end.click();
  await page.waitForTimeout(150);
}
await page.waitForTimeout(250);
await shot(page, n('04_cpu_turn'));

// サイコロ6固定：両者が1回ずつ攻撃するまで進めて、ログに「サイコロ：6」だけが出ている
for (let myEnds = 0; myEnds < 1; ) {
  await waitIdle(page, 30000);
  const end = page.locator('.battle-end button');
  if ((await end.getAttribute('aria-disabled')) !== 'true') {
    await end.click();
    myEnds++;
  } else await page.waitForTimeout(200);
}
await page.waitForFunction(() => document.querySelector('.battle-opp-banner') === null || true);
await waitIdle(page, 30000);
await clickText(page, 'ログ');
const logText = await page.locator('.battle-log').textContent();
await shot(page, n('05_log_fixed_die'));
await clickText(page, 'ログ');
const attackDice = [...logText.matchAll(/・サイコロ：(\d)/g)].map((m) => m[1]);
if (attackDice.length === 0 || attackDice.some((d) => d !== '6')) throw new Error('サイコロが6に固定されていない: ' + attackDice);

// ⚙ → 行動ログの保存（ダウンロードされる）
await page.locator('[aria-label="メニュー"]').click();
await shot(page, n('06_menu_savelog'));
const [download] = await Promise.all([page.waitForEvent('download'), clickText(page, 'こうどうログを ほぞん')]);
const path = `screenshots/${n('actionlog')}.json`;
await download.saveAs(path);
await clickText(page, 'つづける');

// 決着まで
await playToEnd(page, n('play'));
await page.waitForTimeout(500);
await shot(page, n('07_result'));
console.log(size.name, 'CPU 対戦 決着。サイコロ:', attackDice.join(''), 'errors:', errors.length ? errors : 'なし');
await browser.close();
