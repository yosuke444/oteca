// コイン・ログインボーナス・対戦の報酬（UPDATE_v2 D・SPEC §7 S11）の確認：にほんご／日本語 で画面を撮る。
// プレゼントボックス → 開く演出の途中 → 受け取った後（空いた箱と残り時間 時:分:秒。v2.1-L）、CPU対戦で勝った時のリザルト（+50 とコイン）。
// 「演出をへらす」でも開けること、受け取ったら読み込み直しても箱が出ないこと、
// 残りが0になると箱がリボン付きに戻ること、何日たっても1回分なことも確かめる。
// 使い方：npm run dev を動かしたまま node scripts/shots-coins.mjs 0（1280×720）／1（844×390）
import { SIZES, launch, openPage, shot } from './pw.mjs';

const size = SIZES[Number(process.argv[2] ?? 0)];
const browser = await launch();
const { page, errors } = await openPage(browser, size);
const problems = [];

/** 新しいセーブ（ことば・演出をへらす・ログボを受け取った時刻 を決める）にしてメニューまで */
async function freshSave(lang, reduceFx = false, claimedAgo = null) {
  await page.evaluate(
    async ({ lang, reduceFx, claimedAgo }) => {
      const cs = await import('/src/save/cookieStore.ts');
      const sd = await import('/src/save/saveData.ts');
      const storage = { jar: cs.browserCookieJar(), local: window.localStorage, secure: false };
      cs.wipe(storage);
      const data = sd.createDefaultSave();
      data.tutorial = { done: true, gachaInviteShown: true, step: 0 }; // チュートリアルを終えた人（タイトルからメニューへ）
      data.settings.lang = lang;
      data.settings.reduceFx = reduceFx;
      data.saveCounter = 3;
      if (claimedAgo !== null) data.loginBonus.claimedAt = Date.now() - claimedAgo;
      cs.persist(storage, data);
    },
    { lang, reduceFx, claimedAgo },
  );
  await page.goto(page.url().split('?')[0] + '?debug=1');
  await page.waitForTimeout(2500);
  await page.mouse.click(size.width / 2, size.height / 2);
  await page.locator('.menu-scene').waitFor();
  await page.waitForTimeout(500);
}

/** 空いた箱の残り時間（時:分:秒） */
async function waitText() {
  return (await page.locator('.present-wait__time').textContent({ timeout: 5000 }).catch(() => '')) ?? '';
}

async function coins() {
  return Number((await page.getByTestId('coin-counter').first().textContent()).replace(/[^0-9]/g, ''));
}

async function snap(lang, name) {
  await shot(page, `coins_${size.name}_${lang}_${name}`);
}

for (const lang of ['hira', 'kanji']) {
  await freshSave(lang);
  if (!(await page.getByTestId('present-box').count())) problems.push(`${lang} プレゼントボックスが出ない`);
  if ((await coins()) !== 200) problems.push(`${lang} 最初のコインが 200 でない：${await coins()}`);
  await snap(lang, '01_menu_present');
  await page.getByTestId('present-box').click();
  await page.waitForTimeout(1500);
  await snap(lang, '02_present_opening');
  await page.waitForTimeout(800);
  await snap(lang, '02b_present_coins');
  await page.waitForTimeout(4500);
  await snap(lang, '03_present_done');
  if ((await coins()) !== 250) problems.push(`${lang} ログボの後のコインが 250 でない：${await coins()}`);
  if (await page.getByTestId('present-box').count()) problems.push(`${lang} 受け取った後も箱がある`);
  // 受け取った後：空いた箱と、次にもらえるまでの残り時間（23:59:5x）。1秒ごとに減る
  const t1 = await waitText();
  if (!/^23:59:[45]\d$/.test(t1)) problems.push(`${lang} 受け取った直後の残り時間：${t1}`);
  await page.waitForTimeout(2100);
  const t2 = await waitText();
  if (t2 === t1) problems.push(`${lang} 残り時間が減らない：${t1} → ${t2}`);
  await snap(lang, '03b_present_wait');
  // 読み込み直しても、24時間たつまでは もう出ない
  await page.goto(page.url().split('?')[0] + '?debug=1');
  await page.waitForTimeout(2500);
  await page.mouse.click(size.width / 2, size.height / 2);
  await page.locator('.menu-scene').waitFor();
  await page.waitForTimeout(500);
  if (await page.getByTestId('present-box').count()) problems.push(`${lang} 同じ日に2回 箱が出た`);

  // CPU対戦（つよい）で勝った時のリザルト：+50 とコインが飛んでくる
  await page.evaluate(() => {
    const side = { damage: 120, kos: 3, mvpNo: 1, mvpDamage: 120 };
    window.__otecaGo('result', {
      setup: { mode: 'cpu', cpuLevel: 'strong', decks: { p1: [1], p2: [1] }, names: { p1: 'プレイヤー', p2: 'CPU' }, seed: 'x', me: 'p1', record: true },
      winner: 'p1',
      reason: 'ko',
      stats: { turns: 12, turnCounts: { p1: 6, p2: 6 }, sides: { p1: side, p2: { damage: 40, kos: 1, mvpNo: 2, mvpDamage: 40 } } },
      log: [],
      finalHash: '00000000',
    });
  });
  await page.locator('.result').waitFor();
  await page.waitForTimeout(1200);
  await snap(lang, '04_result_reward');
  await page.waitForTimeout(3500);
  await snap(lang, '05_result_reward_done');
  if ((await coins()) !== 300) problems.push(`${lang} CPU（つよい）に勝った後のコインが 300 でない：${await coins()}`);
}

// 残りが0になると、空いた箱がリボン付きに戻る（メニューを開いたまま）
for (const lang of ['hira', 'kanji']) {
  await freshSave(lang, false, 24 * 3600 * 1000 - 9000);
  const t = await waitText();
  if (!/^0:00:0[2-7]$/.test(t)) problems.push(`${lang} 残り数秒の表示：${t}`);
  await snap(lang, '07_wait_almost');
  await page.getByTestId('present-box').waitFor({ timeout: 8000 }).catch(() => problems.push(`${lang} 0 になっても箱が戻らない`));
  await page.waitForTimeout(250);
  await snap(lang, '08_present_back');
  await page.waitForTimeout(900);
  await snap(lang, '08b_present_back_done');
  // 何日たっても1回分
  await freshSave(lang, false, 5 * 24 * 3600 * 1000);
  await page.getByTestId('present-box').click();
  await page.waitForTimeout(7000);
  if ((await coins()) !== 250) problems.push(`${lang} 5日ぶりのログボで 250 でない：${await coins()}`);
  if (!/^23:59:\d\d$/.test(await waitText())) problems.push(`${lang} 5日ぶりに受け取った後の残り時間：${await waitText()}`);
}

// 演出をへらす：箱は揺れず、開けても止まらない
await freshSave('hira', true);
await page.getByTestId('present-box').click();
await page.waitForTimeout(2500);
if ((await coins()) !== 250) problems.push(`演出をへらす で ログボの後のコインが 250 でない：${await coins()}`);
await snap('hira', '06_reduce_done');

console.log(size.name, problems.length ? `\n${problems.join('\n')}` : '問題 なし');
console.log('errors:', errors.length ? errors : 'なし');
await browser.close();
