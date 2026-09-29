// 3-1 の確認：ひとりで両方あやつる対戦で、各操作と各場面を2つの大きさで撮る
import { SIZES, clickText, launch, openPage, shot, waitIdle } from './pw.mjs';

for (const size of SIZES) {
  const browser = await launch(); // 大きさごとに起動し直す
  const { ctx, page, errors } = await openPage(browser, size);
  const n = (k) => `3-1_${size.name}_${k}`;
  await page.mouse.click(size.width / 2, size.height / 2); // タイトル → メニュー
  await page.waitForTimeout(400);
  await clickText(page, 'デバッグたいせん');
  await clickText(page, 'ひとりで りょうほう');
  await waitIdle(page);
  await shot(page, n('01_setup'));

  // 準備：1P と 2P が手札の最初のおてあげを選ぶ（1P はタップ2回、2P はドラッグ）
  await page.locator('.battle-hand .battle-card:not(.is-dim)').first().click();
  await clickText(page, 'バトルばに だす');
  await waitIdle(page);
  await shot(page, n('02_setup_wait'));
  {
    const card = page.locator('.battle-hand .battle-card:not(.is-dim)').first();
    const from = await card.boundingBox();
    const to = await page.locator('.battle-slot--me.battle-slot--active').boundingBox();
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(from.x + 40, from.y - 40, { steps: 5 });
    await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 10 });
    await shot(page, n('03_dragging'));
    await page.mouse.up();
  }
  await waitIdle(page);
  await shot(page, n('04_main'));

  // ベンチに出す（ドラッグ）
  {
    const card = page.locator('.battle-hand .battle-card.is-highlight').filter({ hasNot: page.locator('.battle-card__note') }).first();
    if (await card.count()) {
      const from = await card.boundingBox();
      const to = await page.locator('.battle-slot--me.battle-slot--bench0').boundingBox();
      await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
      await page.mouse.down();
      await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 12 });
      await page.mouse.up();
      await waitIdle(page);
    }
  }
  await shot(page, n('05_bench_by_drag'));

  // 手札をタップして選ぶ（小さい画面では左に拡大表示が出る）
  const handCard = page.locator('.battle-hand .battle-card:not(.is-dim)').first();
  if (await handCard.count()) {
    await handCard.click();
    await page.waitForTimeout(250);
    await shot(page, n('06_selected'));
    await clickText(page, 'やめる', { exact: true });
  }

  // 出来ない操作：ベンチは1ターン1まい
  const dimCard = page.locator('.battle-hand .battle-card.is-dim').first();
  if (await dimCard.count()) {
    await dimCard.click();
    await page.waitForTimeout(200);
    await shot(page, n('07_reason'));
  }

  // ログ
  await clickText(page, 'ログ');
  await page.waitForTimeout(200);
  await shot(page, n('08_log'));
  await clickText(page, 'ログ');

  // 長押し（右クリック）でカード詳細
  await page.locator('.battle-slot--me.battle-slot--active .battle-card').click({ button: 'right', force: true });
  await page.waitForTimeout(250);
  await shot(page, n('09_detail'));
  await clickText(page, 'とじる');

  // ブラウザの戻るボタン → 確認
  await page.goBack();
  await page.waitForTimeout(300);
  await shot(page, n('10_back_confirm'));
  await clickText(page, 'つづける', { exact: true });

  // ⚙ → おてあげする → 確認 → リザルト
  await page.locator('[aria-label="メニュー"]').click();
  await page.waitForTimeout(200);
  await shot(page, n('11_menu'));
  await clickText(page, 'おてあげする（こうさん）');
  await page.waitForTimeout(200);
  await shot(page, n('12_surrender_confirm'));
  await clickText(page, 'おてあげする', { exact: true });
  await page.waitForSelector('.result', { timeout: 15000 });
  await page.waitForTimeout(300);
  await shot(page, n('13_result_surrender'));

  console.log(size.name, 'errors:', errors.length ? errors : 'なし');
  await browser.close();
}
