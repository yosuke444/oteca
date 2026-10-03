// ことば（UPDATE_v2 §2）の確認：にほんご／日本語 で主要な画面を撮り、文字のはみ出しを調べる。
// 設定で ことば を切り替えた時に、その場で文字が変わること（I04）も確かめる。
// 使い方：npm run dev を動かしたまま node scripts/shots-i18n.mjs 0（1280×720）／1（844×390）
import { SIZES, clickText, launch, openPage, shot, toMenu, waitIdle } from './pw.mjs';

const size = SIZES[Number(process.argv[2] ?? 0)];
const browser = await launch();
const { page, errors } = await openPage(browser, size);
const problems = [];

/**
 * ボタン・枠・ふせん・カードから文字がはみ出していないか（文字の範囲が、囲みの外へ2px以上出ていないか）。
 * 枠の外にわざと置いた飾り（スーパーの S のはんこ、×2 の枚数、タブの !、枠の上辺にかかる見出し）は除く
 */
async function overflow(label) {
  const found = await page.evaluate(() => {
    const boxes = document.querySelectorAll('.rough-btn, .rough-box, .sticky, .card-mini, .battle-card, .settings-choice__btn, .deck-tab');
    const out = [];
    for (const box of boxes) {
      const b = box.getBoundingClientRect();
      if (b.width === 0 || b.height === 0) continue;
      const walker = document.createTreeWalker(box, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        if (!n.textContent.trim()) continue;
        // 枠の外にわざと置いた飾り（はんこ・枚数・見出しなど。位置を決めて置いた部品）の中の文字は調べない
        let deco = false;
        for (let el = n.parentElement; el && el !== box; el = el.parentElement) {
          const pos = getComputedStyle(el).position;
          if (pos === 'absolute' || pos === 'fixed') deco = true;
          // スクロールする欄（カードいちらん）の外に隠れている分は、はみ出しではない
          if (['auto', 'scroll'].includes(getComputedStyle(el).overflowY)) deco = true;
        }
        if (deco) continue;
        const range = document.createRange();
        range.selectNodeContents(n);
        for (const r of range.getClientRects()) {
          if (r.width === 0) continue;
          if (r.left < b.left - 2 || r.right > b.right + 2 || r.top < b.top - 2 || r.bottom > b.bottom + 2) {
            out.push(`${n.textContent.trim().slice(0, 24)}（${box.className.split(' ')[0]}）`);
            break;
          }
        }
      }
    }
    return [...new Set(out)];
  });
  if (found.length) problems.push(`${label}：${found.join(' / ')}`);
}

async function snap(lang, name) {
  await page.waitForTimeout(500);
  // 字の形（フォントの分割ファイル）が読み込み終わってから測る（読み込み中は代わりの字で行が高くなる）
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(150);
  await shot(page, `i18n_${size.name}_${lang}_${name}`);
  await overflow(`${lang} ${name}`);
}

/** 設定で ことば を選ぶ（ボタンの文字は言語に関係なく「にほんご」「日本語」） */
async function setLang(lang) {
  await page.locator('.menu-scene__gear').click();
  await page.getByRole('button', { name: lang === 'kanji' ? '日本語' : 'にほんご', exact: true }).click();
  await page.waitForTimeout(300);
}

