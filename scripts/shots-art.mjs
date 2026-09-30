// イラスト・おてあげの絵の確認：タイトル・メニュー・デッキ編集・ルール・対戦画面・スタンプ・リザルト・よこむきにしてね を撮る
// 使い方：npm run dev を動かしたまま node scripts/shots-art.mjs 0（1280×720）／1（844×390）
import { SIZES, clickText, launch, openPage, shot, toMenu, waitIdle } from './pw.mjs';

const size = SIZES[Number(process.argv[2] ?? 0)];
const n = (k) => `art_${size.name}_${k}`;
const browser = await launch();
const { page, errors } = await openPage(browser, size);

/** 読み込めなかった画像（壊れた画像・404） */
const broken = () =>
  page.evaluate(() => [...document.images].filter((i) => i.complete && i.naturalWidth === 0).map((i) => i.getAttribute('src')));
const notFound = [];
page.on('response', (r) => {
  if (r.status() >= 400 && /\.(png|mp3)$/.test(r.url())) notFound.push(`${r.status()} ${r.url()}`);
});

// タイトル（ロゴを書き終わるまで待つ）
await page.waitForTimeout(3500);
await shot(page, n('01_title'));
const titleArt = await page.locator('.title-scene .otege-art').evaluate((el) => ({ w: el.clientWidth, blend: getComputedStyle(el).mixBlendMode, anim: getComputedStyle(el).animationName }));
console.log('タイトルの絵', JSON.stringify(titleArt));

await toMenu(page, size);
await page.waitForTimeout(900);
await shot(page, n('02_menu'));

// デッキ編集＋カード詳細（右クリック＝長押し）
await clickText(page, 'デッキへんしゅう');
await page.waitForTimeout(900);
await shot(page, n('03_deck'));
await page.locator('.card-mini--tile').first().click({ button: 'right' });
await page.waitForTimeout(400);
await shot(page, n('04_deck_detail_oteage'));
await clickText(page, 'とじる');
await page.locator('.card-mini--tile').nth(6).click({ button: 'right' });
await page.waitForTimeout(400);
await shot(page, n('05_deck_detail_revolution'));
await clickText(page, 'とじる');
console.log('デッキ編集の壊れた画像', await broken());
await clickText(page, 'もどる');

// ルールせつめい 1ページ目
await clickText(page, 'ルールせつめい');
await page.waitForTimeout(900);
await shot(page, n('06_rules_1'));
await clickText(page, 'もどる');

// 対戦画面（ひとりで両方あやつる）
await clickText(page, 'デバッグ たいせん');
await clickText(page, 'ひとりで りょうほう');
await waitIdle(page, 30000);
await page.locator('.battle-hand .battle-card:not(.is-dim)').first().click();
await clickText(page, 'バトルばに だす');
await waitIdle(page);
await page.locator('.battle-hand .battle-card:not(.is-dim)').first().click();
await clickText(page, 'バトルばに だす');
await waitIdle(page, 30000);
// ベンチにも出す
const benchCard = page.locator('.battle-hand .battle-card.is-highlight').filter({ hasNot: page.locator('.battle-card__note') }).first();
if (await benchCard.count()) {
  await benchCard.click();
  await page.locator('.battle-slot.is-drop').first().click();
  await waitIdle(page);
}
await shot(page, n('07_battle'));
await page.locator('.battle-slot--me.battle-slot--active .battle-card').click({ button: 'right', force: true });
await page.waitForTimeout(400);
await shot(page, n('08_battle_detail'));
await clickText(page, 'とじる');
console.log('対戦画面の壊れた画像', await broken());

// スタンプ「おてあげ〜」
await page.getByRole('button', { name: 'スタンプ' }).click();
await page.waitForTimeout(200);
await shot(page, n('09_stamp_picker'));
await page.getByRole('menuitem', { name: /おてあげ〜/ }).click();
await page.waitForTimeout(400);
await shot(page, n('10_stamp_balloon'));

// こうさん → リザルト（まけ）
await page.waitForTimeout(2200);
await page.locator('[aria-label="メニュー"]').click();
await clickText(page, 'おてあげする（こうさん）');
await clickText(page, 'おてあげする', { exact: true });
await page.waitForSelector('.result', { timeout: 15000 });
await page.waitForTimeout(3500);
await shot(page, n('11_result'));
console.log('リザルトの壊れた画像', await broken());

// よこむきにしてね（スマホ縦）
const portrait = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
const pp = await portrait.newPage();
await pp.goto(page.url().split('?')[0]);
await pp.waitForTimeout(800);
await pp.screenshot({ path: `screenshots/art_390x844_12_rotate.png` });

console.log('見つからなかったファイル', notFound.length ? notFound : 'なし');
console.log(size.name, 'errors:', errors.length ? errors : 'なし');
await browser.close();
