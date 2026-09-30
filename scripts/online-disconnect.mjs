// 4-2 の確認：切断と復帰（SPEC §11-7）
// B の通信をわざと切る（?debug=1 の window.__otecaNet.setOffline）。
//  ① 12秒切る → 6秒で「あいての つうしんを まっています…」→ 戻すと、切れている間の操作が届いて続く
//  ② 31秒切る → 「つうしんが きれたよ」→「もうすこし まつ」→ 戻すと続く → 最後まで対戦
import { boardState, SIZES, enterRoom, launch, openPage, setSpeed, shot, toMenu } from './pw.mjs';
import { step } from './online-step.mjs';

const q = process.argv[2] ?? '?debug=1';
const room = String(Date.now()).slice(-6);
const started = Date.now();
const log = (...a) => console.log(`[${((Date.now() - started) / 1000).toFixed(1)}s]`, ...a);

const bA = await launch();
const bB = await launch();
const A = { name: 'A', size: SIZES[0], ...(await openPage(bA, SIZES[0], q)) };
const B = { name: 'B', size: SIZES[1], ...(await openPage(bB, SIZES[1], q)) };
const n = (p, k) => `4-2_${p.size.name}_${p.name}_${k}`;
for (const p of [A, B]) {
  await toMenu(p.page, p.size);
  await setSpeed(p.page, 'さいそく');
}
await enterRoom(A.page, room);
await enterRoom(B.page, room);
await Promise.all([A.page.locator('.battle').waitFor({ timeout: 45000 }), B.page.locator('.battle').waitFor({ timeout: 45000 })]);
log('battle');

const st = { A: { item: true, ends: 0 }, B: { item: true, ends: 0 } };
const offline = (p, v) => p.page.evaluate((x) => window.__otecaNet.setOffline(x), v);
const hashOf = (p) => p.page.getByTestId('state-hash').textContent();
/** A が自分のメインの番で、落ち着くまで両者を進める */
async function untilAMain() {
  for (let i = 0; i < 400; i++) {
    const endA = A.page.locator('.battle-end button');
    const state = await boardState(A.page);
    if ((await endA.getAttribute('aria-disabled')) !== 'true' && state === 'mine' && !(await A.page.getByText('くりだす おてあげを').count())) return;
    const rb = await step(B, st.B);
    const ra = (await A.page.getByText('バトルばに だす おてあげを').count()) || (await A.page.getByText('くりだす おてあげを').count()) ? await step(A, st.A) : 'wait';
    if (ra === 'wait' && rb === 'wait') await A.page.waitForTimeout(150);
  }
  throw new Error('A の番にならない');
}

// ① 12秒の切断：切れている間に A がターンを終える → 戻ると B に届く
await untilAMain();
const before = await hashOf(B);
await offline(B, true);
const offAt = Date.now();
log('B の通信を切った');
await A.page.locator('.battle-end button').click();
await A.page.getByText('あいての つうしんを まっています').waitFor({ timeout: 15000 });
await B.page.getByText('あいての つうしんを まっています').waitFor({ timeout: 15000 });
log('両方に「まっています」');
await shot(A.page, n(A, '01_waiting_banner'));
await shot(B.page, n(B, '01_waiting_banner'));
if ((await hashOf(B)) !== before) throw new Error('切れている間に B が進んだ');
await A.page.waitForTimeout(Math.max(0, 12000 - (Date.now() - offAt)));
await offline(B, false);
log('B の通信を戻した');
await A.page.locator('.battle-netwait').waitFor({ state: 'detached', timeout: 15000 });
await B.page.locator('.battle-netwait').waitFor({ state: 'detached', timeout: 15000 });
// B に A の END_TURN が届いて、同じ状態になる
for (let i = 0; i < 100 && (await hashOf(A)) !== (await hashOf(B)); i++) await A.page.waitForTimeout(200);
const [h1, h2] = [await hashOf(A), await hashOf(B)];
log('復帰後のハッシュ', h1, '/', h2);
if (h1 !== h2) throw new Error('復帰後に状態がずれている');
await shot(B.page, n(B, '02_recovered'));

// ② 31秒の切断 → 「つうしんが きれたよ」→「もうすこし まつ」
await offline(B, true);
log('B の通信をもう一度切った（31秒）');
await A.page.getByText('つうしんが きれたよ').waitFor({ timeout: 45000 });
log('A に「つうしんが きれたよ」');
await shot(A.page, n(A, '03_lost_dialog'));
await B.page.getByText('つうしんが きれたよ').waitFor({ timeout: 10000 });
await shot(B.page, n(B, '03_lost_dialog'));
await A.page.getByRole('button', { name: 'もうすこし まつ' }).click();
await B.page.getByRole('button', { name: 'もうすこし まつ' }).click();
await A.page.getByText('あいての つうしんを まっています').waitFor({ timeout: 5000 });
await offline(B, false);
await A.page.locator('.battle-netwait').waitFor({ state: 'detached', timeout: 15000 });
log('もうすこし まつ → 戻った');

// 最後まで
for (let i = 0; i < 2000; i++) {
  const ra = await step(A, st.A);
  const rb = await step(B, st.B);
  if (ra === 'over' && rb === 'over') break;
  if (ra === 'wait' && rb === 'wait') await A.page.waitForTimeout(120);
}
await Promise.all([A.page.locator('.result').waitFor({ timeout: 30000 }), B.page.locator('.result').waitFor({ timeout: 30000 })]);
log('決着', await A.page.locator('.result__title').textContent(), '/', await B.page.locator('.result__title').textContent());
log('errors', A.errors, B.errors);
await bA.close();
await bB.close();