for (const lang of ['hira', 'kanji']) {
  await page.goto(page.url().split('?')[0] + '?debug=1');
  await page.waitForTimeout(3200);
  if (lang === 'kanji') {
    // にほんご でメニューへ → 設定で 日本語 に → その場で文字が変わる（I04）
    await toMenu(page, size);
    await setLang('kanji');
    const title = await page.locator('.settings-scene__title').textContent();
    if (!title.includes('設定')) problems.push(`その場で切りかわらない（設定の題：${title}）`);
    await snap(lang, '01_settings');
    await page.getByRole('button', { name: '戻る' }).click();
    // 読み込み直さずに、メニュー・デッキ編集の文字も変わっている（I04）
    await page.locator('.menu-scene').waitFor();
    if (!(await page.getByText('デッキ編集', { exact: true }).count())) problems.push('メニューが その場で切りかわらない');
    await clickText(page, 'デッキ編集');
    if (!(await page.getByText('カード一覧').count())) problems.push('デッキ編集が その場で切りかわらない');
    await clickText(page, '戻る');
    // 保存された ことば が、読み込み直しても残る
    await page.reload();
    await page.waitForTimeout(3200);
    await snap(lang, '00_title');
    await page.mouse.click(size.width / 2, size.height / 2);
    await page.locator('.menu-scene').waitFor();
  } else {
    await snap(lang, '00_title');
    await toMenu(page, size);
    await page.locator('.menu-scene__gear').click();
    await snap(lang, '01_settings');
    await clickText(page, 'もどる');
  }
  const L = lang === 'kanji'
    ? { deck: 'デッキ編集', back: '戻る', rules: 'ルール説明', next: '次 →', cpu: 'CPU対戦', debug: 'デバッグ対戦', local: 'ひとりで両方操作する', toBench: 'バトル場に出す', surrender: 'おてあげする（降参）', yes: 'おてあげする', toMenu: 'メニューへ', friend: 'フレンド対戦', close: '閉じる' }
    : { deck: 'デッキへんしゅう', back: 'もどる', rules: 'ルールせつめい', next: 'つぎ →', cpu: 'CPUたいせん', debug: 'デバッグ たいせん', local: 'ひとりで りょうほう', toBench: 'バトルばに だす', surrender: 'おてあげする（こうさん）', yes: 'おてあげする', toMenu: 'メニューへ', friend: 'フレンドたいせん', close: 'とじる' };
  await page.waitForTimeout(600);
  await snap(lang, '02_menu');
  // デッキ編集＋アイテムの詳細
  await clickText(page, L.deck);
  await snap(lang, '03_deck');
  await page.locator('.card-mini--tile').nth(9).click({ button: 'right' });
  await snap(lang, '04_deck_item_detail');
  await clickText(page, L.close);
  await clickText(page, L.back);
  // ルールせつめい 1・5ページ
  await clickText(page, L.rules);
  await snap(lang, '05_rules_1');
  for (let i = 0; i < 4; i++) {
    await clickText(page, L.next);
    await page.waitForTimeout(650);
  }
  await snap(lang, '06_rules_5');
  await clickText(page, L.back);
  // CPU対戦の強さ
  await clickText(page, L.cpu);
  await snap(lang, '07_cpu');
  await clickText(page, L.back);
  // フレンド対戦の入力
  await page.getByTestId('menu-online').click();
  await snap(lang, '08a_online');
  await page.getByTestId('online-friend').click();
  await snap(lang, '08_lobby');
  await clickText(page, L.back);
  await clickText(page, L.back);
  // 対戦（ひとりで両方）→ 降参 → リザルト
  await clickText(page, L.debug);
  await clickText(page, L.local);
  await waitIdle(page, 30000);
  for (let i = 0; i < 2; i++) {
    await page.locator('.battle-hand .battle-card:not(.is-dim)').first().click();
    await clickText(page, L.toBench);
    await waitIdle(page, 30000);
  }
  await page.locator('.battle-hand .battle-card').first().click();
  await snap(lang, '09_battle');
  await page.keyboard.press('Escape');
  await page.locator('[aria-label="メニュー"]').click();
  await clickText(page, L.surrender);
  await clickText(page, L.yes, { exact: true });
  await page.locator('.result').waitFor();
  await page.waitForTimeout(3000);
  await snap(lang, '10_result');
  await clickText(page, L.toMenu);
  await page.locator('.menu-scene').waitFor();
  if (lang === 'kanji') {
    // 次のために にほんご へ戻す
    await setLang('hira');
  }
}
console.log(size.name, problems.length ? `\n${problems.join('\n')}` : 'はみ出し なし');
console.log('errors:', errors.length ? errors : 'なし');
await browser.close();
