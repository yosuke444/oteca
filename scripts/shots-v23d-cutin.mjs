// ボスのカットイン（v2.3：集中線を消した）の確認。1280×720 と 844×390 で、始まりから終わりまで 0.15秒ごとに見て、
// 集中線（.paper-radial）が一度も出ないこと、ボスの絵・名前・「ボス」のはんこ・ボスルールの文字は出ることを確かめ、途中と最後を撮る。
// 使い方：npm run dev（ポート 5175）のまま node scripts/shots-v23d-cutin.mjs
import { SIZES, launch, openPage, shot } from './pw.mjs';

const problems = [];
const browser = await launch();
try {
  for (const size of SIZES) {
    const tag = size.name;
    const { page, ctx, errors } = await openPage(browser, size);
    await page.evaluate(async () => {
      const cs = await import('/src/save/cookieStore.ts');
      const sd = await import('/src/save/saveData.ts');
      const storage = { jar: cs.browserCookieJar(), local: window.localStorage, secure: false };
      const data = sd.createDefaultSave();
      data.tutorial = { done: true, gachaInviteShown: true, step: 0 };
      data.loginBonus.claimedAt = Date.now();
      data.story.stages = Array.from({ length: 14 }, (_, i) => ({ no: i + 1, cleared: true, firstClear: true }));
      cs.persist(storage, data);
    });
    await page.goto(page.url().split('?')[0] + '?debug=1');
    await page.waitForTimeout(2500);
    await page.mouse.click(size.width / 2, size.height / 2);
    await page.locator('.menu-scene').waitFor();
    await page.evaluate(() => window.__otecaGo('story'));
    await page.getByTestId('story-scene').waitFor();
    await page.waitForTimeout(800);
    await page.getByTestId('story-stage-15').click({ force: true });
    await page.getByTestId('stage-confirm').waitFor();
    await page.getByTestId('stage-go').click();
    await page.getByTestId('boss-cutin').waitFor();

    const seen = { radial: 0, art: false, name: false, stamp: false, rule: false };
    const start = Date.now();
    const shots = [
      [450, '01_enter'],
      [1100, '02_stamp'],
      [2600, '03_rule'],
    ];
    while (Date.now() - start < 3200 && (await page.getByTestId('boss-cutin').count())) {
      const s = await page.evaluate(() => {
        const root = document.querySelector('[data-testid="boss-cutin"]');
        const vis = (sel) => {
          const el = root?.querySelector(sel);
          return !!el && Number(getComputedStyle(el).opacity) > 0.5 && el.getBoundingClientRect().width > 0;
        };
        return {
          radial: document.querySelectorAll('.paper-radial').length,
          art: vis('.boss-cutin__art img') || vis('.boss-cutin__art'),
          name: vis('.boss-cutin__name'),
          stamp: !!root?.querySelector('.boss-stamp'),
          rule: (root?.querySelector('.boss-cutin__rule')?.textContent ?? '').length > 3,
        };
      });
      seen.radial = Math.max(seen.radial, s.radial);
      for (const k of ['art', 'name', 'stamp', 'rule']) seen[k] ||= s[k];
      const t = Date.now() - start;
      while (shots.length && t >= shots[0][0]) await shot(page, `v23d_${tag}_${shots.shift()[1]}`);
      await page.waitForTimeout(150);
    }
    if (seen.radial > 0) problems.push(`${tag}：集中線が出た`);
    for (const k of ['art', 'name', 'stamp', 'rule']) if (!seen[k]) problems.push(`${tag}：${k} が出なかった`);
    for (const e of errors) problems.push(`${tag} エラー：${e}`);
    console.log(tag, JSON.stringify(seen));
    await ctx.close();
  }
} finally {
  await browser.close();
}
console.log(problems.length ? `問題 ${problems.length}件：\n- ${problems.join('\n- ')}` : 'すべて OK');
process.exit(problems.length ? 1 : 0);
