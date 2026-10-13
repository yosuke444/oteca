// パックガチャ（UPDATE_v2 E・SPEC §7 S09）の確認：にほんご／日本語 で画面を撮る。
// 店 → なかみ → 3まい（1袋目を開けて「つぎへ」で最後まで）→ 光る袋・光ったのにノーマル・サプライズ（乱数を決めて。v2.2）→ 換金
// → 15まい（「つぎへ」で15袋を最後まで。最後の金色の確定の袋。v2.2）→ 15まい（ぜんぶ スキップ）、コインが足りない時。
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
      data.tutorial = { done: true, gachaInviteShown: true, step: 0 }; // チュートリアルを終えた人（タイトルからメニューへ）
      data.settings.lang = lang;
      data.saveCounter = 3;
      data.loginBonus.claimedAt = Date.now(); // ログボの箱を出さない（受け取ったばかり）
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

/** 乱数を決める：最初の何回かは values（0〜1）の順、そのあとは ふつうの乱数 */
async function forceLuck(values) {
  await page.evaluate((values) => {
    const real = crypto.getRandomValues.bind(crypto);
    const left = [...values];
    crypto.getRandomValues = (a) => {
      if (left.length && a instanceof Uint32Array && a.length === 1) {
        a[0] = Math.floor(left.shift() * 2 ** 32);
        return a;
      }
      return real(a);
    };
  }, values);
}

/** 「つぎへ」を押していき、まとめ画面まで進む（v2.1-K）。押した回数を返す */
async function nextToSummary(lang, shotAt = {}) {
  let n = 0;
  for (;;) {
    await page.getByTestId('gacha-next').waitFor({ timeout: 20000 });
    if (shotAt[n]) await snap(lang, shotAt[n]);
    await page.getByTestId('gacha-next').click();
    n += 1;
    if (await page.getByTestId('gacha-summary').count()) return n;
    // 次の袋が真ん中に滑ってきて、自動で開く
    if (n === 1 && shotAt.center) {
      await page.getByTestId(/gacha-center-/).waitFor();
      await page.waitForTimeout(150);
      await snap(lang, shotAt.center);
    }
    await page.waitForTimeout(50);
    if (await page.getByTestId('gacha-summary').count()) return n;
  }
}

async function snap(lang, name) {
  await page.waitForTimeout(300);
  await shot(page, `gacha_${size.name}_${lang}_${name}`);
}

