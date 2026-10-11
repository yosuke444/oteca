// 重いテスト（npm run test:slow）：本物のブラウザ（Playwright）で画面を開いて確かめる（v2.3）。
// 自分で開発サーバーを立てるので、npm run dev は要らない。
// - L01 全部の画面を 1280×720・844×390・390×844、両方の言語で開き、文字のはみ出し・押せないボタンが無い（scripts/layoutScan.mjs）
// - L02 管理画面の入り口（v2.4）：O と T の同時押しで開く。片方だけ・文字を打つ欄・対戦中・長押しでは開かない
import { type ChildProcess, spawn } from 'node:child_process';
import { chromium, type Browser, type Page } from '@playwright/test';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { scanAll, seedSave } from '../scripts/layoutScan.mjs';

const PORT = 5199;
const BASE = `http://localhost:${PORT}/`;
let server: ChildProcess | null = null;
let browser: Browser | null = null;

async function waitForServer(ms: number, exited: () => boolean) {
  const until = Date.now() + ms;
  for (;;) {
    if (exited()) throw new Error('開発サーバーが すぐ止まった');
    try {
      const r = await fetch(BASE);
      if (r.ok) return;
    } catch {
      // まだ
    }
    if (Date.now() > until) throw new Error('開発サーバーが立ち上がらない');
    await new Promise((r) => setTimeout(r, 500));
  }
}

beforeAll(async () => {
  // 前に止まり損ねたサーバーが残っていたら、古いプログラムを調べてしまうので止める（先に知らせる）
  const old = await fetch(BASE).then(() => true, () => false);
  if (old) throw new Error(`ポート ${PORT} が使われています（前のテストの開発サーバーが残っているかも）。止めてから動かしてください`);
  server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], { shell: true, stdio: 'ignore', detached: process.platform !== 'win32' });
  let exited = false;
  server.on('exit', () => (exited = true));
  await waitForServer(60000, () => exited);
  browser = await chromium.launch();
}, 120000);

afterAll(async () => {
  await browser?.close();
  const pid = server?.pid;
  if (!pid) return;
  // シェルの下の vite も止める（Windows は taskkill /T、ほかは プロセスのまとまりごと）
  if (process.platform === 'win32') {
    await new Promise<void>((resolve) => spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { shell: true, stdio: 'ignore' }).on('exit', () => resolve()));
  } else {
    try {
      process.kill(-pid);
    } catch {
      // もう止まっている
    }
  }
});

describe('L01 画面のはみ出し（全部の画面・3つの大きさ・2つの言語）', () => {
  it('文字がボタン・枠からはみ出さない。ボタンが画面・枠の外に出ていない', async () => {
    const found = await scanAll(browser!, BASE);
    expect(found).toEqual([]);
  }, 20 * 60 * 1000);
});

/** メニューまで開いた画面（セーブは「チュートリアル済み」） */
async function openMenu(): Promise<{ page: Page; close: () => Promise<void> }> {
  const ctx = await browser!.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  await page.goto(BASE + '?debug=1');
  await page.waitForTimeout(800);
  await seedSave(page, 'hira');
  await page.goto(BASE + '?debug=1&api=off');
  await page.waitForTimeout(2000);
  await page.mouse.click(640, 360);
  await page.locator('.menu-scene').waitFor();
  await page.waitForTimeout(500);
  return { page, close: () => ctx.close() };
}

const opened = (page: Page) => page.getByTestId('admin-password').count();
const goTo = (page: Page, route: string, payload?: unknown) =>
  page.evaluate(([r, p]) => (window as unknown as { __otecaGo: (r: string, p?: unknown) => void }).__otecaGo(r as string, p), [route, payload] as const);
/** O と T を押して離す（first を押したまま second を押す） */
async function chord(page: Page, first = 'KeyO', second = 'KeyT') {
  await page.keyboard.down(first);
  await page.keyboard.down(second);
  await page.waitForTimeout(300);
  await page.keyboard.up(second);
  await page.keyboard.up(first);
  await page.waitForTimeout(300);
}
async function closeLogin(page: Page) {
  await page.getByRole('button', { name: 'やめる' }).click();
  await page.waitForTimeout(300);
}

