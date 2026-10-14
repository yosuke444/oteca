// v2.7 スポドリ（同じおてあげには1回の対戦で1回だけ）の確認とスクリーンショット（1280×720・844×390）。npm run dev（ポート 5175）のまま
//   node scripts/shots-v27s.mjs
// - ベンチの2体のHPを減らし、手札にスポドリ2枚。1枚目をベンチの左に使う
// - 2枚目を選ぶ画面：左（スポドリ ずみ）は灰色で「スポドリ ずみ」、右は使える（光る）
// - 「スポドリ ずみ」の印がカードに残る。左に使おうとすると理由の一言
import { BASE, SIZES, launch, openPage } from './pw.mjs';
import { scanPage } from './layoutScan.mjs';

const NL = String.fromCharCode(10);
const problems = [];
const browser = await launch();
const DECK = [1, 1, 1, 2, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 6];
const SUPODORI = 12;
const MUTSU = 6;
const OTEAGE = 1;

async function start(size) {
  const p = await openPage(browser, size, '?debug=1&api=off');
  await p.page.waitForTimeout(1200);
  await p.page.evaluate(async () => {
    const cs = await import('/src/save/cookieStore.ts');
    const sd = await import('/src/save/saveData.ts');
    const d = sd.createDefaultSave();
    d.tutorial = { done: true, gachaInviteShown: true, step: 0 };
    d.loginBonus.claimedAt = Date.now();
    cs.persist({ jar: cs.browserCookieJar(), local: window.localStorage, secure: false }, d);
  });
  await p.page.goto(BASE + '?debug=1&api=off');
  await p.page.waitForTimeout(1800);
  await p.page.mouse.click(size.width / 2, size.height / 2);
  await p.page.locator('.stage .menu-scene').first().waitFor();
  return p;
}
const idle = (page) =>
  page.waitForFunction(() => document.querySelector('.stage .battle-board')?.getAttribute('data-state') !== 'busy', null, { timeout: 30000 }).then(() => page.waitForTimeout(300));
const shot = (page, name) => page.screenshot({ path: `screenshots/v27s_${name}.png` });

try {
  for (const size of SIZES) {
    const tag = size.name;
    const { page, ctx, errors } = await start(size);
    await page.evaluate(
      ({ DECK, SUPODORI, MUTSU, OTEAGE }) => {
        const side = (s) => ({ ...s, deck: [...DECK] });
        window.__otecaGo('battle', {
          mode: 'local',
          decks: { p1: DECK, p2: DECK },
          names: { p1: '1P', p2: '2P' },
          seed: 'v27s',
          me: 'p1',
          record: false,
          debug: true,
          sandbox: { p1: side({ active: OTEAGE, bench: [MUTSU, MUTSU], benchHp: [20, 30], hand: [SUPODORI, SUPODORI] }), p2: side({ active: MUTSU, bench: [], hand: [] }) },
        });
      },
      { DECK, SUPODORI, MUTSU, OTEAGE },
    );
    await page.locator('.stage .battle-board').first().waitFor();
    await idle(page);
    const hand = page.locator('.stage .battle-hand .battle-card');
    const bench0 = page.locator('.stage .battle-slot--me.battle-slot--bench0 .battle-card').first();
    const bench1 = page.locator('.stage .battle-slot--me.battle-slot--bench1 .battle-card').first();
    // 1枚目：ベンチの左へ
    await hand.nth(0).click();
    await page.waitForTimeout(300);
    await bench0.click();
    await idle(page);
    // 2枚目を選ぶ
    await hand.nth(0).click();
    await page.waitForTimeout(500);
    const mark = await bench0.locator('[data-testid="used-mark"]').textContent().catch(() => null);
    const dim0 = (await bench0.getAttribute('class')) ?? '';
    const glow1 = (await bench1.getAttribute('class')) ?? '';
    if (mark?.trim() !== 'スポドリ ずみ') problems.push(`${tag} 左のおてあげに「スポドリ ずみ」が無い（${mark}）`);
    if (!dim0.includes('is-dim')) problems.push(`${tag} スポドリずみのおてあげが灰色になっていない`);
    if (!glow1.includes('is-highlight')) problems.push(`${tag} まだ使えるおてあげが光っていない`);
    if ((await bench1.locator('[data-testid="used-mark"]').count()) !== 0) problems.push(`${tag} 使っていないおてあげに印がある`);
    for (const f of await scanPage(page)) problems.push(`${tag} 選ぶ画面：${f}`);
    await shot(page, `${tag}_01_choose`);
    // スポドリずみ に使おうとすると、理由の一言
    await bench0.click();
    await page.waitForTimeout(400);
    const say = await page.locator('.stage').innerText();
    if (!say.includes('この おてあげには もう つかったよ')) problems.push(`${tag} スポドリずみに使おうとした時の一言が出ない`);
    await shot(page, `${tag}_02_refused`);
    // 選ぶのをやめて、印だけ
    await page.keyboard.press('Escape');
    await page.mouse.click(size.width * 0.5, size.height * 0.5);
    await page.waitForTimeout(1500);
    await shot(page, `${tag}_03_mark`);
    console.log(tag, mark, dim0.includes('is-dim'), glow1.includes('is-highlight'));
    for (const e of errors) problems.push(`${tag} エラー：${e}`);
    await ctx.close();
  }
} finally {
  await browser.close();
}
console.log(problems.length ? `${NL}見つかったこと ${problems.length}件：${NL}- ${problems.join(`${NL}- `)}` : `${NL}すべて OK`);
