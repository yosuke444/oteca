// パックガチャ（UPDATE_v2 E・SPEC §7 S09）の確認：にほんご／日本語 で画面を撮る。
// 店 → なかみ → 3まい（ノーマル）→ 15まい（スキップ）→ ダブル＋スーパーレア（乱数を決めて）→ 換金、コインが足りない時。
// 引いた直後に読み込み直しても「コインだけ減ってカードが増えない」ことが無いかも確かめる。
// 使い方：npm run dev を動かしたまま node scripts/shots-gacha.mjs 0（1280×720）／1（844×390）
import { SIZES, launch, openPage, shot } from './pw.mjs';

const size = SIZES[Number(process.argv[2] ?? 0)];
const browser = await launch();
const { page, errors } = await openPage(browser, size);
const problems = [];

async function setSave(lang, patch) {
  await page.evaluate(
    async ({ lang, patch }) => {
      const cs = await import('/src/save/cookieStore.ts');
      const sd = await import('/src/save/saveData.ts');
      const storage = { jar: cs.browserCookieJar(), local: window.localStorage, secure: false };
      cs.wipe(storage);
      const data = sd.createDefaultSave();
      data.settings.lang = lang;
      data.saveCounter = 3;
      data.loginBonus.lastDate = 99999999; // ログボの箱を出さない
      Object.assign(data, patch.top ?? {});
      for (const [no, n] of Object.entries(patch.collection ?? {})) data.collection[no] = n;
      cs.persist(storage, data);
    },
    { lang, patch },
  );
}

async function toGacha(lang) {
  await page.goto(page.url().split('?')[0] + '?debug=1');
  await page.waitForTimeout(2500);
  await page.mouse.click(size.width / 2, size.height / 2);
  await page.locator('.menu-scene').waitFor();
  await page.getByRole('button', { name: lang === 'kanji' ? 'パックガチャ' : 'パックガチャ' }).click();
  await page.getByTestId('gacha-scene').waitFor();
  await page.waitForTimeout(600);
}

/** 今のセーブ（Cookie・localStorage から読む） */
async function readSave() {
  return page.evaluate(async () => {
    const cs = await import('/src/save/cookieStore.ts');
    const d = cs.load({ jar: cs.browserCookieJar(), local: window.localStorage, secure: false });
    return { coins: d.coins, total: Object.values(d.collection).reduce((a, b) => a + b, 0) };
  });
}

/** 乱数を決める：最初の n 回は 0（ダブル・スーパーレア・先頭のカード）、そのあとは ふつうの乱数 */
async function forceLuck(n) {
  await page.evaluate((n) => {
    const real = crypto.getRandomValues.bind(crypto);
    let left = n;
    crypto.getRandomValues = (a) => {
      if (left > 0 && a instanceof Uint32Array && a.length === 1) {
        left -= 1;
        a[0] = 0;
        return a;
      }
      return real(a);
    };
  }, n);
}

async function snap(lang, name) {
  await page.waitForTimeout(300);
  await shot(page, `gacha_${size.name}_${lang}_${name}`);
}

