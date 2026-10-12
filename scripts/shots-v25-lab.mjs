// v2.5 調べ用：カードを ためす（sandbox）で対戦を始め、ターンを進めてスクショ
import { BASE, launch, openPage } from './pw.mjs';
const size = { name: process.env.SIZE ?? '1280x720', width: +(process.env.W ?? 1280), height: +(process.env.H ?? 720) };
const browser = await launch();
const { page, errors } = await openPage(browser, size, '?debug=1&api=off');
await page.waitForTimeout(1500);
await page.evaluate(async () => {
  const cs = await import('/src/save/cookieStore.ts');
  const sd = await import('/src/save/saveData.ts');
  const d = sd.createDefaultSave();
  d.tutorial = { done: true, gachaInviteShown: true, step: 0 };
  d.loginBonus.claimedAt = Date.now();
  d.settings.fxSpeed = 2.5;
  cs.persist({ jar: cs.browserCookieJar(), local: window.localStorage, secure: false }, d);
});
await page.goto(BASE + '?debug=1&api=off');
await page.waitForTimeout(2000);
await page.mouse.click(size.width / 2, size.height / 2);
await page.locator('.stage .menu-scene').first().waitFor();
const deck = [1,1,1,2,2,2,3,3,4,4,5,5,6,6,6];
const sb = JSON.parse(process.env.SB ?? '{"p1":{"active":39,"bench":[30,29],"hand":[]},"p2":{"active":8,"bench":[6],"hand":[]}}');
const dice = JSON.parse(process.env.DICE ?? '[1,1,1,1,1,1,1,1]');
await page.evaluate(({ sb, dice, deck }) => {
  const side = (s) => ({ active: s.active, bench: s.bench, hand: s.hand, deck: [...deck] });
  window.__otecaGo('battle', { mode: 'local', decks: { p1: deck, p2: deck }, names: { p1: '1P', p2: '2P' }, seed: 'lab', me: 'p1', record: false, debug: true, sandbox: { p1: side(sb.p1), p2: side(sb.p2) }, forcedDice: dice });
}, { sb, dice, deck });
await page.locator('.stage .battle').first().waitFor();
const idle = () => page.waitForFunction(() => document.querySelector('.stage .battle-board')?.getAttribute('data-state') !== 'busy', null, { timeout: 30000 }).then(() => page.waitForTimeout(200));
await idle();
const ends = +(process.env.ENDS ?? 3);
for (let i = 0; i < ends; i++) {
  await page.locator('.stage .battle-end__btn').first().click();
  await page.waitForTimeout(300);
  await idle();
  // くりだし待ちなどの確認ダイアログ
  const ok = page.locator('.stage .dialog button').first();
  if (await ok.isVisible().catch(() => false)) { await ok.click().catch(() => {}); await idle(); }
}
await page.screenshot({ path: `screenshots/${process.env.OUT ?? 'v25_lab'}_${size.name}.png` });
console.log('errors', errors);
await browser.close();
