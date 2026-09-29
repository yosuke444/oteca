// ひとりで両方あやつる対戦を最後まで自動で進める（1台で決着まで遊べるかの確認）
import { SIZES, clickText, launch, openPage, shot, waitIdle } from './pw.mjs';

export async function playToEnd(page, prefix, opts = {}) {
  let usedItem = false;
  let swapped = false;
  for (let turn = 0; turn < 200; turn++) {
    await waitIdle(page, 30000);
    if (await page.locator('.result').count()) break;
    if ((await page.locator('.battle-turn').textContent()) === 'けっちゃく') {
      await page.waitForSelector('.result', { timeout: 10000 });
      break;
    }
    // 準備：手札の最初のおてあげをバトル場へ
    if (await page.getByText('バトルばに だす おてあげを').count()) {
      await page.locator('.battle-hand .battle-card:not(.is-dim)').first().click();
      await clickText(page, 'バトルばに だす');
      continue;
    }
    // くりだし
    if (await page.getByText('くりだす おてあげを').count()) {
      await page.locator('.battle-slot--me.battle-slot--bench .battle-card').first().click({ force: true });
      continue;
    }
    // ベンチに出せるなら出す
    const lit = page.locator('.battle-hand .battle-card.is-highlight');
    for (let i = 0; i < (await lit.count()); i++) {
      const c = lit.nth(i);
      const isItem = (await c.locator('.battle-card__note').count()) > 0;
      if (!isItem) {
        await c.click();
        await page.locator('.battle-slot.is-drop').first().click();
        await waitIdle(page);
        break;
      }
    }
    // 1回だけアイテムを使ってみる（確認が出たら「つかう」）
    if (!usedItem && opts.item !== false) {
      const item = page.locator('.battle-hand .battle-card.is-highlight:has(.battle-card__note)').first();
      if (await item.count()) {
        await item.click();
        const target = page.locator('.battle-slot--me .battle-card.is-highlight').first();
        if (await target.count()) {
          await target.click({ force: true });
          if (await page.getByRole('button', { name: 'つかう' }).count()) await clickText(page, 'つかう', { exact: true });
          await waitIdle(page);
          await shot(page, `${prefix}_item`);
          usedItem = true;
        } else {
          await page.keyboard.press('Escape');
        }
      }
    }
    // 1回だけ交代（確認に答える）
    if (!swapped && turn > 6) {
      const bench = page.locator('.battle-slot--me.battle-slot--bench .battle-card.is-highlight').first();
      if (await bench.count()) {
        await bench.click({ force: true });
        await clickText(page, 'こうたい', { exact: true });
        await page.waitForTimeout(200);
        await shot(page, `${prefix}_swap_confirm`);
        await clickText(page, 'こうたい する');
        await waitIdle(page);
        swapped = true;
        await shot(page, `${prefix}_after_swap`);
      }
    }
    const end = page.locator('.battle-end button');
    if ((await end.getAttribute('aria-disabled')) === 'true') {
      await shot(page, `${prefix}_stuck`);
      const hint = await page.locator('.battle-hint').textContent().catch(() => '');
      const prompt = await page.locator('.battle-prompt').textContent().catch(() => '');
      throw new Error(`ターンおわりが押せない: hint=${hint} prompt=${prompt}`);
    }
    await end.click();
  }
  await page.waitForSelector('.result', { timeout: 30000 });
}

if (process.argv[1].endsWith('play-local.mjs')) {
  // 大きさごとに試験用ブラウザを起動し直す（1つのブラウザで2つ目のページを開くと、長い試合の途中で落ちることがあるため）
  // 使い方：node scripts/play-local.mjs 0（1280×720）／1（844×390）
  const sizes = process.argv[2] ? [SIZES[Number(process.argv[2])]] : SIZES;
  for (const size of sizes) {
    const browser = await launch();
    const { page, errors } = await openPage(browser, size);
    await page.mouse.click(size.width / 2, size.height / 2);
    await page.waitForTimeout(400);
    await clickText(page, 'デバッグたいせん');
    await clickText(page, 'ひとりで りょうほう');
    await playToEnd(page, `3-1_${size.name}_play`);
    await page.waitForTimeout(600);
    await shot(page, `3-1_${size.name}_09_result`);
    console.log(size.name, 'result OK, errors:', errors.length ? errors : 'なし');
    await browser.close();
  }
}