for (const lang of ['hira', 'kanji']) {
  const L = lang === 'kanji' ? { all: '全部開ける', summary: 'まとめを見る', skip: 'スキップ', shop: 'パックを選ぶ', yes: '替える', close: '閉じる' } : { all: 'ぜんぶ あける', summary: 'まとめを みる', skip: 'スキップ', shop: 'パックを えらぶ', yes: 'かえる', close: 'とじる' };
  // かみ（No8）を1枚持っている：スーパーレアのかみを引いたら換金できる
  await setSave(lang, { top: { coins: 1000 }, collection: { 8: 1 } });
  await toGacha(lang);
  await snap(lang, '01_shop');
  await page.getByTestId('gacha-pack').click();
  await page.waitForTimeout(500);
  await snap(lang, '02_contents');
  await page.getByRole('button', { name: L.close }).last().click();
  await page.getByRole('button', { name: lang === 'kanji' ? '次のパック' : 'つぎの パック' }).click();
  await page.waitForTimeout(600);
  await snap(lang, '03_shop_next');
  await page.getByRole('button', { name: lang === 'kanji' ? '前のパック' : 'まえの パック' }).click();
  await page.waitForTimeout(600);

  // 3まい：コインが50減り、カードが3枚以上増える（読み込み直しても）
  const before = await readSave();
  await page.getByTestId('gacha-buy-three').click();
  const after = await readSave();
  if (after.coins !== before.coins - 50) problems.push(`${lang} 3まい：コイン ${before.coins} → ${after.coins}`);
  if (after.total < before.total + 3) problems.push(`${lang} 3まい：カード ${before.total} → ${after.total}`);
  await page.waitForTimeout(800);
  await snap(lang, '04_bags3');
  await page.getByTestId('gacha-bag-0').click({ force: true });
  await page.waitForTimeout(700);
  await snap(lang, '05_reveal_normal');
  // 演出が終わって「タップで つぎへ」が出てから閉じる（ダブルの時は長い）
  await page.locator('.gacha-reveal__next').waitFor({ timeout: 15000 });
  await page.getByTestId('gacha-reveal').click();
  await page.getByTestId('gacha-reveal').waitFor({ state: 'detached' });
  await page.getByRole('button', { name: L.all }).click();
  await page.getByRole('button', { name: L.summary }).waitFor({ timeout: 30000 });
  await snap(lang, '06_bags3_opened');
  await page.getByRole('button', { name: L.summary }).click();
  await snap(lang, '07_summary3');
  await page.getByRole('button', { name: L.shop }).click();

  // ダブル＋スーパーレア（乱数を決める）：1袋目がダブルで、2枚ともスーパーレア（かみ）
  await forceLuck(5);
  await page.getByTestId('gacha-buy-three').click();
  await page.waitForTimeout(1200);
  await snap(lang, '08_bags_super');
  // 震えている袋（スーパーレア）は止まらないので force で押す
  await page.getByTestId('gacha-bag-0').click({ force: true });
  await page.waitForTimeout(1300);
  await snap(lang, '09_reveal_double_super');
  await page.waitForTimeout(1800);
  await snap(lang, '10_reveal_double_super_done');
  await page.locator('.gacha-reveal__next').waitFor({ timeout: 15000 });
  await page.getByTestId('gacha-reveal').click();
  await page.getByTestId('gacha-reveal').waitFor({ state: 'detached' });
  await page.getByRole('button', { name: L.skip }).click();
  await snap(lang, '11_summary_convert');
  // 換金：すでに持っていた かみ → 50コイン
  const c0 = await readSave();
  const convert = page.locator('.gacha-summary__convert').first();
  if (!(await convert.count())) problems.push(`${lang} 換金のボタンが無い`);
  else {
    await convert.click();
    await snap(lang, '12_convert_confirm');
    await page.getByRole('button', { name: L.yes, exact: true }).click();
    const c1 = await readSave();
    if (c1.coins !== c0.coins + 50 || c1.total !== c0.total - 1) problems.push(`${lang} 換金：${JSON.stringify(c0)} → ${JSON.stringify(c1)}`);
  }
  await page.getByRole('button', { name: L.shop }).click();

  // 15まい：5×3 → スキップ
  await page.getByTestId('gacha-buy-fifteen').click();
  await page.waitForTimeout(1200);
  await snap(lang, '13_bags15');
  await page.getByRole('button', { name: L.skip }).click();
  await snap(lang, '14_summary15');
  await page.getByRole('button', { name: L.shop }).click();

  // 引いた直後に読み込み直す：コインとカードの両方が変わっている（片方だけにならない）
  const r0 = await readSave();
  await page.getByTestId('gacha-buy-three').click();
  await page.reload();
  await page.waitForTimeout(2000);
  const r1 = await readSave();
  if (r1.coins !== r0.coins - 50 || r1.total < r0.total + 3) problems.push(`${lang} 読み込み直し：${JSON.stringify(r0)} → ${JSON.stringify(r1)}`);

  // コインが足りない
  await setSave(lang, { top: { coins: 30 } });
  await toGacha(lang);
  // 押せない（えんぴつ色の）ボタンも、押すと「コインが たりないよ」
  await page.getByTestId('gacha-buy-three').click({ force: true });
  await snap(lang, '15_no_coins');
  if (!(await page.locator('.gacha-scene__msg').count())) problems.push(`${lang} コインが たりないよ が出ない`);
  const n0 = await readSave();
  if (n0.coins !== 30) problems.push(`${lang} コインが足りないのに減った：${n0.coins}`);
}

console.log(size.name, problems.length ? `\n${problems.join('\n')}` : '問題 なし');
console.log('errors:', errors.length ? errors : 'なし');
await browser.close();
