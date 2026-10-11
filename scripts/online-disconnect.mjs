// 切断と復帰の確認（SPEC §11-7。v2.4 で作り直した）。npm run dev（ポート 5175）のまま node scripts/online-disconnect.mjs
// B の通信をわざと切る（?debug=1 の window.__otecaNet.setOffline）。「切れたのは B」と分かるように B の navigator.onLine も false にする。
//  ① 12秒切る → 「あいての つうしんを まっています」と残り秒数 → 戻すと、切れている間の操作が届いて続く
//  ② 「まっています」から29秒で戻す → そのまま続く
//  ③ 切れたまま → A は30秒で「あいての つうしんが きれたので かち」。B は「つうしんが きれたよ（まけ）」→ メニュー
//  ④ 準備中（最初のおてあげを決める前）に切れる → 勝ち負けなしで待機画面へ
//  ⑤ 対戦中に B がページを閉じる → A の勝ち。B が次に開くと「まえの オンラインたいせんが…まけ」
import { boardState, SIZES, enterRoom, launch, openPage, setSpeed, shot, toMenu, BASE } from './pw.mjs';
import { step } from './online-step.mjs';

const q = process.argv[2] ?? '?debug=1';
const started = Date.now();
const log = (...a) => console.log(`[${((Date.now() - started) / 1000).toFixed(1)}s]`, ...a);
const fail = (m) => {
  throw new Error(m);
};

const bA = await launch();
const bB = await launch();
const A = { name: 'A', size: SIZES[0], ...(await openPage(bA, SIZES[0], q)) };
const B = { name: 'B', size: SIZES[1], ...(await openPage(bB, SIZES[1], q)) };
const n = (p, k) => `v24c_${p.size.name}_${p.name}_${k}`;
for (const p of [A, B]) {
  await toMenu(p.page, p.size);
  await setSpeed(p.page, 'さいそく');
}

/** B の通信を切る・戻す（onLine：B の端末のオフラインの印も変える） */
async function cut(on, onLine = true) {
  await B.page.evaluate(
    ([x, line]) => {
      window.__otecaNet.setOffline(x);
      Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => line });
    },
    [on, onLine],
  );
}
const hashOf = (p) => p.page.getByTestId('state-hash').textContent();
const st = { A: { item: true, ends: 0 }, B: { item: true, ends: 0 } };
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
  fail('A の番にならない');
}
async function startBattle(room) {
  await enterRoom(A.page, room);
  await enterRoom(B.page, room);
  await Promise.all([A.page.locator('.battle').waitFor({ timeout: 60000 }), B.page.locator('.battle').waitFor({ timeout: 60000 })]);
  log('battle', room);
}
async function readStats(p) {
  await p.page.getByRole('button', { name: 'せってい' }).click();
  const t = (await p.page.locator('.settings-panel__stats').textContent()) ?? '';
  await p.page.getByRole('button', { name: 'もどる' }).click();
  return t.replace(/\s+/g, ' ').trim();
}

const room = () => String(Date.now()).slice(-6);
await startBattle(room());

// ① 12秒の切断：切れている間に A がターンを終える → 戻ると B に届く
await untilAMain();
const before = await hashOf(B);
await cut(true);
log('① B の通信を切った');
await A.page.locator('.battle-end button').click();
await A.page.getByTestId('net-wait').waitFor({ timeout: 15000 });
await B.page.getByTestId('net-wait').waitFor({ timeout: 15000 });
const left = await A.page.getByTestId('net-wait').textContent();
log('「まっています」', left);
if (!/のこり \d+びょう/.test(left ?? '')) fail('残り秒数が出ていない');
await shot(A.page, n(A, '01_waiting'));
await shot(B.page, n(B, '01_waiting'));
if ((await hashOf(B)) !== before) fail('切れている間に B が進んだ');
await A.page.waitForTimeout(6000);
await cut(false);
await A.page.getByTestId('net-wait').waitFor({ state: 'detached', timeout: 15000 });
await B.page.getByTestId('net-wait').waitFor({ state: 'detached', timeout: 15000 });
for (let i = 0; i < 100 && (await hashOf(A)) !== (await hashOf(B)); i++) await A.page.waitForTimeout(200);
if ((await hashOf(A)) !== (await hashOf(B))) fail('① 復帰後に状態がずれている');
log('① 戻って続いた');