for (const lang of ['hira', 'kanji']) {
  const L = lang === 'kanji' ? { skip: '全部スキップ', shop: 'パックを選ぶ', yes: '替える', close: '閉じる' } : { skip: 'ぜんぶ スキップ', shop: 'パックを えらぶ', yes: 'かえる', close: 'とじる' };
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
  await page.getByTestId('gacha-buy-two').click();
  const after = await readSave();
  if (after.coins !== before.coins - 50) problems.push(`${lang} 3まい：コイン ${before.coins} → ${after.coins}`);
  if (after.total < before.total + 3) problems.push(`${lang} 3まい：カード ${before.total} → ${after.total}`);
  await page.waitForTimeout(800);
  await snap(lang, '04_bags3');
  await page.getByTestId('gacha-bag-1').click({ force: true });
  await page.waitForTimeout(450);
  await snap(lang, '05a_sparkle_fountain');
  await page.waitForTimeout(500);
  await snap(lang, '05_reveal_normal');
  // 1袋目のあとは「つぎへ」で、次の袋が真ん中へ来て自動で開く。最後の「つぎへ」でまとめ画面へ
  const n3 = await nextToSummary(lang, { 0: '06_next_button', center: '06b_center_bag' });
  if (n3 !== 3) problems.push(`${lang} 3まい：つぎへ の回数 ${n3}`);
  await snap(lang, '07_summary3');
  await page.getByRole('button', { name: L.shop }).click();

  // 光る袋（v2.2。乱数を決める。1袋に [スーパーか・どれか・光るか] の3つ）：
  // 1袋目 光ってスーパー（かみ）、2袋目 光ったのにノーマル（…ぺらっ）、3袋目 光らずスーパー（サプライズ）
  await forceLuck([0.01, 0.0, 0.1, 0.5, 0.0, 0.01, 0.01, 0.0, 0.95]);
  await page.getByTestId('gacha-buy-two').click();
  await page.waitForTimeout(1200);
  await snap(lang, '08_bags_glow');
  const glows = await page.locator('[data-testid^="gacha-bag-"][data-glow="1"]').count();
  if (glows !== 2) problems.push(`${lang} 光る袋の数 ${glows}（2のはず）`);
  // 震えている袋（光る袋）は止まらないので force で押す
  await page.getByTestId('gacha-bag-0').click({ force: true });
  await page.waitForTimeout(1300);
  await snap(lang, '09_reveal_glow_super');
  await page.waitForTimeout(1800);
  await snap(lang, '10_reveal_glow_super_done');
  if ((await page.getByTestId('gacha-reveal').getAttribute('data-kind')) !== 'super') problems.push(`${lang} 1袋目が super の演出でない`);
  await page.getByTestId('gacha-next').waitFor({ timeout: 15000 });
  await page.getByTestId('gacha-next').click();
  // 2袋目（真ん中）：光っているのでスーパーかと思わせて、ノーマル（…ぺらっ）。キラキラは降り続ける
  await page.waitForTimeout(400);
  await snap(lang, '10b_center_glow_bag');
  if (!(await page.locator('.spark').count())) problems.push(`${lang} スーパーレアのあと キラキラが 降っていない`);
  await page.getByTestId('gacha-reveal').waitFor({ timeout: 15000 });
  await page.waitForTimeout(1500);
  await snap(lang, '10c_reveal_letdown');
  if ((await page.getByTestId('gacha-reveal').getAttribute('data-kind')) !== 'letdown') problems.push(`${lang} 2袋目が letdown の演出でない`);
  await page.getByTestId('gacha-next').waitFor({ timeout: 15000 });
  await page.getByTestId('gacha-next').click();
  // 3袋目：光らない袋から、めくった瞬間に光があふれる（サプライズ）
  await page.getByTestId('gacha-reveal').waitFor({ timeout: 15000 });
  await page.waitForTimeout(1300);
  await snap(lang, '10d_reveal_surprise');
  await page.waitForTimeout(1500);
  await snap(lang, '10e_reveal_surprise_done');
  if ((await page.getByTestId('gacha-reveal').getAttribute('data-kind')) !== 'surprise') problems.push(`${lang} 3袋目が surprise の演出でない`);
  await page.getByTestId('gacha-next').waitFor({ timeout: 15000 });
  await page.getByTestId('gacha-next').click();
  await page.getByTestId('gacha-summary').waitFor();
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

  // 15まい：5×3 → 1袋目を開けて「つぎへ」で15袋を最後まで → まとめ画面（UPDATE_v2_1 §1-4）
  await page.getByTestId('gacha-buy-ten').click();
  await page.waitForTimeout(1200);
  await snap(lang, '13_bags15');
  // 最後（15袋目）は金色の確定の袋（v2.2）
  if ((await page.getByTestId('gacha-bag-14').getAttribute('data-guaranteed')) !== '1') problems.push(`${lang} 15袋目が確定の袋でない`);
  if (!(await page.getByTestId('gacha-bag-14').getByTestId('gacha-guarantee-tag').count())) problems.push(`${lang} 確定の袋に「かくてい！」が無い`);
  await page.getByTestId('gacha-bag-0').click({ force: true });
  // 15袋目（確定の袋）が真ん中に来た所と、開いた所を撮る
  let n15 = 0;
  for (;;) {
    await page.getByTestId('gacha-next').waitFor({ timeout: 25000 });
    await page.getByTestId('gacha-next').click();
    n15 += 1;
    if (await page.getByTestId('gacha-summary').count()) break;
    if (n15 === 14) {
      await page.getByTestId('gacha-center-14').waitFor();
      await page.waitForTimeout(250);
      await snap(lang, '13b_center_guaranteed');
      await page.getByTestId('gacha-reveal').waitFor({ timeout: 15000 });
      await page.waitForTimeout(1500);
      await snap(lang, '13c_reveal_guaranteed');
      await page.waitForTimeout(1800);
      await snap(lang, '13d_reveal_guaranteed_done');
      if ((await page.getByTestId('gacha-reveal').getAttribute('data-kind')) !== 'super') problems.push(`${lang} 15袋目が super（ふつうのスーパーレアと同じ。v2.3）の演出でない`);
    }
    await page.waitForTimeout(50);
    if (await page.getByTestId('gacha-summary').count()) break;
  }
  if (n15 !== 15) problems.push(`${lang} 15まい：つぎへ の回数 ${n15}`);
  await snap(lang, '14_summary15');
  const got15 = await page.locator('.gacha-summary .prize-card').count();
  if (got15 < 15) problems.push(`${lang} 15まい：まとめのカード ${got15}`);
  await page.getByRole('button', { name: L.shop }).click();
  // 15まい：ぜんぶ スキップ
  await page.getByTestId('gacha-buy-ten').click();
  await page.waitForTimeout(800);
  await page.getByTestId('gacha-skip').click();
  await page.getByTestId('gacha-summary').waitFor();
  await page.getByRole('button', { name: L.shop }).click();

  // 引いた直後に読み込み直す：コインとカードの両方が変わっている（片方だけにならない）
  const r0 = await readSave();
  await page.getByTestId('gacha-buy-two').click();
  await page.reload();
  await page.waitForTimeout(2000);
  const r1 = await readSave();
  if (r1.coins !== r0.coins - 50 || r1.total < r0.total + 3) problems.push(`${lang} 読み込み直し：${JSON.stringify(r0)} → ${JSON.stringify(r1)}`);

  // コインが足りない
  await setSave(lang, { top: { coins: 30 } });
  await toGacha(lang);
  // 押せない（えんぴつ色の）ボタンも、押すと「コインが たりないよ」
  await page.getByTestId('gacha-buy-two').click({ force: true });
  await snap(lang, '15_no_coins');
  if (!(await page.locator('.gacha-scene__msg').count())) problems.push(`${lang} コインが たりないよ が出ない`);
  const n0 = await readSave();
  if (n0.coins !== 30) problems.push(`${lang} コインが足りないのに減った：${n0.coins}`);
}

console.log(size.name, problems.length ? `\n${problems.join('\n')}` : '問題 なし');
console.log('errors:', errors.length ? errors : 'なし');
await browser.close();
