// 「このモードの せつめい」（UPDATE_v2_1 O・SPEC §7 共通）の確認：にほんご／日本語 で画面を撮る。
// 各モードの最初の画面に短い説明があること、「？」で詳しい説明（ページをめくる）、たたむ → 読み込み直してもたたんだまま、を確かめる。
// 使い方：npm run dev を動かしたまま node scripts/shots-guide.mjs 0（1280×720）／1（844×390）
import { SIZES, launch, openPage, shot } from './pw.mjs';

const size = SIZES[Number(process.argv[2] ?? 0)];
const browser = await launch();
const { page, errors } = await openPage(browser, size);
const problems = [];

async function setSave(lang) {
  await page.evaluate(async (lang) => {
    const cs = await import('/src/save/cookieStore.ts');
    const sd = await import('/src/save/saveData.ts');
    const storage = { jar: cs.browserCookieJar(), local: window.localStorage, secure: false };
    cs.wipe(storage);
    window.localStorage.removeItem('oteca.guideFolded');
    const data = sd.createDefaultSave();
    data.tutorial = { done: true, gachaInviteShown: true, step: 0 };
    data.settings.lang = lang;
    data.loginBonus.claimedAt = Date.now();
    data.playerId = '0123456789abcdef';
    cs.persist(storage, data);
  }, lang);
}

async function toMenu() {
  await page.goto(page.url().split('?')[0] + '?debug=1');
  await page.waitForTimeout(2500);
  await page.mouse.click(size.width / 2, size.height / 2);
  await page.locator('.menu-scene').waitFor();
  await page.waitForTimeout(400);
}

async function snap(lang, name) {
  await page.waitForTimeout(350);
  await shot(page, `guide_${size.name}_${lang}_${name}`);
}

/** モードの最初の画面を開く */
const OPEN = {
  online: async () => page.getByTestId('menu-online').click(),
  cpu: async (lang) => page.getByRole('button', { name: lang === 'kanji' ? 'CPU対戦' : 'CPUたいせん' }).first().click(),
  story: async () => page.getByRole('button', { name: 'ストーリー', exact: true }).click(),
  gacha: async () => page.getByRole('button', { name: 'パックガチャ' }).first().click(),
  deck: async (lang) => page.getByRole('button', { name: lang === 'kanji' ? 'デッキ編集' : 'デッキへんしゅう' }).first().click(),
  trade: async () => page.getByRole('button', { name: 'カードトレード' }).first().click(),
  daily: async () => page.getByTestId('menu-daily').click(),
};

for (const lang of ['hira', 'kanji']) {
  await setSave(lang);
  for (const [mode, open] of Object.entries(OPEN)) {
    await toMenu();
    await open(lang);
    const guide = page.getByTestId(`mode-guide-${mode}`);
    await guide.waitFor({ timeout: 8000 }).catch(() => problems.push(`${lang} ${mode}：せつめいが無い`));
    if (!(await guide.count())) continue;
    await snap(lang, `${mode}_01_short`);
    const lines = await guide.locator('.mode-guide__line').count();
    if (lines < 2 || lines > 3) problems.push(`${lang} ${mode}：短い説明の行の数 ${lines}`);
    // 詳しい説明：ページをめくって最後まで
    await guide.getByTestId('mode-guide-help').click();
    await page.getByTestId('guide-pages').waitFor();
    await snap(lang, `${mode}_02_help_1`);
    let pages = 1;
    for (let i = 0; i < 5 && (await page.getByTestId('guide-next').count()); i++) {
      await page.getByTestId('guide-next').click();
      await page.waitForTimeout(450);
      pages += 1;
      await snap(lang, `${mode}_0${2 + pages - 1}_help_${pages}`);
    }
    const count = (await page.getByTestId('guide-page').textContent()) ?? '';
    if (!count.endsWith(`/ ${pages}`)) problems.push(`${lang} ${mode}：ページの数 ${count} と めくった数 ${pages}`);
    if (pages > 3) problems.push(`${lang} ${mode}：ページが3より多い`);
    // まえへ でも戻れる
    if (pages > 1) {
      await page.getByTestId('guide-prev').click();
      await page.waitForTimeout(450);
      if (!((await page.getByTestId('guide-page').textContent()) ?? '').startsWith(`${pages - 1} /`)) problems.push(`${lang} ${mode}：まえへ で戻らない`);
    }
    await page.getByTestId('guide-close').or(page.getByTestId('guide-next')).first().waitFor();
    // 閉じる（最後のページの「とじる」まで進めてから）
    for (let i = 0; i < 6 && (await page.getByTestId('guide-next').count()); i++) {
      await page.getByTestId('guide-next').click();
      await page.waitForTimeout(450);
    }
    await page.getByTestId('guide-close').click();
    // たたむ → 読み込み直しても たたんだまま（モードごと）
    await guide.getByTestId('mode-guide-fold').click();
    await snap(lang, `${mode}_09_folded`);
    await toMenu();
    await open(lang);
    await guide.waitFor();
    if (!(await guide.getByTestId('mode-guide-unfold').count())) problems.push(`${lang} ${mode}：読み込み直すと たたんだのが戻った`);
    await guide.getByTestId('mode-guide-unfold').click();
    if (!(await guide.locator('.mode-guide__line').count())) problems.push(`${lang} ${mode}：ひらけない`);
  }
  // ほかのモードには関係しない（オンラインだけ たたむ → CPU は ひらいたまま）
  await page.evaluate(() => window.localStorage.setItem('oteca.guideFolded', JSON.stringify({ online: true })));
  await toMenu();
  await OPEN.cpu(lang);
  await page.getByTestId('mode-guide-cpu').waitFor();
  if (await page.getByTestId('mode-guide-unfold').count()) problems.push(`${lang} オンラインを たたむと CPU も たたまれた`);
}

console.log(size.name, problems.length ? `\n${problems.join('\n')}` : '問題 なし');
console.log('errors:', errors.length ? errors : 'なし');
await browser.close();
