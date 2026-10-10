// 重いテスト（npm run test:slow）：本物のブラウザ（Playwright）で画面を開いて確かめる（v2.3）。
// 自分で開発サーバーを立てるので、npm run dev は要らない。
// - L01 全部の画面を 1280×720・844×390・390×844、両方の言語で開き、文字のはみ出し・押せないボタンが無い（scripts/layoutScan.mjs）
// - L02 管理者のパスワード：設定の「せってい」の字を10秒押すと開く。9秒で離す・途中で字の外に出る・大きく動く と開かない。
//       隠しボタンは無い。ふつうのクリック・タップでは何も起きない。押している間 見た目が変わらず、文字も選ばれない。マウスと指の両方
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

/** 設定を開いて、「せってい」の字の真ん中を返す */
async function openSettings(touch: boolean): Promise<{ page: Page; x: number; y: number; close: () => Promise<void> }> {
  const ctx = await browser!.newContext({ viewport: { width: 1280, height: 720 }, hasTouch: touch, isMobile: false });
  const page = await ctx.newPage();
  await page.goto(BASE + '?debug=1');
  await page.waitForTimeout(800);
  await seedSave(page, 'hira');
  await page.goto(BASE + '?debug=1&api=off');
  await page.waitForTimeout(2000);
  await page.mouse.click(640, 360);
  await page.locator('.menu-scene').waitFor();
  await page.evaluate(() => (window as unknown as { __otecaGo: (r: string) => void }).__otecaGo('settings'));
  const hold = page.getByTestId('admin-hold');
  await hold.waitFor();
  await page.waitForTimeout(800);
  const box = (await hold.boundingBox())!;
  return { page, x: box.x + box.width / 2, y: box.y + box.height / 2, close: () => ctx.close() };
}

/** 押す・動かす・離す（マウスと指で同じ書き方） */
async function presser(page: Page, touch: boolean) {
  if (!touch) {
    return {
      down: async (x: number, y: number) => {
        await page.mouse.move(x, y);
        await page.mouse.down();
      },
      move: (x: number, y: number) => page.mouse.move(x, y, { steps: 5 }),
      up: () => page.mouse.up(),
    };
  }
  const cdp = await page.context().newCDPSession(page);
  let at = { x: 0, y: 0 };
  return {
    down: async (x: number, y: number) => {
      at = { x, y };
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    },
    move: async (x: number, y: number) => {
      for (let i = 1; i <= 5; i++) {
        const p = { x: at.x + ((x - at.x) * i) / 5, y: at.y + ((y - at.y) * i) / 5 };
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [p] });
      }
      at = { x, y };
    },
    up: () => cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }),
  };
}

const opened = (page: Page) => page.getByTestId('admin-password').count();

for (const touch of [false, true]) {
  const how = touch ? '指（タッチ）' : 'マウス';
  describe(`L02 管理者のパスワード：「せってい」の字を10秒押す（${how}）`, () => {
    it('① 10秒押すと パスワードの入力欄が開く。押している間は見た目が変わらず、文字も選ばれない', async () => {
      const { page, x, y, close } = await openSettings(touch);
      const p = await presser(page, touch);
      const before = await page.getByTestId('admin-hold').screenshot();
      await p.down(x, y);
      await page.waitForTimeout(5000);
      const middle = await page.getByTestId('admin-hold').screenshot();
      expect(Buffer.compare(before, middle)).toBe(0);
      await page.waitForTimeout(6500);
      expect(await opened(page)).toBe(1);
      await p.up();
      expect(await page.evaluate(() => window.getSelection()?.toString() ?? '')).toBe('');
      // 離しても開いたまま
      await page.waitForTimeout(800);
      expect(await opened(page)).toBe(1);
      await close();
    }, 60000);

    it('② 9秒で離すと開かない（離したら数え直し）', async () => {
      const { page, x, y, close } = await openSettings(touch);
      const p = await presser(page, touch);
      await p.down(x, y);
      await page.waitForTimeout(9000);
      await p.up();
      await page.waitForTimeout(2500);
      expect(await opened(page)).toBe(0);
      await close();
    }, 60000);

    it('③ 途中で字の外に出ると開かない。大きく動いた時も開かない', async () => {
      const { page, x, y, close } = await openSettings(touch);
      const p = await presser(page, touch);
      // 字の外へ出て、押したまま待つ
      await p.down(x, y);
      await page.waitForTimeout(3000);
      await p.move(x + 300, y + 200);
      await page.waitForTimeout(8000);
      await p.up();
      expect(await opened(page)).toBe(0);
      // 字の端から、少しだけ（数え直しの大きさより小さく）外へ出る
      const box = (await page.getByTestId('admin-hold').boundingBox())!;
      await p.down(box.x + box.width - 3, y);
      await page.waitForTimeout(2000);
      await p.move(box.x + box.width + 6, y);
      await page.waitForTimeout(9000);
      await p.up();
      expect(await opened(page)).toBe(0);
      // 字の中で大きく動く（スクロールのつもり）
      await p.down(x - 20, y);
      await page.waitForTimeout(2000);
      await p.move(x + 20, y);
      await page.waitForTimeout(9000);
      await p.up();
      expect(await opened(page)).toBe(0);
      await close();
    }, 60000);

    it('④ 隠しボタンは無い。ふつうのクリック・タップでは何も起きない', async () => {
      const { page, x, y, close } = await openSettings(touch);
      expect(await page.getByTestId('admin-button').count()).toBe(0);
      expect(await page.getByTestId('admin-corner').count()).toBe(0);
      if (touch) await page.touchscreen.tap(x, y);
      else await page.mouse.click(x, y);
      await page.waitForTimeout(1500);
      expect(await opened(page)).toBe(0);
      expect(await page.getByTestId('admin-button').count()).toBe(0);
      await close();
    }, 60000);
  });
}
