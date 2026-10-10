// デイリーミッション「カードを 15まい ひく」（v2.3）の通しの確認：CPU対戦で引いたその時にセーブへ足され、
// 途中でやめても残り、2試合目は続きから数える。
// 使い方：npm run dev（ポート 5175）のまま node scripts/daily-draw-e2e.mjs
import { SIZES, launch, openPage, waitIdle } from './pw.mjs';

const problems = [];
const expect = (ok, what) => {
  if (!ok) problems.push(what);
  console.log(ok ? '✓' : '✗', what);
};
const size = SIZES[0];
const browser = await launch();
try {
  const { page, errors } = await openPage(browser, size);
  await page.evaluate(async () => {
    const cs = await import('/src/save/cookieStore.ts');
    const sd = await import('/src/save/saveData.ts');
    const daily = await import('/src/daily/daily.ts');
    const storage = { jar: cs.browserCookieJar(), local: window.localStorage, secure: false };
    const data = sd.createDefaultSave();
    data.tutorial = { done: true, gachaInviteShown: true, step: 0 };
    data.loginBonus.claimedAt = Date.now();
    data.playerId = '0123456789abcdef';
    daily.rollDaily(data, Date.now());
    data.daily.missions = [
      { id: 'draw20', progress: 0, claimed: false },
      { id: 'ko5', progress: 0, claimed: false },
      { id: 'gacha1', progress: 0, claimed: false },
    ];
    cs.persist(storage, data);
  });
  await page.goto(page.url().split('?')[0] + '?debug=1');
  await page.waitForTimeout(2500);
  await page.mouse.click(size.width / 2, size.height / 2);
  await page.locator('.menu-scene').waitFor();
  const progress = () =>
    page.evaluate(async () => {
      const cs = await import('/src/save/cookieStore.ts');
      const d = cs.load({ jar: cs.browserCookieJar(), local: window.localStorage, secure: false });
      return d.daily.missions.find((m) => m.id === 'draw20')?.progress ?? -1;
    });
  const hand = () => page.locator('.battle-hand .battle-card').count();
  /** CPU対戦（記録する対戦）を始めて、最初の手札が配られるまで */
  const startCpu = async (seed) => {
    const deck = [1, 2, 3, 4, 5, 6, 7, 8, 1, 2, 3, 4, 5, 6, 7];
    await page.evaluate(
      ([d, s]) => window.__otecaGo('battle', { mode: 'cpu', cpuLevel: 'weak', decks: { p1: d, p2: d }, names: { p1: 'たろう', p2: 'CPU' }, seed: s, me: 'p1', record: true }),
      [deck, seed],
    );
    await page.locator('.battle-board').waitFor({ timeout: 20000 });
    await waitIdle(page, 30000);
    await page.waitForTimeout(800);
  };

  expect((await progress()) === 0, 'はじめは 0まい');
  await startCpu('d1');
  const p1 = await progress();
  expect(p1 >= 4 && p1 <= 6, `1試合目：最初の手札を配った時点でセーブに入った（${p1}まい）`);
  // 試合を途中でやめる（メニューへ。リザルトには行かない）
  await page.evaluate(() => window.__otecaGo('menu'));
  await page.locator('.menu-scene').waitFor();
  expect((await progress()) === p1, `途中でやめても残る（${await progress()}まい）`);
  // 2試合目：続きから
  await startCpu('d2');
  const p2 = await progress();
  expect(p2 >= p1 + 4, `2試合目は続きから足す（${p1} → ${p2}まい）`);
  // 開発時の StrictMode でも最初の手札を2回数えない（手札の枚数ぶんだけ増える）
  expect(p2 - p1 === (await hand()), `最初の手札は1回だけ数える（+${p2 - p1}、手札 ${await hand()}まい）`);
  expect(errors.length === 0, `エラーなし ${errors.slice(0, 3).join(' / ')}`);
} finally {
  await browser.close();
}
console.log(problems.length ? `問題 ${problems.length}件` : 'すべて OK');
process.exit(problems.length ? 1 : 0);
