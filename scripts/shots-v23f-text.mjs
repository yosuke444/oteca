// 「ストーリー げんてい の カードは こうかん できません」の説明（v2.3）の確認。1280×720／844×390、にほんご／日本語。
// ストーリーの せつめい（ほうしゅう）・カードトレードの せつめい（きまり）・限定カードを手に入れた時の文 を撮り、
// 文が画面・枠から切れていないかを確かめる。
// 使い方：npm run dev（ポート 5175）のまま node scripts/shots-v23f-text.mjs
import { BASE, SIZES, launch, openPage, shot } from './pw.mjs';

const TEXT = /げんていの カードは こうかん できません|限定のカードは交換できません|げんていカード・トロフィあげは こうかん できないよ|限定カード・トロフィあげは交換できないよ|トレードには だせないよ|トレードには出せないよ/;
const problems = [];
const browser = await launch();

/** 文の入った要素が、画面と いちばん近い枠（ダイアログ・説明）の中に収まっているか */
async function fits(page, tag, name) {
  const r = await page.evaluate((src) => {
    const re = new RegExp(src);
    const els = [...document.querySelectorAll('p, li, span, div')].filter((e) => re.test(e.textContent ?? '') && [...e.children].every((c) => !re.test(c.textContent ?? '')));
    const out = [];
    for (const e of els) {
      const r = e.getBoundingClientRect();
      if (r.width === 0) continue;
      if (r.left < -1 || r.top < -1 || r.right > innerWidth + 1 || r.bottom > innerHeight + 1) out.push(`画面から切れている：${e.textContent}`);
      const box = e.closest('.dialog, .guide-pages, .limited-fx');
      if (box && box !== e) {
        const b = box.getBoundingClientRect();
        if (r.left < b.left - 1 || r.right > b.right + 1 || r.bottom > b.bottom + 1) out.push(`枠からはみ出す：${e.textContent}`);
      }
      if (e.scrollWidth > e.clientWidth + 2 && getComputedStyle(e).overflow === 'hidden') out.push(`文が切れている：${e.textContent}`);
    }
    return { n: els.length, out };
  }, TEXT.source);
  if (r.n === 0) problems.push(`${tag} ${name}：文が見つからない`);
  for (const o of r.out) problems.push(`${tag} ${name}：${o}`);
  await shot(page, `v23f_${tag}_${name}`);
}

/** 詳しい説明を開いて、文のあるページまでめくる */
async function openHelp(page, mode) {
  await page.getByTestId(`mode-guide-${mode}`).getByTestId('mode-guide-help').click();
  await page.getByTestId('guide-pages').waitFor();
  for (let i = 0; i < 5; i++) {
    await page.waitForTimeout(450);
    if (TEXT.test((await page.getByTestId('guide-pages').textContent()) ?? '')) return;
    if (!(await page.getByTestId('guide-next').count())) return;
    await page.getByTestId('guide-next').click();
  }
}

try {
  for (const size of SIZES) {
    for (const lang of ['hira', 'kanji']) {
      const tag = `${size.name}_${lang}`;
      const { page, ctx, errors } = await openPage(browser, size);
      await page.evaluate(async (lang) => {
        const cs = await import('/src/save/cookieStore.ts');
        const sd = await import('/src/save/saveData.ts');
        const d = sd.createDefaultSave();
        d.tutorial = { done: true, gachaInviteShown: true, step: 0 };
        d.settings.lang = lang;
        d.loginBonus.claimedAt = Date.now();
        d.story.stages = [1, 2].map((no) => ({ no, cleared: true, firstClear: true }));
        cs.persist({ jar: cs.browserCookieJar(), local: window.localStorage, secure: false }, d);
        window.localStorage.removeItem('oteca.guideFolded');
      }, lang);
      await page.goto(BASE + '?debug=1');
      await page.waitForTimeout(2500);
      await page.mouse.click(size.width / 2, size.height / 2);
      await page.locator('.menu-scene').waitFor();
      const go = (route, payload) => page.evaluate(([r, p]) => window.__otecaGo(r, p), [route, payload ?? null]);

      await go('story');
      await page.getByTestId('story-scene').waitFor();
      await openHelp(page, 'story');
      await fits(page, tag, '01_story_help');
      await page.keyboard.press('Escape');

      await go('trade');
      await page.getByTestId('trade-scene').waitFor();
      await openHelp(page, 'trade');
      await fits(page, tag, '02_trade_help');

      await go('result', {
        setup: { mode: 'cpu', cpuLevel: 'weak', decks: { p1: [1], p2: [43] }, names: { p1: 'たろう', p2: 'おてあげニンゲン' }, seed: 'x', me: 'p1', record: false, story: { stage: 3 } },
        winner: 'p1',
        reason: 'ko',
        stats: { turns: 14, turnCounts: { p1: 7, p2: 7 }, sides: { p1: { damage: 300, kos: 3, mvpNo: 1, mvpDamage: 150 }, p2: { damage: 120, kos: 1, mvpNo: 43, mvpDamage: 120 } } },
        log: [],
        finalHash: '00000000',
      });
      await page.getByTestId('limited-fx').waitFor({ timeout: 15000 });
      await page.waitForTimeout(2600);
      await fits(page, tag, '03_story_limited');

      for (const e of errors) problems.push(`${tag} エラー：${e}`);
      await ctx.close();
      console.log(tag, 'おわり');
    }
  }
} finally {
  await browser.close();
}
console.log(problems.length ? `問題 ${problems.length}件：\n- ${problems.join('\n- ')}` : 'すべて OK');
process.exit(problems.length ? 1 : 0);
