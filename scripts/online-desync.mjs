// 4-2 の確認：状態ハッシュが合わない時（SPEC §11-6）→「データの ずれが おきたよ」→ ログを ほぞん → メニューへ（記録しない）
import { SIZES, clickText, enterRoom, launch, openPage, setSpeed, shot, toMenu } from './pw.mjs';
import { step } from './online-step.mjs';

const q = process.argv[2] ?? '?debug=1';
const room = String(Date.now()).slice(-6);
const bA = await launch();
const bB = await launch();
const A = { name: 'A', size: SIZES[0], ...(await openPage(bA, SIZES[0], q)) };
const B = { name: 'B', size: SIZES[1], ...(await openPage(bB, SIZES[1], q)) };
for (const p of [A, B]) {
  await toMenu(p.page, p.size);
  await setSpeed(p.page, 'さいそく');
}
await enterRoom(A.page, room);
await enterRoom(B.page, room);
await Promise.all([A.page.locator('.battle').waitFor({ timeout: 45000 }), B.page.locator('.battle').waitFor({ timeout: 45000 })]);
// B が送るハッシュをわざと変える
await B.page.evaluate(() => window.__otecaNet.corruptHash(true));
const st = { A: { item: true, ends: 0 }, B: { item: true, ends: 0 } };
for (let i = 0; i < 400; i++) {
  if ((await A.page.getByRole('dialog').filter({ hasText: 'ずれが おきたよ' }).count()) && (await B.page.getByRole('dialog').filter({ hasText: 'ずれが おきたよ' }).count())) break;
  const ra = await step(A, st.A);
  const rb = await step(B, st.B);
  if (ra === 'wait' && rb === 'wait') await A.page.waitForTimeout(150);
}
await A.page.getByRole('dialog').filter({ hasText: 'ずれが おきたよ' }).waitFor({ timeout: 10000 });
await B.page.getByRole('dialog').filter({ hasText: 'ずれが おきたよ' }).waitFor({ timeout: 10000 });
await shot(A.page, `4-2_${A.size.name}_A_desync`);
await shot(B.page, `4-2_${B.size.name}_B_desync`);
const [download] = await Promise.all([A.page.waitForEvent('download'), clickText(A.page, 'ログを ほぞん')]);
await download.saveAs(`screenshots/4-2_desync_log.json`);
for (const p of [A, B]) {
  await clickText(p.page, 'メニューへ');
  await p.page.getByRole('button', { name: 'せってい' }).click();
  console.log(p.name, (await p.page.locator('.settings-panel__stats').textContent()).trim());
}
console.log('errors', A.errors, B.errors);
await bA.close();
await bB.close();
