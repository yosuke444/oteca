// 4-1・4-2 の確認：2つのブラウザ（別々に起動）で同じ部屋番号に入り、最後まで対戦 → リザルト → 再戦
// A は 1280×720、B は 844×390。どちらも ?debug=1（状態ハッシュ表示）・演出「さいそく」
// 使い方：node scripts/online-play.mjs [?debug=1&net=local]（通信方式を変える時だけ）
import { SIZES, clickText, enterRoom, launch, openPage, setSpeed, shot, toMenu } from './pw.mjs';
import { step } from './online-step.mjs';

const q = process.argv[2] ?? '?debug=1';
const room = String(Date.now()).slice(-6);
const started = Date.now();
const log = (...a) => console.log(`[${((Date.now() - started) / 1000).toFixed(1)}s]`, ...a);

const bA = await launch();
const bB = await launch();
const A = { name: 'A', size: SIZES[0], ...(await openPage(bA, SIZES[0], q)) };
const B = { name: 'B', size: SIZES[1], ...(await openPage(bB, SIZES[1], q)) };
const n = (p, k) => `4_${p.size.name}_${p.name}_${k}`;

for (const p of [A, B]) {
  await toMenu(p.page, p.size);
  await setSpeed(p.page, 'さいそく');
}

// ロビー：入力 → 待機
await clickText(A.page, 'フレンドたいせん');
for (const d of room.slice(0, 3)) await A.page.getByRole('button', { name: d, exact: true }).click();
await shot(A.page, n(A, '01_lobby_input'));
await clickText(A.page, 'もどる');
await enterRoom(A.page, room);
await A.page.getByTestId('room-number').waitFor();
await shot(A.page, n(A, '02_lobby_waiting'));
await clickText(B.page, 'フレンドたいせん');
for (const d of room) await B.page.getByRole('button', { name: d, exact: true }).click();
await shot(B.page, n(B, '01_lobby_input'));
await clickText(B.page, 'へやに はいる');
await B.page.getByText('あいてが きた！').waitFor({ timeout: 45000 }).catch(() => {});
await shot(B.page, n(B, '03_found'));
await Promise.all([A.page.getByTestId('vs').waitFor({ timeout: 45000 }), B.page.getByTestId('vs').waitFor({ timeout: 45000 })]);
await shot(A.page, n(A, '04_vs'));
await shot(B.page, n(B, '04_vs'));
log('VS');
await Promise.all([A.page.locator('.battle').waitFor(), B.page.locator('.battle').waitFor()]);
log('battle');

const st = { A: { item: false, ends: 0 }, B: { item: false, ends: 0 } };
let shotOpp = false;
let shotMine = false;
let hashChecks = 0;
for (let i = 0; i < 2000; i++) {
  const ra = await step(A, st.A);
  const rb = await step(B, st.B);
  if (ra === 'over' && rb === 'over') break;
  // 相手の番の画面・自分の番の画面を1回ずつ撮る
  if (!shotOpp && st.A.ends >= 1 && (await A.page.locator('.battle-opp-banner').count())) {
    await A.page.waitForTimeout(150);
    await shot(A.page, n(A, '05_opp_turn'));
    shotOpp = true;
  }
  if (!shotMine && st.B.ends >= 1 && rb === 'acted') {
    await shot(B.page, n(B, '05_my_turn'));
    shotMine = true;
  }
  // 両方が落ち着いている時、状態ハッシュ（と操作の数）が同じ
  if (ra === 'wait' && rb === 'wait' && i % 5 === 0) {
    const [ha, hb] = await Promise.all([A.page.getByTestId('state-hash').textContent().catch(() => null), B.page.getByTestId('state-hash').textContent().catch(() => null)]);
    if (ha && hb && ha === hb) hashChecks += 1;
  }
  if (ra === 'wait' && rb === 'wait') await A.page.waitForTimeout(120);
}
await Promise.all([A.page.locator('.result').waitFor({ timeout: 30000 }), B.page.locator('.result').waitFor({ timeout: 30000 })]);
log('result. hash matched', hashChecks, 'times');
await A.page.waitForTimeout(500);
await shot(A.page, n(A, '06_result'));
await shot(B.page, n(B, '06_result'));
const tA = await A.page.locator('.result__title').textContent();
const tB = await B.page.locator('.result__title').textContent();
log('titles', tA, '/', tB);
if (!((tA.includes('かち') && tB.includes('まけ')) || (tA.includes('まけ') && tB.includes('かち')))) throw new Error('勝ち負けが食い違う');

// 再戦：A だけ押す → B に「あいても まってるよ」→ B も押す → 先攻決めから
await clickText(A.page, 'もういっかい');
await B.page.getByText('あいても まってるよ').waitFor({ timeout: 15000 });
await shot(A.page, n(A, '07_rematch_wait'));
await shot(B.page, n(B, '07_rematch_opp_waiting'));
await clickText(B.page, 'もういっかい');
await Promise.all([A.page.locator('.battle').waitFor({ timeout: 20000 }), B.page.locator('.battle').waitFor({ timeout: 20000 })]);
log('rematch started');
await A.page.waitForTimeout(800);
await shot(A.page, n(A, '08_rematch_battle'));
await shot(B.page, n(B, '08_rematch_battle'));

// 勝敗が記録されている（設定画面のせいせき）→ ここでは A が ⚙ → おてあげ で2試合目を終わらせる
await A.page.locator('[aria-label="メニュー"]').click();
await clickText(A.page, 'おてあげする（こうさん）');
await clickText(A.page, 'おてあげする', { exact: true });
await Promise.all([A.page.locator('.result').waitFor({ timeout: 30000 }), B.page.locator('.result').waitFor({ timeout: 30000 })]);
log('surrender result', await A.page.locator('.result__title').textContent(), '/', await B.page.locator('.result__title').textContent());
await clickText(A.page, 'メニューへ');
await B.page.getByText('あいては メニューに もどったよ').waitFor({ timeout: 15000 });
await shot(B.page, n(B, '09_opp_left'));
await clickText(B.page, 'メニューへ');
for (const p of [A, B]) {
  await p.page.getByRole('button', { name: 'せってい' }).click();
  log(p.name, (await p.page.locator('.settings-panel__stats').textContent()).trim());
}
log('errors A', A.errors, 'B', B.errors);
await bA.close();
await bB.close();
