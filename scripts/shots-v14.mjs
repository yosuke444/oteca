// v1.4 の確認：A 重ねがけ禁止／B 出したばかりの交代制限 を、本物の画面で操作して撮る
// デッキ編集でスロット2に「おてあげ7・やいば4・ドリンク4」を作り、デバッグ対戦（ひとりで両方）で使う
// 使い方：npm run dev を動かしたまま node scripts/shots-v14.mjs 0（1280×720）／1（844×390） [A|B]
import { SIZES, clickText, launch, openPage, shot, toMenu, waitIdle } from './pw.mjs';

const size = SIZES[Number(process.argv[2] ?? 0)];
const part = process.argv[3] ?? 'A';
const n = (k) => `v14${part}_${size.name}_${k}`;
const browser = await launch();
const { page, errors } = await openPage(browser, size);
const toast = async () => (await page.locator('.battle-toast').textContent({ timeout: 3000 }).catch(() => ''))?.trim();

await toMenu(page, size);
// デッキ編集：スロット2に おてあげ7・やいば4・ドリンク4
await clickText(page, 'デッキへんしゅう');
await page.getByRole('button', { name: 'スロット2' }).click();
const tiles = page.locator('.card-mini--tile');
const tileOf = async (name) => {
  for (let i = 0; i < (await tiles.count()); i++) if ((await tiles.nth(i).textContent()).includes(name)) return tiles.nth(i);
  throw new Error(name);
};
for (const [name, k] of [['おてあげ', 5], ['ひみつのやいば', 5], ['きみょうなドリンク', 5]]) {
  const t = await tileOf(name);
  for (let i = 0; i < k; i++) await t.click();
}
await page.waitForTimeout(300);
await clickText(page, 'もどる');

/** 手札から名前でカードを探す */
const handCard = async (name) => {
  const cards = page.locator('.battle-hand .battle-card');
  for (let i = 0; i < (await cards.count()); i++) if ((await cards.nth(i).textContent()).includes(name)) return cards.nth(i);
  return null;
};
/** デバッグ対戦（1P・2P ともスロット2）を始めて、1P のメインまで進める。手札に need が全部そろうまで やり直す */
async function startBattle(need) {
  for (let tries = 0; tries < 40; tries++) {
    await clickText(page, 'デバッグ たいせん');
    await page.getByRole('button', { name: 'デッキ2' }).nth(0).click();
    await page.getByRole('button', { name: 'デッキ2' }).nth(1).click();
    await clickText(page, 'ひとりで りょうほう');
    await waitIdle(page, 30000);
    for (let i = 0; i < 2; i++) {
      await page.locator('.battle-hand .battle-card:not(.is-dim)').first().click();
      await clickText(page, 'バトルばに だす');
      await waitIdle(page, 30000);
    }
    let okAll = true;
    for (const [name, k] of need) {
      let c = 0;
      for (const t of await page.locator('.battle-hand .battle-card').allTextContents()) if (t.includes(name)) c++;
      if (c < k) okAll = false;
    }
    if (okAll) return;
    await page.locator('[aria-label="メニュー"]').click();
    await clickText(page, 'おてあげする（こうさん）');
    await clickText(page, 'おてあげする', { exact: true });
    await page.locator('.result').waitFor();
    await clickText(page, 'メニューへ');
    await page.getByRole('button', { name: 'デッキへんしゅう' }).waitFor();
  }
  throw new Error('手札が そろわない');
}

const active = page.locator('.battle-slot--me.battle-slot--active .battle-card');
/** 確認（ベンチ・交代済みへの警告）が出たら「つかう」 */
const yes = async () => {
  if (await page.getByRole('button', { name: 'つかう' }).count()) await clickText(page, 'つかう', { exact: true });
};

if (part === 'A') {
  await startBattle([['ドリンク', 2], ['やいば', 1], ['おてあげ', 1]]);
  // ベンチに おてあげを出す（やいばを使える相手を残すため）
  await (await handCard('おてあげ')).click();
  await page.locator('.battle-slot.is-drop').first().click();
  await waitIdle(page);
  // ドリンク → バトル場
  const drink = await handCard('ドリンク');
  if (!drink) throw new Error('手札に ドリンクが ない（デッキの並び）');
  await drink.click();
  await active.click({ force: true });
  await yes();
  await waitIdle(page);
  await shot(page, n('01_after_drink'));
  // やいばを選ぶ → バトル場は えんぴつ色 → 押すと理由
  const yaiba = await handCard('やいば');
  if (yaiba) {
    await yaiba.click();
    await page.waitForTimeout(250);
    const dim = await active.evaluate((el) => el.classList.contains('is-dim'));
    await shot(page, n('02_yaiba_selected_dim'));
    await active.click({ force: true });
    const t1 = await toast();
    await shot(page, n('03_yaiba_reason'));
    console.log('ドリンク → やいば：バトル場が えんぴつ色', dim, '／一言', t1);
    await page.keyboard.press('Escape');
  }
  // ドリンクをもう一度
  const drink2 = await handCard('ドリンク');
  if (drink2) {
    await page.locator('.battle-board').click({ position: { x: 5, y: 5 } }).catch(() => {});
    await drink2.click();
    await active.click({ force: true });
    console.log('ドリンク → ドリンク：一言', await toast());
  }
  const handCount = await page.locator('.battle-hand .battle-card').count();
  console.log('手札の枚数（使えなかったアイテムは残る）', handCount);
}

console.log(size.name, 'errors:', errors.length ? errors : 'なし');
await browser.close();
