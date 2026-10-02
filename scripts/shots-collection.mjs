// カードの所持・デッキ20個（UPDATE_v2 §3・SPEC §7 S02）の確認：にほんご／日本語 で画面を撮り、文字のはみ出しを調べる。
// 古いセーブ（形式版数3）から移行した人の「アップデートの おしらせ」と、移行したデッキが使えることも確かめる。
// 使い方：npm run dev を動かしたまま node scripts/shots-collection.mjs 0（1280×720）／1（844×390）
import { SIZES, launch, openPage, shot } from './pw.mjs';

const size = SIZES[Number(process.argv[2] ?? 0)];
const browser = await launch();
const { page, errors } = await openPage(browser, size);
const problems = [];

/** ボタン・枠・ふせん・カードから文字がはみ出していないか（shots-i18n.mjs と同じ調べ方） */
async function overflow(label) {
  const found = await page.evaluate(() => {
    // デッキ選択パネルは、傾いたふせん（.sticky）そのものを調べる（傾きで、まっすぐなボタンの枠から角が出るため）
    const boxes = document.querySelectorAll('.rough-btn, .rough-box, .sticky, .card-mini, .battle-card, .settings-choice__btn');
    const out = [];
    for (const box of boxes) {
      const b = box.getBoundingClientRect();
      if (b.width === 0 || b.height === 0) continue;
      const walker = document.createTreeWalker(box, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        if (!n.textContent.trim()) continue;
        let deco = false;
        for (let el = n.parentElement; el && el !== box; el = el.parentElement) {
          const pos = getComputedStyle(el).position;
          if (pos === 'absolute' || pos === 'fixed') deco = true;
          // 省略記号（…）で切っている文字は、はみ出しではない
          if (getComputedStyle(el).textOverflow === 'ellipsis') deco = true;
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
  await shot(page, `coll_${size.name}_${lang}_${name}`);
  await overflow(`${lang} ${name}`);
}

/** 開発サーバーのモジュールを使って、セーブを書きかえてから読み込み直す */
async function setSave(kind, lang) {
  await page.evaluate(
    async ({ kind, lang }) => {
      const cs = await import('/src/save/cookieStore.ts');
      const sd = await import('/src/save/saveData.ts');
      const storage = { jar: cs.browserCookieJar(), local: window.localStorage, secure: false };
      cs.wipe(storage);
      if (kind === 'old') {
        // 形式版数3（v2.0-A）の、5つとも作り込んだ人のセーブ
        const old = await import('/tests/save.oldFormat.ts');
        const no = (n, k) => Array.from({ length: k }, () => n);
        const data = {
          saveVersion: 1,
          saveCounter: 50,
          playerName: 'たろう',
          settings: { bgm: 7, se: 7, fxSpeed: 0, reduceFx: false, hints: true, lang },
          decks: [
            { name: 'おてあげ15', cards: no(1, 15) },
            { name: 'くすりまみれ', cards: [6, ...no(9, 14)] },
            { name: 'かみさま', cards: [8, ...no(5, 7), ...no(10, 7)] },
            { name: 'デッキ4', cards: [1, 2, 3] },
            { name: 'デッキ5', cards: [] },
          ],
          selectedDeck: 2,
          stats: { wins: 12, losses: 9 },
          cpuStats: [{ wins: 1, losses: 0 }, { wins: 0, losses: 0 }, { wins: 0, losses: 0 }, { wins: 0, losses: 0 }],
          coins: 0,
          collection: [],
          unlockAll: true,
          story: { cleared: [] },
        };
        cs.writeCookies(storage.jar, old.oldCookie(data, 3), false);
      } else {
        const data = sd.createDefaultSave();
        data.settings.lang = lang;
        data.saveCounter = 5;
        if (kind === 'short') {
          // トレードで おてあげ が 3枚に減った（スロット1の初期デッキは5枚入れている）
          data.collection[1] = 3;
          data.decks[1] = { name: 'つよいやつ', cards: [1, 1, 2, 2, 2, 3, 3, 7, 9, 9, 10, 10, 1, 2, 3].sort((a, b) => a - b) };
        }
        cs.persist(storage, data);
      }
    },
    { kind, lang },
  );
  await page.goto(page.url().split('?')[0] + '?debug=1');
  await page.waitForTimeout(2500);
  await page.mouse.click(size.width / 2, size.height / 2);
  await page.locator('.menu-scene').waitFor();
  await page.waitForTimeout(400);
}

const btn = (name, exact = false) => page.getByRole('button', { name, exact }).first();

for (const lang of ['hira', 'kanji']) {
  const L =
    lang === 'kanji'
      ? { deck: 'デッキ編集', back: '戻る', choose: 'デッキを選ぶ', close: '閉じる', owned: '持っている', pack: 'パック：', sort: '並び：', copy: 'ほかのスロットへコピー', cpu: 'CPU対戦', normal: '普通', friend: 'フレンド対戦', debug: 'デバッグ対戦', settings: '設定', make: 'コードを作る', later: '後で' }
      : { deck: 'デッキへんしゅう', back: 'もどる', choose: 'デッキを えらぶ', close: 'とじる', owned: 'もっている', pack: 'パック：', sort: 'ならび：', copy: 'ほかの スロットへ コピー', cpu: 'CPUたいせん', normal: 'ふつう', friend: 'フレンドたいせん', debug: 'デバッグ たいせん', settings: 'せってい', make: 'コードを つくる', later: 'あとで' };

  // ---- 古いセーブから移行した人：アップデートの おしらせ → デッキはそのまま使える
  await setSave('old', lang);
  if (!(await page.getByTestId('update-notice').count())) problems.push(`${lang} アップデートの おしらせ が出ない`);
  await snap(lang, '01_notice');
  await btn(L.later, true).click();
  await page.waitForTimeout(400);
  if (await page.getByTestId('update-notice').count()) problems.push(`${lang} おしらせ が消えない`);
  await btn(L.deck).click();
  await page.locator('.deck-scene').waitFor();
  await snap(lang, '02_migrated_deck');
  await btn(L.choose).click();
  await snap(lang, '03_migrated_picker');
  // 移行した3つの完成デッキ（1〜3）に「!」が無い
  for (const i of [0, 1, 2]) {
    if (await page.getByTestId(`deck-slot-${i}`).locator('.deck-picker__bad').count()) problems.push(`${lang} 移行したデッキ${i + 1}が使えない`);
  }
  await btn(L.close).click();
  // 読み込み直しても おしらせ は出ない
  await page.goto(page.url().split('?')[0] + '?debug=1');
  await page.waitForTimeout(2500);
  await page.mouse.click(size.width / 2, size.height / 2);
  await page.locator('.menu-scene').waitFor();
  await page.waitForTimeout(400);
  if (await page.getByTestId('update-notice').count()) problems.push(`${lang} おしらせ が2回出た`);

  // ---- 新しく始めた人
  await setSave('new', lang);
  if (await page.getByTestId('update-notice').count()) problems.push(`${lang} 新しい人に おしらせ が出た`);
  await btn(L.deck).click();
  await page.locator('.deck-scene').waitFor();
  await snap(lang, '04_deck_new');
  // 持っていないカード（よつあし No4）をタップ → まだ もっていないよ
  await page.locator('.card-mini--tile.is-unowned').first().click();
  await snap(lang, '05_deck_not_owned');
  // もっている で絞り込み、パック・並び替えを切り替える
  await btn(L.owned, true).click();
  await btn(L.pack).click();
  await btn(L.sort).click();
  await btn(L.sort).click();
  await btn(L.sort).click();
  await snap(lang, '06_deck_filter');
  await btn(L.copy).click();
  await snap(lang, '07_copy_picker');
  await btn(L.close).click();
  await btn(L.back).click();

  // ---- 所持数が減った（足りないカード）
  await setSave('short', lang);
  await btn(L.deck).click();
  await page.locator('.deck-scene').waitFor();
  const probs = await page.getByTestId('deck-problems').textContent();
  if (!/×2/.test(probs)) problems.push(`${lang} 足りないカードが出ない：${probs}`);
  await snap(lang, '08_deck_short');
  await btn(L.choose).click();
  await snap(lang, '09_picker_short');
  await btn(L.close).click();
  await btn(L.back).click();

  // ---- CPU対戦：デッキ選択パネル（使えないデッキは押せない）
  await btn(L.cpu).click();
  await btn(L.normal).click();
  await snap(lang, '10_cpu_deck');
  if (!(await page.getByTestId('deck-slot-0').isDisabled())) problems.push(`${lang} 足りないデッキが CPU対戦で押せる`);
  await btn(L.back).click();
  await btn(L.back).click();

  // ---- フレンド対戦・デバッグ対戦
  await btn(L.friend).click();
  await snap(lang, '11_lobby');
  await btn(L.choose).click();
  await snap(lang, '12_lobby_picker');
  await btn(L.close).click();
  await btn(L.back).click();
  await btn(L.debug).click();
  await snap(lang, '13_debug');
  await btn(L.back).click();

  // ---- データ引き継ぎ：まえの たんまつでは もう つかわないでね
  await page.locator('.menu-scene__gear').click();
  await btn(L.make).click();
  await page.waitForTimeout(800);
  await snap(lang, '14_transfer');
  await btn(L.close).click();
}

console.log(size.name, problems.length ? `\n${problems.join('\n')}` : 'はみ出し・問題 なし');
console.log('errors:', errors.length ? errors : 'なし');
await browser.close();
