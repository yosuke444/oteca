// Playwright の共通の道具（画面の確認用。npm test とは別に手で動かす）
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

export const BASE = process.env.OTECA_URL ?? 'http://localhost:5175/';
export const SIZES = [
  { name: '1280x720', width: 1280, height: 720 },
  { name: '844x390', width: 844, height: 390 },
];

mkdirSync('screenshots', { recursive: true });

export async function launch() {
  return chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
}

/** 新しいページ（セーブデータは空の状態から） */
export async function openPage(browser, size, query = '?debug=1') {
  const ctx = await browser.newContext({ viewport: { width: size.width, height: size.height }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  page.setDefaultTimeout(30000); // 1操作30秒まで
  page.setDefaultNavigationTimeout(30000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.goto(BASE + query);
  await page.waitForTimeout(300);
  return { ctx, page, errors };
}

/** ボタンを文字で探して押す */
export async function clickText(page, text, opts = {}) {
  await page.getByRole('button', { name: text, exact: opts.exact ?? false }).first().click({ timeout: opts.timeout ?? 5000 });
}

export async function shot(page, name) {
  await page.screenshot({ path: `screenshots/${name}.png` });
}

/** 演出が終わって操作できるまで待つ（ヒント行が「…」でなくなる） */
export async function waitIdle(page, timeout = 20000) {
  await page.waitForFunction(() => !document.querySelector('.battle-hint') || document.querySelector('.battle-hint').textContent !== '…', null, { timeout });
  await page.waitForTimeout(150);
}

/** タイトルをタップしてメニューへ */
export async function toMenu(page, size) {
  await page.mouse.click(size.width / 2, size.height / 2);
  await page.getByRole('button', { name: 'デッキへんしゅう' }).waitFor();
}

/** 設定で演出スピードを変えてメニューへ戻る（label：ふつう／はやい／さいそく） */
export async function setSpeed(page, label) {
  await page.getByRole('button', { name: 'せってい' }).click();
  await clickText(page, label, { exact: true });
  await clickText(page, 'もどる');
  await page.getByRole('button', { name: 'デッキへんしゅう' }).waitFor();
}
