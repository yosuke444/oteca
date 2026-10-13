// v2.7 パックガチャの枚数（50コイン 2袋・200コイン 10袋）の確認とスクリーンショット（1280×720・844×390）。
// npm run dev（ポート 5175）のまま node scripts/shots-v27g.mjs
// - ガチャ画面：ボタンの文字「2まい ひく」「10まい ひく」「2まい おとく」
// - 10まい：袋が10（10袋目が金色の かくてい の袋）→ まとめの一覧に10枚が切れずに並ぶ
// - 2まい：袋が2（かくてい無し）→ まとめに2枚
import { BASE, SIZES, launch, openPage } from './pw.mjs';
import { scanPage } from './layoutScan.mjs';

const NL = String.fromCharCode(10);
const problems = [];
const browser = await launch();

async function start(size) {
  const p = await openPage(browser, size, '?debug=1&api=off');
  await p.page.waitForTimeout(1500);
  await p.page.evaluate(async () => {
    const cs = await import('/src/save/cookieStore.ts');
    const sd = await import('/src/save/saveData.ts');
    const d = sd.createDefaultSave();
    d.tutorial = { done: true, gachaInviteShown: true, step: 0 };
    d.loginBonus.claimedAt = Date.now();
    d.coins = 5000;
    cs.persist({ jar: cs.browserCookieJar(), local: window.localStorage, secure: false }, d);
  });
  await p.page.goto(BASE + '?debug=1&api=off');
  await p.page.waitForTimeout(2000);
  await p.page.mouse.click(size.width / 2, size.height / 2);
  await p.page.locator('.stage .menu-scene').first().waitFor();
  return p;
}

const go = (page, r) => page.evaluate((r) => window.__otecaGo(r), r);
const shot = (page, name) => page.screenshot({ path: `screenshots/v27g_${name}.png` });
const scan = async (page, tag, name) => {
  for (const f of await scanPage(page)) problems.push(`${tag} ${name}：${f}`);
};

/** まとめの一覧のカードが、一覧の枠と画面の中に切れずに入っているか */
async function summaryCheck(page, tag, want) {
  const r = await page.evaluate(() => {
    const grid = document.querySelector('.gacha-summary__grid');
    const stage = document.querySelector('.stage').getBoundingClientRect();
    const g = grid.getBoundingClientRect();
    const cards = [...grid.querySelectorAll('.prize-card')].map((e) => e.getBoundingClientRect());
    const cut = cards.filter((c) => c.left < Math.max(g.left, stage.left) - 1 || c.right > Math.min(g.right, stage.right) + 1 || c.top < Math.max(g.top, stage.top) - 1 || c.bottom > Math.min(g.bottom, stage.bottom) + 1).length;
    return { n: cards.length, cut, scroll: grid.scrollHeight > grid.clientHeight + 1 };
  });
  if (r.n !== want) problems.push(`${tag} まとめのカードが ${r.n}枚（${want}枚のはず）`);
  if (r.cut > 0) problems.push(`${tag} まとめのカード ${r.cut}枚が切れている`);
  if (r.scroll) problems.push(`${tag} まとめの一覧がスクロールしないと見えない`);
  console.log(tag, 'summary', want, r);
}

try {
  for (const size of SIZES) {
    const tag = size.name;
    const { page, ctx, errors } = await start(size);
    await go(page, 'gacha');
    await page.getByTestId('gacha-buy-ten').waitFor();
    await page.waitForTimeout(800);
    const two = (await page.getByTestId('gacha-buy-two').innerText()).replace(/\s+/g, ' ');
    const ten = (await page.getByTestId('gacha-buy-ten').innerText()).replace(/\s+/g, ' ');
    if (!two.includes('2まい ひく') || !two.includes('50コイン') || two.includes('おとく')) problems.push(`${tag} 2まいのボタン：${two}`);
    if (!ten.includes('10まい ひく') || !ten.includes('200コイン') || !ten.includes('2まい おとく')) problems.push(`${tag} 10まいのボタン：${ten}`);
    await scan(page, tag, 'shop');
    await shot(page, `${tag}_01_shop`);
    console.log(tag, 'buttons', two, '/', ten);

    // 10まい
    await page.getByTestId('gacha-buy-ten').click();
    await page.waitForTimeout(1500);
    const bags = await page.locator('[data-testid^="gacha-bag-"]').count();
    if (bags !== 10) problems.push(`${tag} 10まい：袋が ${bags}`);
    if ((await page.getByTestId('gacha-bag-9').getAttribute('data-guaranteed')) !== '1') problems.push(`${tag} 10袋目が かくてい の袋でない`);
    if (!(await page.getByTestId('gacha-bag-9').getByTestId('gacha-guarantee-tag').count())) problems.push(`${tag} かくてい の袋に「かくてい！」が無い`);
    await scan(page, tag, 'bags10');
    await shot(page, `${tag}_02_bags10`);
    await page.getByTestId('gacha-skip').click();
    await page.getByTestId('gacha-summary').waitFor();
    await page.waitForTimeout(1500);
    await summaryCheck(page, tag, 10);
    await scan(page, tag, 'summary10');
    await shot(page, `${tag}_03_summary10`);

    // 2まい
    await go(page, 'gacha');
    await page.getByTestId('gacha-buy-two').waitFor();
    await page.waitForTimeout(600);
    await page.getByTestId('gacha-buy-two').click();
    await page.waitForTimeout(1200);
    const bags2 = await page.locator('[data-testid^="gacha-bag-"]').count();
    if (bags2 !== 2) problems.push(`${tag} 2まい：袋が ${bags2}`);
    if (await page.locator('[data-guaranteed="1"]').count()) problems.push(`${tag} 2まいに かくてい の袋がある`);
    await shot(page, `${tag}_04_bags2`);
    await page.getByTestId('gacha-skip').click();
    await page.getByTestId('gacha-summary').waitFor();
    await page.waitForTimeout(1200);
    await summaryCheck(page, tag, 2);
    await shot(page, `${tag}_05_summary2`);

    for (const e of errors) problems.push(`${tag} エラー：${e}`);
    await ctx.close();
  }
} finally {
  await browser.close();
}
console.log(problems.length ? `${NL}見つかったこと ${problems.length}件：${NL}- ${problems.join(`${NL}- `)}` : `${NL}すべて OK`);
