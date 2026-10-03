// 新カード・持続効果・カードを選ぶ（UPDATE_v2 C・SPEC §8-5）の確認：にほんご／日本語 で画面を撮る。
// 「カードを ためす」で場を作り、どく・ばくだん・あとから回復・あとからドローの印、選ぶパネル、先攻1ターン目のボタンを撮る。
// 印の文字が 844×390 でも読める大きさか（画面上で 8px 以上か）も調べる。
// 使い方：npm run dev を動かしたまま node scripts/shots-cards.mjs 0（1280×720）／1（844×390）
import { SIZES, launch, openPage, shot, waitIdle } from './pw.mjs';

const size = SIZES[Number(process.argv[2] ?? 0)];
const browser = await launch();
const { page, errors } = await openPage(browser, size);
const problems = [];

/** 新しいセーブ（ことばを決める）にして、メニューまで進む */
async function freshSave(lang) {
  await page.evaluate(async (lang) => {
    const cs = await import('/src/save/cookieStore.ts');
    const sd = await import('/src/save/saveData.ts');
    const storage = { jar: cs.browserCookieJar(), local: window.localStorage, secure: false };
    cs.wipe(storage);
    const data = sd.createDefaultSave();
    data.tutorial = { done: true, gachaInviteShown: true, step: 0 }; // チュートリアルを終えた人（タイトルからメニューへ）
    data.settings.lang = lang;
    data.saveCounter = 3;
    cs.persist(storage, data);
  }, lang);
  await page.goto(page.url().split('?')[0] + '?debug=1');
  await page.waitForTimeout(2500);
  await page.mouse.click(size.width / 2, size.height / 2);
  await page.locator('.menu-scene').waitFor();
  await page.waitForTimeout(300);
}

const btn = (name, exact = false) => page.getByRole('button', { name, exact }).first();

async function snap(lang, name) {
  await page.waitForTimeout(400);
  await shot(page, `cards_${size.name}_${lang}_${name}`);
}

/** 持続効果の印の文字が、画面上で小さすぎないか（8px 以上） */
async function marksReadable(label) {
  const sizes = await page.evaluate(() =>
    [...document.querySelectorAll('.lasting-mark .num')].map((el) => {
      const r = el.getBoundingClientRect();
      return { text: el.textContent, h: r.height, fs: parseFloat(getComputedStyle(el).fontSize) * (r.height / el.offsetHeight || 1) };
    }),
  );
  if (sizes.length === 0) problems.push(`${label}：印が無い`);
  for (const s of sizes) if (s.fs < 8) problems.push(`${label}：印「${s.text}」の文字が ${s.fs.toFixed(1)}px`);
  return sizes;
}

/** カードを ためす：側（0=1P,1=2P）の枠を選んで、カードを置く */
async function place(row, slotIndex, cardName) {
  await page.locator('.lab-row').nth(row).locator('.lab-chip').nth(slotIndex).click();
  await page.locator('.lab-grid .card-mini').filter({ hasText: cardName }).first().click();
}

async function clearLab() {
  // 手札とベンチを空にする（もう一度押すと外れる）
  for (const row of [0, 1]) {
    for (const slot of [1, 2]) {
      const chip = page.locator('.lab-row').nth(row).locator('.lab-chip').nth(slot);
      await chip.click();
      await chip.click();
    }
    while ((await page.locator('.lab-row').nth(row).locator('.lab-hand__card').count()) > 0) {
      await page.locator('.lab-row').nth(row).locator('.lab-hand__card').first().click();
    }
  }
}

async function startLab(L, dice) {
  for (const d of dice) await page.locator('.lab-dice__btn').nth(d - 1).click();
  await btn(L.start).click();
  await page.locator('.battle-board').waitFor();
  await page.waitForTimeout(1000);
  await waitIdle(page, 30000);
}

async function endTurn() {
  await page.locator('.battle-end__btn').click();
  await page.waitForTimeout(200);
  await waitIdle(page, 30000);
}

async function toLab(L) {
  await btn(L.debug).click();
  await btn(L.lab).click();
  await page.locator('.lab-scene').waitFor();
  await clearLab();
  if (await page.locator('.lab-dice__btn--clear').isEnabled()) await page.locator('.lab-dice__btn--clear').click();
}

async function quitBattle(L) {
  await page.locator('[aria-label="メニュー"]').click();
  await btn(L.surrender).click();
  await btn(L.yes, true).click();
  await page.locator('.result').waitFor();
  await page.waitForTimeout(1500);
  await btn(L.toMenu).click();
  await page.locator('.menu-scene').waitFor();
}

