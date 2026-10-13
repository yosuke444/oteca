// デイリーミッション（UPDATE_v2_1 M・SPEC §7 S17）の確認：にほんご／日本語 で画面を撮る。
// メニューのアイコン（赤い丸の数字）→ パネル → うけとる（コインが飛ぶ）→ 確定のミッション → デイリーパックの開封（つぎへ）→ まとめ → +50 → メニュー。
// 受け取り忘れの自動受け取りの知らせ、パックガチャで gacha1 が進むこと、デバッグ「デイリーの じかんを すすめる」も確かめる。
// 使い方：npm run dev を動かしたまま node scripts/shots-daily.mjs 0（1280×720）／1（844×390）
import { SIZES, launch, openPage, shot } from './pw.mjs';

const size = SIZES[Number(process.argv[2] ?? 0)];
const browser = await launch();
const { page, errors } = await openPage(browser, size);
const problems = [];

/**
 * セーブを作る。missions：その日の3つ（[id, progress, claimed]）。daysAgo：その日を何日前にするか（受け取り忘れの確認）
 */
async function setSave(lang, { missions, daysAgo = 0, allClearClaimed = false, coins = 200 }) {
  await page.evaluate(
    async ({ lang, missions, daysAgo, allClearClaimed, coins }) => {
      const cs = await import('/src/save/cookieStore.ts');
      const sd = await import('/src/save/saveData.ts');
      const dl = await import('/src/daily/daily.ts');
      const storage = { jar: cs.browserCookieJar(), local: window.localStorage, secure: false };
      cs.wipe(storage);
      window.localStorage.removeItem('oteca.dailyCarry');
      const data = sd.createDefaultSave();
      data.tutorial = { done: true, gachaInviteShown: true, step: 0 };
      data.settings.lang = lang;
      data.saveCounter = 3;
      data.coins = coins;
      data.playerId = '0123456789abcdef';
      data.loginBonus.claimedAt = Date.now(); // ログボの箱を出さない
      let key = dl.cycleKeyAt(Date.now());
      for (let i = 0; i < daysAgo; i++) key = dl.prevCycleKey(key);
      data.daily = { cycleKey: key, missions: missions.map(([id, progress, claimed]) => ({ id, progress, claimed })), allClearClaimed };
      cs.persist(storage, data);
    },
    { lang, missions, daysAgo, allClearClaimed, coins },
  );
  await page.goto(page.url().split('?')[0] + '?debug=1');
  await page.waitForTimeout(2500);
  await page.mouse.click(size.width / 2, size.height / 2);
  await page.locator('.menu-scene').waitFor();
  await page.waitForTimeout(600);
}

async function readSave() {
  return page.evaluate(async () => {
    const cs = await import('/src/save/cookieStore.ts');
    const d = cs.load({ jar: cs.browserCookieJar(), local: window.localStorage, secure: false });
    return { coins: d.coins, total: Object.values(d.collection).reduce((a, b) => a + b, 0), daily: d.daily };
  });
}

async function coinsShown() {
  return Number((await page.getByTestId('coin-counter').first().textContent()).replace(/[^0-9]/g, ''));
}

async function snap(lang, name) {
  await shot(page, `daily_${size.name}_${lang}_${name}`);
}

