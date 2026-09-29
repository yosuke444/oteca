// 5-1 の確認：デバッグの「えんしゅつ テスト」で §9-2 の対戦中の演出を全部再生して撮る
// 使い方：node scripts/shots-5-1.mjs 0（1280×720）／1（844×390）
import { SIZES, clickText, launch, openPage, shot, toMenu } from './pw.mjs';

const size = SIZES[Number(process.argv[2] ?? 0)];
const browser = await launch();
const { page, errors } = await openPage(browser, size);
await toMenu(page, size);
await clickText(page, 'デバッグたいせん');
await clickText(page, 'えんしゅつ テスト');
await page.getByTestId('fx-panel').waitFor();

/** 場面ごとに撮る時刻（ミリ秒、ふつう速度） */
const WHEN = {
  order: [700, 2300],
  mulligan: [500, 1200],
  reveal: [250, 900],
  turn: [500],
  turnOpp: [500],
  draw: [300],
  bench: [250, 500],
  benchOpp: [350],
  swap: [250],
  kusuri: [450, 1000],
  yaiba: [450, 800],
  drink: [700, 1300],
  spodori: [450, 900],
  dice: [500, 1250],
  hit: [2250, 2650],
  bigHit: [2280, 2700],
  heal: [2150, 2600],
  faint: [2300, 3050, 3700],
  promote: [250, 520],
  finish: [2700, 3600, 4800],
};

const durations = {};
async function playScene(id, prefix = '') {
  const btn = page.locator(`[data-scene="${id}"]`);
  await btn.click();
  const t0 = Date.now();
  for (const [i, ms] of (WHEN[id] ?? [400]).entries()) {
    const left = ms - (Date.now() - t0);
    if (left > 0) await page.waitForTimeout(left);
    if (prefix !== null) await shot(page, `5-1_${size.name}_${prefix}${id}_${i + 1}`);
  }
  // 終わるまで（ボタンが押せるようになるまで）
  await page.waitForFunction((sel) => !document.querySelector(sel)?.hasAttribute('disabled'), `[data-scene="${id}"]`, { timeout: 20000 });
  const text = await btn.textContent();
  const m = /([\d.]+)s/.exec(text ?? '');
  durations[id] = m ? Number(m[1]) : null;
}

for (const id of Object.keys(WHEN)) await playScene(id);
console.log(size.name, 'ふつう の時間', JSON.stringify(durations));
const normal = { ...durations };

// さいそく：1ターンぶん（ターン開始＋サイコロ＋ダメージ）の演出が短くなる
await clickText(page, 'さいそく', { exact: true });
for (const id of ['turn', 'hit']) await playScene(id, null);
console.log(size.name, 'さいそく', 'turn', durations.turn, 'hit', durations.hit, '（ふつう', normal.turn, normal.hit, '）');
if (!(durations.turn < normal.turn && durations.hit < normal.hit)) throw new Error('さいそく で短くならない');

// 演出をへらす：大ダメージで揺れ・フラッシュ・集中線・粒子が出ない（数字とHPバーは出る）
await clickText(page, 'ふつう', { exact: true });
await page.getByRole('button', { name: /へらす/ }).click();
await playScene('bigHit', 'reduce_');
await page.getByRole('button', { name: /へらす/ }).click();
console.log(size.name, 'errors', errors.length ? errors : 'なし');
await browser.close();
