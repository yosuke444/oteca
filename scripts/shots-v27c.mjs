// v2.7 CPU対戦のコイン（1日5回まで）の確認とスクリーンショット（1280×720・844×390）。npm run dev（ポート 5175）のまま
//   node scripts/shots-v27c.mjs
// - 強さを選ぶ画面：「きょうの コイン あと 5かい」（まだ0回）・「あと 1かい」・「きょうの コインは おしまい」
// - 結果画面：勝ってもらえた額（さいきょう 50）・5回目のあとの勝ちは「きょうの コインは おしまい」（コインは増えない）
import { BASE, SIZES, launch, openPage } from './pw.mjs';
import { scanPage } from './layoutScan.mjs';

const NL = String.fromCharCode(10);
const problems = [];
const browser = await launch();

/** used：今の区切りで、もうもらった回数 */
async function start(size, used) {
  const p = await openPage(browser, size, '?debug=1&api=off');
  await p.page.waitForTimeout(1500);
  await p.page.evaluate(async (used) => {
    const cs = await import('/src/save/cookieStore.ts');
    const sd = await import('/src/save/saveData.ts');
    const daily = await import('/src/daily/daily.ts');
    const d = sd.createDefaultSave();
    d.tutorial = { done: true, gachaInviteShown: true, step: 0 };
    d.loginBonus.claimedAt = Date.now();
    d.coins = 1000;
    d.cpuReward = { cycleKey: daily.cycleKeyAt(Date.now()), count: used };
    cs.persist({ jar: cs.browserCookieJar(), local: window.localStorage, secure: false }, d);
  }, used);
  await p.page.goto(BASE + '?debug=1&api=off');
  await p.page.waitForTimeout(2000);
  await p.page.mouse.click(size.width / 2, size.height / 2);
  await p.page.locator('.stage .menu-scene').first().waitFor();
  return p;
}

const go = (page, r, payload) => page.evaluate(([r, p]) => window.__otecaGo(r, p), [r, payload ?? null]);
const shot = (page, name) => page.screenshot({ path: `screenshots/v27c_${name}.png` });
const scan = async (page, tag, name) => {
  for (const f of await scanPage(page)) problems.push(`${tag} ${name}：${f}`);
};
const readSave = (page) =>
  page.evaluate(async () => {
    const cs = await import('/src/save/cookieStore.ts');
    const d = cs.load({ jar: cs.browserCookieJar(), local: window.localStorage, secure: false });
    return { coins: d?.coins, cpuReward: d?.cpuReward };
  });

/** 強さを選ぶ画面 */
async function levels(page, tag, name, want) {
  await go(page, 'cpu');
  await page.getByTestId('cpu-coins-left').waitFor();
  await page.waitForTimeout(500);
  const text = (await page.getByTestId('cpu-coins-left').textContent())?.trim();
  if (text !== want) problems.push(`${tag} ${name}：「${text}」（「${want}」のはず）`);
  await scan(page, tag, name);
  await shot(page, `${tag}_${name}`);
  console.log(tag, name, text);
}

/** CPU対戦（さいきょう）に勝った結果画面 */
async function result(page, tag, name, wantCoins, wantNote) {
  const before = (await readSave(page)).coins;
  await go(page, 'result', {
    setup: { mode: 'cpu', cpuLevel: 'strongest', decks: { p1: [1], p2: [1] }, names: { p1: 'プレイヤー', p2: 'CPU（さいきょう）' }, seed: 'x', me: 'p1', record: true },
    winner: 'p1',
    reason: 'ko',
    stats: { turns: 14, turnCounts: { p1: 7, p2: 7 }, sides: { p1: { damage: 300, kos: 3, mvpNo: 1, mvpDamage: 150 }, p2: { damage: 120, kos: 1, mvpNo: 1, mvpDamage: 120 } } },
    log: [],
    finalHash: '00000000',
  });
  await page.getByTestId('result-reward').waitFor();
  await page.waitForTimeout(2500);
  const box = (await page.getByTestId('result-reward').innerText()).replace(/\s+/g, ' ');
  const after = (await readSave(page)).coins;
  if (after - before !== wantCoins) problems.push(`${tag} ${name}：コインが ${after - before} 増えた（${wantCoins} のはず）`);
  if (wantNote && !box.includes(wantNote)) problems.push(`${tag} ${name}：「${wantNote}」が出ない（${box}）`);
  if (!wantNote && !box.includes(`+${wantCoins}`) && !box.includes(`＋${wantCoins}`)) problems.push(`${tag} ${name}：もらえた額が出ない（${box}）`);
  await scan(page, tag, name);
  await shot(page, `${tag}_${name}`);
  console.log(tag, name, box, after - before);
}

try {
  for (const size of SIZES) {
    const tag = size.name;
    {
      const { page, ctx, errors } = await start(size, 0);
      await levels(page, tag, '01_levels_left5', 'きょうの コイン あと 5かい');
      await result(page, tag, '02_result_win50', 50);
      for (const e of errors) problems.push(`${tag} エラー：${e}`);
      await ctx.close();
    }
    {
      const { page, ctx, errors } = await start(size, 4);
      await levels(page, tag, '03_levels_left1', 'きょうの コイン あと 1かい');
      // 5回目：もらえる → あと0回
      await result(page, tag, '04_result_5th', 50);
      await levels(page, tag, '05_levels_done', 'きょうの コインは おしまい');
      // 6回目：0コイン・「おしまい」
      await result(page, tag, '06_result_6th_none', 0, 'きょうの コインは おしまい');
      const s = await readSave(page);
      if (s.cpuReward?.count !== 5) problems.push(`${tag} 回数が ${JSON.stringify(s.cpuReward)}`);
      for (const e of errors) problems.push(`${tag} エラー：${e}`);
      await ctx.close();
    }
  }
} finally {
  await browser.close();
}
console.log(problems.length ? `${NL}見つかったこと ${problems.length}件：${NL}- ${problems.join(`${NL}- `)}` : `${NL}すべて OK`);