for (const lang of ['hira', 'kanji']) {
  // 1. 2つ達成（1つは受け取り済み）・1つは途中
  await setSave(lang, { missions: [['draw20', 20, false], ['ko5', 3, false], ['gacha1', 1, true]] });
  const badge = await page.getByTestId('daily-badge').textContent().catch(() => '');
  if (badge !== '1') problems.push(`${lang} 赤い丸の数字：${badge}`);
  await snap(lang, '01_menu_badge');
  await page.getByTestId('menu-daily').click();
  await page.getByTestId('daily-panel').waitFor();
  await page.waitForTimeout(500);
  await snap(lang, '02_panel');
  if (!/\d+:\d\d:\d\d/.test((await page.locator('.daily-panel__time').textContent()) ?? '')) problems.push(`${lang} つぎの こうしんまで が無い`);
  const s0 = await readSave();
  await page.getByTestId('daily-claim-draw20').click();
  await page.waitForTimeout(350);
  await snap(lang, '03_claim_coins_fly');
  await page.waitForTimeout(1500);
  const s1 = await readSave();
  if (s1.coins !== s0.coins + 30) problems.push(`${lang} うけとる：コイン ${s0.coins} → ${s1.coins}`);
  if ((await coinsShown()) !== s0.coins + 30) problems.push(`${lang} うけとる：コインの表示 ${await coinsShown()}`);
  if (!(await page.getByTestId('daily-claim-draw20-done').count())) problems.push(`${lang} うけとった のはんこが無い`);
  await snap(lang, '04_claimed');
  if (await page.getByTestId('daily-badge').count()) problems.push(`${lang} 受け取った後も赤い丸がある`);
  await page.getByTestId('daily-close').click();

  // 2. 3つとも達成 → 確定のミッション → デイリーパックの開封
  await setSave(lang, { missions: [['item10', 10, true], ['friend1', 1, false], ['story1', 1, true]] });
  if ((await page.getByTestId('daily-badge').textContent()) !== '2') problems.push(`${lang} 3つ達成の赤い丸：${await page.getByTestId('daily-badge').textContent()}`);
  await page.getByTestId('menu-daily').click();
  await page.waitForTimeout(500);
  await snap(lang, '05_panel_allclear');
  const a0 = await readSave();
  await page.getByTestId('daily-claim-allClear').click();
  await page.getByTestId('gacha-opening').waitFor();
  const a1 = await readSave();
  if (a1.coins !== a0.coins + 50 || a1.total < a0.total + 3 || !a1.daily.allClearClaimed) problems.push(`${lang} 確定のミッション：${JSON.stringify({ a0: [a0.coins, a0.total], a1: [a1.coins, a1.total, a1.daily.allClearClaimed] })}`);
  // コインはまとめ画面まで前の枚数
  if ((await coinsShown()) !== a0.coins) problems.push(`${lang} 開封の間のコインの表示：${await coinsShown()}`);
  await page.waitForTimeout(900);
  await snap(lang, '06_daily_bags');
  await page.getByTestId('gacha-bag-0').click({ force: true });
  await page.waitForTimeout(450);
  await snap(lang, '07_daily_tear');
  let n = 0;
  for (;;) {
    await page.getByTestId('gacha-next').waitFor({ timeout: 20000 });
    if (n === 0) await snap(lang, '08_daily_reveal');
    await page.getByTestId('gacha-next').click();
    n += 1;
    await page.waitForTimeout(80);
    if (n === 1 && (await page.getByTestId(/gacha-center-/).count())) {
      await page.waitForTimeout(200);
      await snap(lang, '09_daily_center');
    }
    if (await page.getByTestId('gacha-summary').count()) break;
  }
  if (n !== 3) problems.push(`${lang} デイリーパック：つぎへ の回数 ${n}`);
  await page.waitForTimeout(400);
  await snap(lang, '10_daily_summary');
  await page.waitForTimeout(2200);
  if ((await coinsShown()) !== a0.coins + 50) problems.push(`${lang} まとめのあとのコインの表示：${await coinsShown()}`);
  await snap(lang, '11_daily_summary_coins');
  await page.getByTestId('gacha-daily-close').click();
  await page.locator('.menu-scene').waitFor();
  await page.getByTestId('menu-daily').click();
  await page.waitForTimeout(500);
  if (!(await page.getByTestId('daily-claim-allClear-done').count())) problems.push(`${lang} 確定のミッションの うけとった が無い`);
  await snap(lang, '12_panel_after');
  await page.getByTestId('daily-close').click();

  // 3. 受け取り忘れ（前の日）：開いた時に自動で受け取って知らせる
  await setSave(lang, { missions: [['ko5', 5, false], ['story1', 1, false], ['gacha1', 1, false]], daysAgo: 1 });
  await page.getByTestId('daily-carry').waitFor({ timeout: 5000 }).catch(() => problems.push(`${lang} 受け取り忘れの知らせが出ない`));
  await snap(lang, '13_carry');
  const c1 = await readSave();
  if (c1.coins !== 200 + 30 * 3 + 50) problems.push(`${lang} 受け取り忘れのコイン：${c1.coins}`);
  await page.getByTestId('daily-carry-ok').click();
  // 読み込み直しても、もう知らせは出ない
  await page.goto(page.url().split('?')[0] + '?debug=1');
  await page.waitForTimeout(2500);
  await page.mouse.click(size.width / 2, size.height / 2);
  await page.locator('.menu-scene').waitFor().catch(async (e) => {
    await snap(lang, 'xx_fail');
    throw e;
  });
  await page.waitForTimeout(600);
  if (await page.getByTestId('daily-carry').count()) problems.push(`${lang} 知らせが2回出た`);
  if ((await readSave()).coins !== c1.coins) problems.push(`${lang} 読み込み直しでコインが変わった`);

  // 4. パックガチャを引くと gacha1 が進む
  await setSave(lang, { missions: [['draw20', 0, false], ['ko5', 0, false], ['gacha1', 0, false]], coins: 500 });
  await page.getByRole('button', { name: 'パックガチャ' }).click();
  await page.getByTestId('gacha-buy-two').click();
  const g = await readSave();
  if (g.daily.missions.find((m) => m.id === 'gacha1')?.progress !== 1) problems.push(`${lang} ガチャで gacha1 が進まない：${JSON.stringify(g.daily)}`);
  await page.getByTestId('gacha-skip').click();
  // まとめ → パックを えらぶ → メニュー
  await page.getByRole('button', { name: lang === 'kanji' ? '戻る' : 'もどる' }).first().click();
  await page.getByRole('button', { name: lang === 'kanji' ? '戻る' : 'もどる' }).first().click();
  await page.locator('.menu-scene').waitFor();
  if ((await page.getByTestId('daily-badge').textContent().catch(() => '')) !== '1') problems.push(`${lang} ガチャのあと赤い丸が出ない`);

  // 5. デバッグ「デイリーの じかんを すすめる」→ メニューで入れ替わる
  await page.getByRole('button', { name: lang === 'kanji' ? 'デバッグ対戦' : 'デバッグ たいせん' }).click();
  await page.getByTestId('debug-next-daily').click();
  await page.getByRole('button', { name: lang === 'kanji' ? '戻る' : 'もどる' }).first().click();
  await page.locator('.menu-scene').waitFor();
  await page.waitForTimeout(800);
  const d2 = await readSave();
  if (d2.daily.missions.some((m) => m.progress !== 0)) problems.push(`${lang} じかんを すすめても入れ替わらない：${JSON.stringify(d2.daily)}`);
  if (!(await page.getByTestId('daily-carry').count())) problems.push(`${lang} じかんを すすめた後、gacha1 の受け取り忘れの知らせが出ない`);
  await snap(lang, '14_after_debug_next');
}

console.log(size.name, problems.length ? `\n${problems.join('\n')}` : '問題 なし');
console.log('errors:', errors.length ? errors : 'なし');
await browser.close();
