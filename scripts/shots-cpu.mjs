// v1.4-C の確認：CPUたいせん（メニュー → 強さ → じぶんのデッキ → CPUのデッキ → 対戦 → リザルト → 記録）
// 使い方：npm run dev を動かしたまま node scripts/shots-cpu.mjs 0（1280×720）／1（844×390） [さいきょう など]
import { SIZES, clickText, launch, openPage, shot, toMenu, waitIdle } from './pw.mjs';

const size = SIZES[Number(process.argv[2] ?? 0)];
const levelLabel = process.argv[3] ?? 'さいきょう';
const n = (k) => `cpu_${size.name}_${k}`;
const browser = await launch();
const { page, errors } = await openPage(browser, size, '');
const log = (...a) => console.log(size.name, ...a);

await toMenu(page, size);
await page.waitForTimeout(800);
await shot(page, n('01_menu'));

// CPUたいせん
await clickText(page, 'CPUたいせん');
await page.getByTestId('cpu-scene').waitFor();
await page.waitForTimeout(700);
await shot(page, n('02_level'));
const recBefore = await page.getByTestId('cpu-rec-strongest').textContent();
await clickText(page, levelLabel);
await page.waitForTimeout(400);
await shot(page, n('03_my_deck'));
await page.locator('.cpu-scene__deck').first().click();
await page.waitForTimeout(400);
await shot(page, n('04_cpu_deck'));
await page.locator('.cpu-scene__deck').first().click();

// 対戦：準備（バトル場を選ぶ）→ CPU のターンで「かんがえちゅう…」
await waitIdle(page, 30000);
await page.locator('.battle-hand .battle-card:not(.is-dim)').first().click();
await clickText(page, 'バトルばに だす');
let sawThinking = false;
const until = Date.now() + 60000;
let shotThinking = false;
while (Date.now() < until) {
  if (await page.locator('.cpu-thinking').count()) {
    sawThinking = true;
    if (!shotThinking) {
      await shot(page, n('05_thinking'));
      shotThinking = true;
    }
  }
  const st = await page.locator('.battle-board').getAttribute('data-state').catch(() => '');
  if (st === 'mine' && (await page.locator('.battle-end button').getAttribute('aria-disabled')) !== 'true') break;
  await page.waitForTimeout(100);
}
log('かんがえちゅう… が出た', sawThinking);
await shot(page, n('06_my_turn'));
// 自分のターンを2回進めて CPU の手を見る
for (let t = 0; t < 2; t++) {
  await page.locator('.battle-end button').click();
  await waitIdle(page, 30000);
  const end = Date.now() + 60000;
  while (Date.now() < end) {
    if (await page.locator('.result').count()) break;
    if ((await page.locator('.cpu-thinking').count()) > 0) sawThinking = true;
    const st = await page.locator('.battle-board').getAttribute('data-state').catch(() => '');
    if (st === 'mine' && (await page.locator('.battle-end button').getAttribute('aria-disabled')) !== 'true') break;
    await page.waitForTimeout(100);
  }
  if (await page.locator('.result').count()) break;
}
await shot(page, n('07_after_cpu_turns'));
const stamp = await page.getByTestId('stamp-opp').count();
log('CPU のスタンプ（この時点で出ていれば 1）', stamp);

// こうさん → リザルト
if (!(await page.locator('.result').count())) {
  await page.locator('[aria-label="メニュー"]').click();
  await clickText(page, 'おてあげする（こうさん）');
  await clickText(page, 'おてあげする', { exact: true });
}
await page.locator('.result').waitFor({ timeout: 30000 });
await page.waitForTimeout(3000);
await shot(page, n('08_result'));
const buttons = await page.locator('.result__buttons button').allTextContents();
log('リザルトのボタン', JSON.stringify(buttons.map((b) => b.trim())));

// つよさを かえる → 記録が増えている
await clickText(page, 'つよさを かえる');
await page.getByTestId('cpu-scene').waitFor();
await page.waitForTimeout(500);
const recAfter = await page.getByTestId('cpu-rec-strongest').textContent();
log('さいきょう の記録', recBefore.trim(), '→', recAfter.trim());
await shot(page, n('09_level_after'));

// 読み込み直しても記録が残る
await page.reload();
await toMenu(page, size);
await clickText(page, 'CPUたいせん');
await page.getByTestId('cpu-scene').waitFor();
log('読み込み直した後の記録', (await page.getByTestId('cpu-rec-strongest').textContent()).trim());
log('errors:', errors.length ? errors : 'なし');
await browser.close();