// ② 「まっています」から29秒で戻す → 続く
await untilAMain();
await cut(true);
await A.page.getByTestId('net-wait').waitFor({ timeout: 15000 });
const shownAt = Date.now();
log('② まっています（残り2秒＝28〜29秒たつまで待つ）');
await A.page.getByText('のこり 2びょう').waitFor({ timeout: 40000 });
log('② 戻す', ((Date.now() - shownAt) / 1000).toFixed(1), '秒');
await cut(false);
await A.page.getByTestId('net-wait').waitFor({ state: 'detached', timeout: 15000 });
if (await A.page.locator('.result').count()) fail('② 29秒で勝ちになった');
for (let i = 0; i < 100 && (await hashOf(A)) !== (await hashOf(B)); i++) await A.page.waitForTimeout(200);
if ((await hashOf(A)) !== (await hashOf(B))) fail('② 復帰後に状態がずれている');
log('② 29秒で戻って続いた');

// ③ 切れたまま → A は勝ち、B は「つうしんが きれたよ（まけ）」
const statsB0 = await (async () => {
  return '';
})();
await cut(true, false);
await A.page.getByTestId('net-wait').waitFor({ timeout: 15000 });
const cutAt = Date.now();
await A.page.locator('.result').waitFor({ timeout: 45000 });
log('③ A がリザルトへ', ((Date.now() - cutAt) / 1000).toFixed(1), '秒');
const reason = await A.page.locator('.result__reason').textContent();
log('③ A の理由', reason);
if (!reason?.includes('あいての つうしんが きれたので かち')) fail('③ 勝ちの理由が違う');
await A.page.waitForTimeout(2500);
await shot(A.page, n(A, '03_win'));
await B.page.getByText('つうしんが きれたよ').waitFor({ timeout: 15000 });
await shot(B.page, n(B, '03_selfcut'));
await B.page.getByTestId('net-lost-menu').click();
await B.page.getByRole('button', { name: 'デッキへんしゅう' }).waitFor();
await cut(false, true);
log('③ B の せいせき', await readStats(B), statsB0);
await A.page.getByRole('button', { name: /メニュー/ }).first().click();
await A.page.getByRole('button', { name: 'デッキへんしゅう' }).waitFor();
log('③ A の せいせき', await readStats(A));

// ④ 準備中に切れる → 勝ち負けなしで待機画面へ
await startBattle(room());
await cut(true, false);
log('④ 準備中に B の通信を切った');
await A.page.locator('.lobby').waitFor({ timeout: 60000 });
const note = await A.page.locator('.lobby').textContent();
if (!note?.includes('あいての つうしんが きれたので、たいせんを やめたよ')) fail('④ 待機画面のお知らせが無い');
if (await A.page.locator('.result').count()) fail('④ リザルトに進んだ');
await shot(A.page, n(A, '04_noGame'));
await B.page.locator('.lobby').waitFor({ timeout: 60000 });
await shot(B.page, n(B, '04_noGame'));
await cut(false, true);
log('④ 両方とも待機画面へ（勝ち負けなし）');

// ⑤ 対戦中に B がページを閉じる → A の勝ち。B が次に開くと負けが記録される
// 2人とも部屋番号の画面から、もどる でオンラインの画面へ（次の enterRoom で新しい部屋番号を入れる）
for (const p of [A, B]) {
  for (let i = 0; i < 4; i++) {
    if (await p.page.getByTestId('online-friend').isVisible().catch(() => false)) break;
    const ok = p.page.locator('.lobby__error-ok');
    if (await ok.isVisible().catch(() => false)) await ok.click();
    const leave = p.page.locator('.lobby-room__leave, .lobby-wait__cancel');
    if (await leave.first().isVisible().catch(() => false)) await leave.first().click();
    const back = p.page.locator('.lobby__back');
    if (await back.isVisible().catch(() => false)) await back.click();
    await p.page.waitForTimeout(600);
  }
}
await startBattle(room());
await untilAMain();
const statsBefore = await (async () => '')();
await B.page.close();
log('⑤ B がページを閉じた');
await A.page.locator('.result').waitFor({ timeout: 60000 });
log('⑤ A の理由', await A.page.locator('.result__reason').textContent());
B.page = await B.ctx.newPage();
await B.page.goto(BASE + q);
await B.page.waitForTimeout(800);
await B.page.mouse.click(B.size.width / 2, B.size.height / 2);
await B.page.getByTestId('friend-notice').waitFor({ timeout: 15000 });
log('⑤ B を開き直した：', await B.page.getByTestId('friend-notice').textContent(), statsBefore);
await shot(B.page, n(B, '05_notice'));
await B.page.getByRole('button', { name: 'わかった' }).click();
log('⑤ B の せいせき', await readStats(B));
log('errors', A.errors, B.errors);
await bA.close();
await bB.close();
