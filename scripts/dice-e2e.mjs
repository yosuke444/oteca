// サイコロが場に残るバグの確かめ（v2.7）。npx vite --port 5175 のまま
//   node scripts/dice-e2e.mjs
// 1. もやす（どの目でも手札を捨てる）：攻撃のあとに「すてる カードを えらんでね」で操作が分かれる → 選んだ後にサイコロが残らない
// 2. ふつうの対戦を続けて、操作が終わって落ち着くたびにサイコロ（.fx-die2・印 data-fx-die）が残っていない
// 3. サイコロが転がっている途中で画面を離れる → どこにもサイコロが残らない
// 4. ほかの演出（攻撃の数字・粒）はサイコロを消した後も消えずに出る（数字の要素が出たかを数える）
import { BASE, SIZES, launch, openPage } from './pw.mjs';

const NL = String.fromCharCode(10);
const problems = [];
const browser = await launch();
const MOYASU = 38;
const KUSURI = 9;
const MUTSU = 6;
const DECK = [MOYASU, MOYASU, MOYASU, KUSURI, KUSURI, KUSURI, KUSURI, KUSURI, KUSURI, 1, 1, 1, 6, 6, 6];
const log = (...a) => console.log(...a);

async function start(size) {
  const p = await openPage(browser, size, '?debug=1&api=off');
  await p.page.waitForTimeout(1200);
  await p.page.evaluate(async () => {
    const cs = await import('/src/save/cookieStore.ts');
    const sd = await import('/src/save/saveData.ts');
    const d = sd.createDefaultSave();
    d.tutorial = { done: true, gachaInviteShown: true, step: 0 };
    d.loginBonus.claimedAt = Date.now();
    d.settings.fxSpeed = 2;
    cs.persist({ jar: cs.browserCookieJar(), local: window.localStorage, secure: false }, d);
  });
  await p.page.goto(BASE + '?debug=1&api=off');
  await p.page.waitForTimeout(1500);
  await p.page.mouse.click(size.width / 2, size.height / 2);
  await p.page.locator('.stage .menu-scene').first().waitFor();
  return p;
}
const battle = (page, sandbox) =>
  page.evaluate(
    ({ DECK, sandbox }) => {
      const side = (x) => ({ ...x, deck: [...DECK] });
      window.__otecaGo('battle', { mode: 'local', decks: { p1: DECK, p2: DECK }, names: { p1: '1P', p2: '2P' }, seed: `dice-${Date.now()}`, me: 'p1', record: false, debug: true, sandbox: { p1: side(sandbox.p1), p2: side(sandbox.p2) } });
    },
    { DECK, sandbox },
  );
const state = (page) => page.locator('.stage .battle-board').first().getAttribute('data-state').catch(() => '');
const dice = (page) => page.evaluate(() => document.querySelectorAll('.fx-die2, [data-fx-die]').length);
/** 落ち着くまで（演出が終わり、選ぶ画面も出ていない） */
async function settle(page) {
  for (let i = 0; i < 200; i++) {
    const s = await state(page);
    if (s !== 'busy') break;
    await page.waitForTimeout(100);
  }
  await page.waitForTimeout(600); // 薄くして消す 0.3秒の分
}