for (const lang of ['hira', 'kanji']) {
  const L =
    lang === 'kanji'
      ? { debug: 'デバッグ対戦', lab: 'カードを試す', start: '試す！', surrender: 'おてあげする（降参）', yes: 'おてあげする', toMenu: 'メニューへ', ok: '決定', use: '使う', local: 'ひとりで両方操作する', toActive: 'バトル場に出す', deck: 'デッキ編集', close: '閉じる', back: '戻る' }
      : { debug: 'デバッグ たいせん', lab: 'カードを ためす', start: 'ためす！', surrender: 'おてあげする（こうさん）', yes: 'おてあげする', toMenu: 'メニューへ', ok: 'けってい', use: 'つかう', local: 'ひとりで りょうほう', toActive: 'バトルばに だす', deck: 'デッキへんしゅう', close: 'とじる', back: 'もどる' };
  await freshSave(lang);

  // ---- カードを ためす の画面
  await toLab(L);
  await place(0, 0, 'どくさげ');
  await place(0, 1, 'ゆきだるま');
  await place(0, 3, 'もやす');
  await place(1, 0, 'ばくだん');
  await place(1, 1, 'すりむ');
  await snap(lang, '01_lab');

  // ---- どく・ばくだん：1P どくさげ 1（10+10+10+10）→ 2P ばくだん 6（時限）
  await startLab(L, [1, 6]);
  await snap(lang, '02_battle_start');
  await endTurn();
  await marksReadable(`${lang} どく`);
  await snap(lang, '03_poison');
  await endTurn();
  await marksReadable(`${lang} どく・ばくだん`);
  await snap(lang, '04_poison_bomb');
  await quitBattle(L);

  // ---- あとからドロー・あとから回復：1P たからばこ 1（自分に999、9回後に4枚）→ くりだし ゆきだるま 4（10+10回復）
  await toLab(L);
  await place(0, 0, 'たからばこ');
  await place(0, 1, 'ゆきだるま');
  await place(1, 0, 'むつあし');
  await startLab(L, [1, 1, 4]);
  await endTurn();
  await endTurn();
  await endTurn();
  await marksReadable(`${lang} ドロー・回復`);
  await snap(lang, '05_draw_heal');
  await quitBattle(L);

  // ---- カードを選ぶ：もやす（手札を1枚捨てる）／ひきかえカード（山札から選ぶ）／ぶんぶんぶん（交代先）
  await toLab(L);
  await place(0, 0, 'もやす');
  await place(0, 1, 'ぶんぶんぶん');
  await place(0, 2, 'おてあげ');
  await place(0, 3, 'ひきかえカード');
  await place(0, 3, 'くすり');
  await place(0, 3, 'やばいつぼ');
  await place(1, 0, 'むつあし');
  await startLab(L, [1]);
  // ひきかえカード：選んで「つかう」
  await page.locator('.battle-hand .battle-card').filter({ hasText: 'ひきかえカード' }).click();
  await btn(L.use, true).click();
  await page.getByTestId('choose-panel').waitFor();
  await snap(lang, '06_choose_search');
  await page.locator('.choose-panel__card').first().click();
  await btn(L.ok, true).click();
  await waitIdle(page, 30000);
  // もやす 1：手札を1枚捨てる
  await page.locator('.battle-end__btn').click();
  await page.getByTestId('choose-panel').waitFor({ timeout: 30000 });
  await snap(lang, '07_choose_discard');
  await page.locator('.choose-panel__card').first().click();
  await btn(L.ok, true).click();
  await waitIdle(page, 30000);
  await snap(lang, '08_after_discard');
  await quitBattle(L);

  // ---- 先攻の1ターン目のボタン（ふつうの対戦）
  await btn(L.debug).click();
  await btn(L.local).click();
  await page.locator('.battle-board').waitFor();
  await page.waitForTimeout(1000);
  await waitIdle(page, 30000);
  for (let i = 0; i < 2; i++) {
    await page.locator('.battle-hand .battle-card:not(.is-dim)').first().click();
    await btn(L.toActive).click();
    await waitIdle(page, 30000);
  }
  const label = await page.locator('.battle-end__btn').textContent();
  if (!/こうげき できない|攻撃できません/.test(label ?? '')) problems.push(`${lang} 先攻1ターン目のボタン：${label}`);
  await snap(lang, '09_first_turn');
  await quitBattle(L);

  // ---- デッキ編集：全48種
  await btn(L.deck).click();
  await page.locator('.deck-scene').waitFor();
  await snap(lang, '10_deck_list');
  await page.locator('.list-panel__grid').evaluate((el) => el.scrollTo(0, el.scrollHeight));
  await snap(lang, '11_deck_list_bottom');
  await page.locator('.card-mini--tile').filter({ hasText: 'すりむ' }).click({ button: 'right' });
  await snap(lang, '12_detail_surimu');
  await btn(L.close).click();
  await page.locator('.card-mini--tile').filter({ hasText: 'たからばこ' }).click({ button: 'right' });
  await snap(lang, '13_detail_takarabako');
  await btn(L.close).click();
  await btn(L.back).click();
}

console.log(size.name, problems.length ? `\n${problems.join('\n')}` : '問題 なし');
console.log('errors:', errors.length ? errors : 'なし');
await browser.close();