describe('L02 管理画面の入り口：O と T の同時押し（v2.4）', () => {
  it('① 同時押しで開く（どちらが先でも・どの画面でも・大文字でも・日本語入力がオンでも）。押しっぱなしでも1回だけ', async () => {
    const { page, close } = await openMenu();
    await chord(page, 'KeyO', 'KeyT');
    expect(await opened(page)).toBe(1);
    await closeLogin(page);
    await chord(page, 'KeyT', 'KeyO');
    expect(await opened(page)).toBe(1);
    await closeLogin(page);
    // ほかの画面でも
    for (const r of ['settings', 'deck', 'gacha', 'title']) {
      await goTo(page, r);
      await page.waitForTimeout(900);
      await chord(page);
      expect(await opened(page), r).toBe(1);
      await closeLogin(page);
    }
    // 大文字（Shift を押したまま）
    await page.keyboard.down('Shift');
    await chord(page);
    await page.keyboard.up('Shift');
    expect(await opened(page)).toBe(1);
    await closeLogin(page);
    // 日本語入力がオン（key は Process、keyCode 229。code は KeyO・KeyT のまま）
    await page.evaluate(() => {
      for (const code of ['KeyO', 'KeyT']) window.dispatchEvent(new KeyboardEvent('keydown', { code, key: 'Process', keyCode: 229, bubbles: true }));
    });
    await page.waitForTimeout(300);
    expect(await opened(page)).toBe(1);
    await page.evaluate(() => {
      for (const code of ['KeyO', 'KeyT']) window.dispatchEvent(new KeyboardEvent('keyup', { code, key: 'Process', keyCode: 229, bubbles: true }));
    });
    await closeLogin(page);
    // 押しっぱなし：閉じても、キーの繰り返しでは もう開かない。離して押し直すと開く
    await page.keyboard.down('KeyO');
    await page.keyboard.down('KeyT');
    await page.waitForTimeout(200);
    expect(await opened(page)).toBe(1);
    await closeLogin(page);
    for (let i = 0; i < 5; i++) {
      await page.keyboard.down('KeyT'); // 繰り返し（repeat）
      await page.keyboard.down('KeyO');
    }
    await page.waitForTimeout(300);
    expect(await opened(page)).toBe(0);
    await page.keyboard.up('KeyT');
    await page.keyboard.up('KeyO');
    await chord(page);
    expect(await opened(page)).toBe(1);
    await close();
  }, 120000);

  it('② O だけ・T だけでは開かない（離してから もう片方でも開かない）', async () => {
    const { page, close } = await openMenu();
    for (const k of ['KeyO', 'KeyT']) {
      await page.keyboard.down(k);
      await page.waitForTimeout(400);
      await page.keyboard.up(k);
    }
    await page.keyboard.press('KeyO');
    await page.keyboard.press('KeyT');
    await page.keyboard.press('KeyO');
    await page.waitForTimeout(400);
    expect(await opened(page)).toBe(0);
    await close();
  }, 60000);

  it('③ 文字を打つ欄（名前）にカーソルがある時は開かない。パスワードの欄で O・T を打っても もう1つ開かない', async () => {
    const { page, close } = await openMenu();
    await goTo(page, 'name');
    const input = page.getByTestId('name-input');
    await input.waitFor();
    await input.click();
    await chord(page);
    expect(await opened(page)).toBe(0);
    // 欄から外れたら開く
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await chord(page);
    expect(await opened(page)).toBe(1);
    const pw = page.getByTestId('admin-password');
    await pw.click();
    await chord(page);
    expect(await opened(page)).toBe(1);
    expect(await pw.inputValue()).toBe('ot');
    await close();
  }, 60000);

  it('④ 対戦中は開かない', async () => {
    const { page, close } = await openMenu();
    const deck = [1, 2, 3, 4, 5, 6, 7, 9, 10, 1, 2, 3, 4, 5, 6];
    await goTo(page, 'battle', { mode: 'cpu', cpuLevel: 'weak', decks: { p1: deck, p2: deck }, names: { p1: 'たろう', p2: 'CPU' }, seed: 'keys', me: 'p1', record: false });
    await page.locator('.battle').waitFor();
    await page.waitForTimeout(2500);
    await chord(page);
    await chord(page, 'KeyT', 'KeyO');
    expect(await opened(page)).toBe(0);
    await close();
  }, 60000);

  it('⑤ 「せってい」の字の長押しでは もう開かない（長押しの場所も無い）', async () => {
    const { page, close } = await openMenu();
    await goTo(page, 'settings');
    await page.waitForTimeout(900);
    expect(await page.getByTestId('admin-hold').count()).toBe(0);
    const title = page.locator('.settings-scene__title span');
    const box = (await title.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(10800);
    await page.mouse.up();
    await page.waitForTimeout(500);
    expect(await opened(page)).toBe(0);
    await close();
  }, 60000);
});