try {
  const size = SIZES[0];
  const { page, ctx, errors } = await start(size);

  // ---------------------------------------------------------------- 1. もやす：攻撃 → 捨てるカードを選ぶ（操作が分かれる）
  await battle(page, { p1: { active: MOYASU, bench: [], hand: [KUSURI, KUSURI, KUSURI] }, p2: { active: MUTSU, bench: [MUTSU], hand: [] } });
  await page.locator('.stage .battle-board').first().waitFor();
  await settle(page);
  let checked = 0;
  for (let turn = 0; turn < 12 && checked < 3; turn++) {
    const end = page.locator('.stage .battle-end button');
    if ((await page.locator('.result').count()) > 0 || (await end.count()) === 0) break;
    if ((await end.getAttribute('aria-disabled')) === 'true') {
      await page.waitForTimeout(300);
      continue;
    }
    await end.click();
    // 選ぶ画面が出たら：その間はサイコロが見えていてよい。選んだ後に残らないこと
    const panel = page.getByTestId('choose-panel');
    const appeared = await panel.waitFor({ timeout: 15000 }).then(() => true).catch(() => false);
    if (appeared) {
      const during = await dice(page);
      const need = Number((await page.locator('.choose-panel__count').textContent())?.match(/\/\s*(\d+)/)?.[1] ?? 1);
      const cards = page.getByTestId('choose-card');
      for (let k = 0; k < need; k++) await cards.nth(k).click();
      await page.getByRole('button', { name: 'けってい' }).or(page.locator('.dialog .rough-button').last()).first().click();
      await settle(page);
      const after = await dice(page);
      log(`1. もやす（捨てる ${need}まい）：選んでいる間のサイコロ ${during} → 選んだ後 ${after}`);
      if (after !== 0) problems.push(`1. 捨てるカードを選んだ後にサイコロが ${after}こ 残った`);
      checked += 1;
    }
    await settle(page);
    // 相手（2P）のターン：ターンおわり
    if ((await page.locator('.result').count()) > 0) break;
    const end2 = page.locator('.stage .battle-end button');
    if ((await end2.count()) && (await end2.getAttribute('aria-disabled')) !== 'true') {
      await end2.click();
      await settle(page);
    }
  }
  if (checked === 0) problems.push('1. 捨てる場面が来なかった');

  // ---------------------------------------------------------------- 2. ふつうの対戦を続ける
  await page.evaluate(() => window.__otecaGo('menu'));
  await page.waitForTimeout(800);
  await battle(page, { p1: { active: 1, bench: [MUTSU], hand: [] }, p2: { active: MUTSU, bench: [1], hand: [] } });
  await page.locator('.stage .battle-board').first().waitFor();
  await settle(page);
  let leftovers = 0;
  let numbers = 0;
  const seen = await page.evaluate(() => {
    // 攻撃の数字（.fx-burst）が出た回数を数える（サイコロを消しても、ほかの演出は出ること）
    window.__burst = 0;
    new MutationObserver((ms) => ms.forEach((m) => m.addedNodes.forEach((n) => n.classList?.contains('fx-burst') && (window.__burst += 1)))).observe(document.querySelector('.fx-overlay'), { childList: true });
    return true;
  });
  for (let i = 0; i < 30 && (await page.locator('.result').count()) === 0; i++) {
    const end = page.locator('.stage .battle-end button');
    if ((await end.count()) === 0) break;
    if ((await end.getAttribute('aria-disabled')) === 'true') {
      // 気絶のあとに次を出す など
      const bench = page.locator('.stage .battle-slot--bench .battle-card').first();
      if (await page.getByText(/くりだす|だす おてあげ/).count()) await bench.click({ force: true }).catch(() => {});
      await page.waitForTimeout(300);
      continue;
    }
    await end.click();
    await settle(page);
    const n = await dice(page);
    if (n > 0 && (await page.getByTestId('choose-panel').count()) === 0) leftovers += 1;
  }
  numbers = await page.evaluate(() => window.__burst);
  log(`2. ふつうの対戦：落ち着いた時にサイコロが残っていた回数 ${leftovers}・攻撃の数字が出た回数 ${numbers}（${seen}）`);
  if (leftovers > 0) problems.push(`2. 落ち着いた時にサイコロが残っていた（${leftovers}回）`);
  if (numbers === 0) problems.push('2. 攻撃の数字の演出が1回も出なかった');

  // ---------------------------------------------------------------- 3. 転がっている途中で画面を離れる
  await page.evaluate(() => window.__otecaGo('menu'));
  await page.waitForTimeout(800);
  await battle(page, { p1: { active: 1, bench: [], hand: [] }, p2: { active: MUTSU, bench: [], hand: [] } });
  await page.locator('.stage .battle-board').first().waitFor();
  await settle(page);
  await page.locator('.stage .battle-end button').click();
  await page.waitForFunction(() => document.querySelectorAll('.fx-die2').length > 0, null, { timeout: 10000 }).catch(() => {});
  const rolling = await dice(page);
  await page.evaluate(() => window.__otecaGo('menu'));
  await page.waitForTimeout(1500);
  const afterLeave = await dice(page);
  log(`3. 転がっている途中で画面を離れた：離れる前 ${rolling} → 離れた後 ${afterLeave}`);
  if (rolling === 0) problems.push('3. サイコロが転がる前に離れてしまった（確かめられていない）');
  if (afterLeave !== 0) problems.push(`3. 画面を離れた後にサイコロが ${afterLeave}こ 残った`);

  for (const e of errors) problems.push(`エラー：${e}`);
  await ctx.close();
} catch (e) {
  problems.push(String(e?.stack ?? e));
} finally {
  await browser.close();
}
console.log(problems.length ? `${NL}見つかったこと ${problems.length}件：${NL}- ${problems.join(`${NL}- `)}` : `${NL}すべて OK`);
process.exit(problems.length ? 1 : 0);
