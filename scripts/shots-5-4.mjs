// 5-4 の確認：「データを まもろう」ふせん・ルールせつめい・スタンプ・ヒント1行（ON/OFF）・オンラインでスタンプが届く
// 使い方：node scripts/shots-5-4.mjs 0（1280×720、オンラインのスタンプも）／1（844×390）
import { SIZES, clickText, enterRoom, launch, openPage, shot, toMenu, waitIdle } from './pw.mjs';

const which = Number(process.argv[2] ?? 0);
const size = SIZES[which];
const n = (k) => `5-4_${size.name}_${k}`;
const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);

const browser = await launch();
const { page, errors } = await openPage(browser, size, '');
// 8日前に初めて起動し、コードを作らずにデッキを保存した状態
await page.evaluate(() => {
  const day = 24 * 60 * 60 * 1000;
  localStorage.setItem('oteca_backup', JSON.stringify({ firstSeenAt: Date.now() - 8 * day, lastCodeAt: null, deckSavedAt: Date.now() }));
});
await page.reload();
await toMenu(page, size);
await page.waitForTimeout(900);
await page.getByText('データを まもろう').waitFor({ timeout: 5000 });
await shot(page, n('01_backup_sticky'));
log('データを まもろう ふせん');

// ルールせつめい：6ページをめくる
await clickText(page, 'ルールせつめい');
await page.waitForTimeout(700);
for (let i = 1; i <= 6; i++) {
  await shot(page, n(`02_rules_${i}`));
  if (i < 6) {
    await clickText(page, 'つぎ');
    if (i === 1) {
      await page.waitForTimeout(200);
      await shot(page, n('02_rules_pageturn'));
    }
    await page.waitForTimeout(700);
  }
}
await clickText(page, 'もどる');
log('ルール 6ページ');

// 対戦：ヒント1行とスタンプ
await page.goto(page.url().split('?')[0] + '?debug=1');
await toMenu(page, size);
await clickText(page, 'デバッグ たいせん');
await clickText(page, 'ひとりで りょうほう');
await waitIdle(page, 30000);
await shot(page, n('03_hint_on'));
const hintOn = await page.locator('.battle-hint').count();
await page.getByRole('button', { name: 'スタンプ' }).click();
await page.waitForTimeout(200);
await shot(page, n('04_stamp_picker'));
await page.getByRole('menuitem', { name: /おてあげ〜/ }).click();
await page.waitForTimeout(350);
await shot(page, n('05_stamp_balloon'));
await page.getByRole('button', { name: 'スタンプ' }).click();
await page.waitForTimeout(200);
await shot(page, n('06_stamp_cooldown'));
const cool = await page.getByText(/びょう まってね/).count();
await page.getByRole('button', { name: 'スタンプ' }).click();
await page.waitForTimeout(2600);
const gone = (await page.getByTestId('stamp-me').count()) === 0;
log('ヒント', hintOn > 0, 'クールタイム表示', cool > 0, '2秒で消える', gone);

// 設定でヒントを OFF → 対戦画面にヒントが出ない
await page.locator('[aria-label="メニュー"]').click();
await clickText(page, 'おてあげする（こうさん）');
await clickText(page, 'おてあげする', { exact: true });
await page.locator('.result').waitFor();
await clickText(page, 'メニューへ');
await page.getByRole('button', { name: 'せってい' }).click();
// 「ヒントを だす」は設定の いちばん下の オン／オフ
await page.getByRole('button', { name: 'オフ', exact: true }).last().click();
await clickText(page, 'もどる');
await clickText(page, 'デバッグ たいせん');
await clickText(page, 'ひとりで りょうほう');
await waitIdle(page, 30000).catch(() => {});
await page.waitForTimeout(1500);
const hintOff = await page.locator('.battle-hint').count();
await shot(page, n('07_hint_off'));
log('ヒント OFF で消える', hintOff === 0);
log('errors', errors.length ? errors : 'なし');
await browser.close();

// オンライン：A が送ったスタンプが B に届く（1280 の時だけ）
if (which === 0) {
  const room = String(Date.now()).slice(-6);
  const bA = await launch();
  const bB = await launch();
  const A = await openPage(bA, SIZES[0]);
  const B = await openPage(bB, SIZES[1]);
  await toMenu(A.page, SIZES[0]);
  await toMenu(B.page, SIZES[1]);
  await enterRoom(A.page, room);
  await enterRoom(B.page, room);
  await Promise.all([A.page.locator('.battle').waitFor({ timeout: 45000 }), B.page.locator('.battle').waitFor({ timeout: 45000 })]);
  await A.page.waitForTimeout(800);
  await A.page.getByRole('button', { name: 'スタンプ' }).click();
  await A.page.getByRole('menuitem', { name: 'よろしく！' }).click();
  await B.page.getByTestId('stamp-opp').waitFor({ timeout: 10000 });
  await B.page.waitForTimeout(300);
  await shot(B.page, `5-4_${SIZES[1].name}_08_stamp_received`);
  log('オンラインでスタンプが届いた。errors', A.errors, B.errors);
  await bA.close();
  await bB.close();
}
