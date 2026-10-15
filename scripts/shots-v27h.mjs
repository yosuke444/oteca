// v2.7 バランス調整：きみょうなドリンクを使ったおてあげは回復できない の確認とスクリーンショット（1280×720・844×390）。npx vite --port 5175 のまま
//   node scripts/shots-v27h.mjs
// - バトル場 みつめ（HP 減）・ベンチ ゆきだるま（HP 減）。手札に ドリンク・くすり・スポドリ。ドリンクをベンチの ゆきだるま に使う
// - くすりを選ぶ画面：ゆきだるま は灰色で「かいふく できない」、みつめ は使える（光る）。ゆきだるま に使おうとすると理由の一言
// - スポドリを選ぶ画面も同じ（ベンチの むつあし は使える）。印がカードに残る
import { BASE, SIZES, launch, openPage } from './pw.mjs';
import { scanPage } from './layoutScan.mjs';

const NL = String.fromCharCode(10);
const problems = [];
const browser = await launch();
const MITSUME = 2;
const YUKI = 18;
const DRINK = 11;
const KUSURI = 9;
const SUPODORI = 12;
const MUTSU = 6;
const DECK = [MITSUME, MITSUME, YUKI, YUKI, DRINK, KUSURI, SUPODORI, 1, 1, 1, 6, 6, 6, 4, 4];

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
const shot = (page, name) => page.screenshot({ path: `screenshots/v27h_${name}.png` });

try {
  for (const size of SIZES) {
    const tag = size.name;
    const { page, ctx, errors } = await start(size);
    await page.evaluate(
      ({ DECK, MITSUME, YUKI, DRINK, KUSURI, SUPODORI, MUTSU }) => {
        const side = (x) => ({ ...x, deck: [...DECK] });
        window.__otecaGo('battle', {
          mode: 'local',
          decks: { p1: DECK, p2: DECK },
          names: { p1: '1P', p2: '2P' },
          seed: 'v27h',
          me: 'p1',
          record: false,
          debug: true,
          sandbox: { p1: side({ active: MITSUME, activeHp: 40, bench: [YUKI, MUTSU], benchHp: [50, 60], hand: [DRINK, KUSURI, SUPODORI] }), p2: side({ active: MUTSU, bench: [], hand: [] }) },
        });
      },
      { DECK, MITSUME, YUKI, DRINK, KUSURI, SUPODORI, MUTSU },
    );
    await page.locator('.stage .battle-board').first().waitFor();
    await idle(page);
    const hand = page.locator('.stage .battle-hand .battle-card');
    const active = page.locator('.stage .battle-slot--me.battle-slot--active .battle-card').first();
    const bench0 = page.locator('.stage .battle-slot--me.battle-slot--bench0 .battle-card').first();
    // ドリンクをベンチの ゆきだるま へ
    await hand.nth(0).click();
    await page.waitForTimeout(300);
    await bench0.click();
    await page.waitForTimeout(400);
    // ベンチに攻撃のアイテムを使う時の確認（このターン こうげきしないよ）
    const yes = page.getByRole('button', { name: 'つかう', exact: true });
    if (await yes.count()) await yes.first().click();
    await idle(page);
    const mark = await bench0.locator('[data-testid="noheal-mark"]').textContent().catch(() => null);
    if (mark?.trim() !== 'かいふく できない') problems.push(`${tag} 「かいふく できない」の印が無い（${mark}）`);
    await shot(page, `${tag}_01_mark`);
    // くすり・スポドリを選ぶ画面
    for (const [i, name] of [[0, 'kusuri'], [1, 'supodori']]) {
      await hand.nth(i).click();
      await page.waitForTimeout(500);
      const dim0 = (await bench0.getAttribute('class')) ?? '';
      const glow = (await active.getAttribute('class')) ?? '';
      if (!dim0.includes('is-dim')) problems.push(`${tag} ${name}：回復できないおてあげが灰色になっていない`);
      if (name === 'kusuri' && !glow.includes('is-highlight')) problems.push(`${tag} くすり：使えるおてあげが光っていない`);
      const glow1 = (await page.locator('.stage .battle-slot--me.battle-slot--bench1 .battle-card').first().getAttribute('class')) ?? '';
      if (name === 'supodori' && !glow1.includes('is-highlight')) problems.push(`${tag} スポドリ：使えるベンチのおてあげが光っていない`);
      for (const f of await scanPage(page)) problems.push(`${tag} ${name} 選ぶ画面：${f}`);
      await shot(page, `${tag}_0${i + 2}_choose_${name}`);
      await bench0.click();
      await page.waitForTimeout(400);
      const say = await page.locator('.stage').innerText();
      if (!say.includes('かいふく できないよ')) problems.push(`${tag} ${name}：回復できないおてあげに使おうとした時の一言が出ない`);
      await shot(page, `${tag}_0${i + 2}_refused_${name}`);
      // 選ぶのをやめる（「やめる」）
      await page.getByRole('button', { name: 'やめる', exact: true }).first().click();
      await page.waitForTimeout(800);
    }
    for (const e of errors) problems.push(`${tag} エラー：${e}`);
    await ctx.close();
  }
} finally {
  await browser.close();
}
console.log(problems.length ? `${NL}見つかったこと ${problems.length}件：${NL}- ${problems.join(`${NL}- `)}` : `${NL}すべて OK`);
