// カードトレード（v2.0-H。UPDATE_v2 §9-5・SPEC §16 H06）。2つのブラウザ・開発用の中継 ?net=dev（npm run dev のまま）
// 1. 2人が同じ部屋番号へ → あげるカードを選ぶ（相手に見える）→ これで OK → 片方が内容を変えると両者のロックが外れる
// 2. こうかんする（最終確認：デッキが使えなくなる警告）→ 両者の所持数が正しく変わる
// 3. 片側0枚（もらうものが無い側に確認）・99枚の上限
// 4. 最終確認の直後に片方のページを閉じても、カードが二重にならない（入り直すと とちゅうの交換が仕上がる）
// 使い方：node scripts/trade.mjs 0（1280×720）／1（844×390） [hira|kanji]
import { SIZES, launch, openPage, shot } from './pw.mjs';

const size = SIZES[Number(process.argv[2] ?? 0)];
const lang = process.argv[3] ?? 'hira';
const browser = await launch();
const problems = [];
const room = String(Date.now()).slice(-6);
const K = lang === 'kanji';
const L = K ? { trade: 'カードトレード', cancel: 'キャンセル' } : { trade: 'カードトレード', cancel: 'やめる' };
const N = { oteage: 1, revolution: 7, kusuri: 9, hasami: 13, kami: 8 };

async function player(name, extra) {
  const p = await openPage(browser, size, '?debug=1&net=dev');
  await p.page.evaluate(
    async ({ name, lang, extra }) => {
      const cs = await import('/src/save/cookieStore.ts');
      const sd = await import('/src/save/saveData.ts');
      const storage = { jar: cs.browserCookieJar(), local: window.localStorage, secure: false };
      cs.wipe(storage);
      window.localStorage.removeItem('oteca.tradePending');
      const d = sd.createDefaultSave();
      d.playerName = name;
      d.tutorial = { done: true, gachaInviteShown: true };
      d.settings.lang = lang;
      d.settings.fxSpeed = 2;
      d.loginBonus.lastDate = 99999999;
      for (const [no, n] of Object.entries(extra)) d.collection[no] = n;
      cs.persist(storage, d);
    },
    { name, lang, extra },
  );
  return { name, ...p };
}

async function boot(p) {
  await p.page.goto(p.page.url().split('?')[0] + '?debug=1&net=dev');
  await p.page.waitForTimeout(2000);
  await p.page.mouse.click(size.width / 2, size.height / 2);
  await p.page.locator('.menu-scene').waitFor();
}

async function enter(p) {
  await p.page.getByRole('button', { name: L.trade, exact: true }).click();
  await p.page.getByTestId('trade-room-input').waitFor();
  // とちゅうの交換がある時は、その部屋番号が はじめから入っている
  if ((await p.page.getByTestId('trade-room-input').textContent()).trim() !== room) for (const d of room) await p.page.getByRole('button', { name: d, exact: true }).click();
  await p.page.getByTestId('trade-join').click();
}

async function coll(p) {
  return p.page.evaluate(async () => {
    const cs = await import('/src/save/cookieStore.ts');
    const d = cs.load({ jar: cs.browserCookieJar(), local: window.localStorage, secure: false });
    return { c: d.collection, done: d.trade.doneIds, pending: window.localStorage.getItem('oteca.tradePending') };
  });
}

async function snap(p, n) {
  await p.page.waitForTimeout(400);
  await shot(p.page, `trade_${size.name}_${lang}_${n}_${p.name}`);
}

const lockBoth = async (A, B) => {
  await A.page.getByTestId('trade-ok').click();
  await B.page.getByTestId('trade-ok').click();
  await A.page.getByTestId('trade-go').waitFor({ timeout: 15000 });
  await B.page.getByTestId('trade-go').waitFor({ timeout: 15000 });
};

const A = await player('あおい', {});
const B = await player('ぶどう', { [N.hasami]: 5, [N.kami]: 1, [N.oteage]: 150 });
await boot(A);
await boot(B);
await snap(A, '00_menu');
await enter(A);
await snap(A, '01_waiting');
await enter(B);
await Promise.all([A.page.getByTestId('trade-opp').waitFor({ timeout: 30000 }), B.page.getByTestId('trade-opp').waitFor({ timeout: 30000 })]);

// 1. 選ぶ → 相手に見える
await A.page.getByTestId(`trade-mine-${N.revolution}`).locator('.card-mini').click();
await B.page.getByTestId(`trade-mine-${N.hasami}`).locator('.card-mini').click();
await B.page.getByTestId(`give-plus-${N.hasami}`).click();
await A.page.waitForTimeout(800);
await snap(A, '02_offers');
if (!(await A.page.getByTestId('trade-get').textContent()).includes(K ? 'はさみ' : 'はさみ')) problems.push('相手の選んだカードが見えない');
await lockBoth(A, B);
await snap(B, '03_locked');
// 片方が変えると両者のロックが外れる
await B.page.getByTestId(`give-minus-${N.hasami}`).click();
await A.page.waitForTimeout(800);
if (await A.page.getByTestId('trade-go').count()) problems.push('内容を変えたのに ロックが外れない');
if (await A.page.getByTestId('trade-opp-ok').count()) problems.push('相手の OK が残っている');
await B.page.getByTestId(`give-plus-${N.hasami}`).click();
await A.page.waitForTimeout(500);
await lockBoth(A, B);

// 2. 最終確認（デッキが使えなくなる警告）→ 交換
await A.page.getByTestId('trade-go').click();
await A.page.getByTestId('trade-confirm').waitFor();
await snap(A, '04_confirm');
if (!(await A.page.getByTestId('trade-deck-warn').count())) problems.push('レボリューションをあげるのに デッキの警告が出ない');
await A.page.getByTestId('trade-confirm-yes').click();
await A.page.getByTestId('trade-wait-opp').waitFor();
await B.page.getByTestId('trade-go').click();
await B.page.getByTestId('trade-confirm-yes').click();
await A.page.waitForTimeout(700);
await snap(A, '05_swap');
await A.page.waitForTimeout(1500);
let a = await coll(A);
let b = await coll(B);
if (a.c[N.revolution] !== undefined || a.c[N.hasami] !== 2) problems.push(`A の所持数：${JSON.stringify({ rev: a.c[N.revolution], hasami: a.c[N.hasami] })}`);
if (b.c[N.revolution] !== 2 || b.c[N.hasami] !== 3) problems.push(`B の所持数：${JSON.stringify({ rev: b.c[N.revolution], hasami: b.c[N.hasami] })}`);
if (a.done.length !== 1 || a.done[0] !== b.done[0]) problems.push(`交換ID：${a.done} / ${b.done}`);

// 3. 片側0枚：A がくすりを1枚あげ、B は何もあげない → B に確認なし、A に「なにも もらわずに」
await A.page.getByTestId(`trade-mine-${N.kusuri}`).locator('.card-mini').click();
await lockBoth(A, B);
await A.page.getByTestId('trade-go').click();
if (!(await A.page.getByTestId('trade-zero-warn').count())) problems.push('何ももらわない側に確認が出ない');
await snap(A, '06_zero');
await A.page.getByTestId('trade-confirm-no').click();
await B.page.getByTestId('trade-go').click();
if (await B.page.getByTestId('trade-zero-warn').count()) problems.push('もらう側にも 何ももらわない確認が出た');
await B.page.getByTestId('trade-confirm-no').click();
await A.page.getByTestId('trade-ok').click(); // OK を とりけす
await A.page.getByTestId(`give-minus-${N.kusuri}`).click();
// 99枚の上限：B が おてあげ（150枚持っている）を99枚まで入れる
await B.page.getByTestId('trade-ok').click();
await B.page.waitForTimeout(300);
await B.page.getByTestId(`trade-mine-${N.oteage}`).locator('.card-mini').click();
for (let i = 1; i < 99; i++) await B.page.getByTestId(`give-plus-${N.oteage}`).click();
await B.page.getByTestId(`give-plus-${N.oteage}`).click();
await B.page.getByTestId('trade-note').waitFor({ timeout: 5000 }).catch(() => problems.push('99枚を越えても「もう いれられないよ」が出ない'));
const size99 = await B.page.getByTestId('trade-give-size').textContent();
if (!size99.includes('99')) problems.push(`99枚の上限：${size99}`);
await snap(B, '07_max99');
for (let i = 0; i < 99; i++) await B.page.getByTestId(`give-minus-${N.oteage}`).click();

// 4. 最終確認の直後にページを閉じる：B が先に こうかんする → A が こうかんする（A はすぐ保存）→ A のページを閉じる
await A.page.getByTestId(`trade-mine-${N.oteage}`).locator('.card-mini').click();
await B.page.getByTestId(`trade-mine-${N.kami}`).locator('.card-mini').click();
await A.page.waitForTimeout(500);
await lockBoth(A, B);
await B.page.getByTestId('trade-go').click();
await B.page.getByTestId('trade-confirm-yes').click();
await A.page.getByTestId('trade-go').click();
await A.page.getByTestId('trade-confirm-yes').click();
await A.page.close();
await B.page.waitForTimeout(1500);
const aPage = await A.ctx.newPage();
A.page = aPage;
await aPage.goto(B.page.url().split('?')[0] + '?debug=1&net=dev');
await aPage.waitForTimeout(1500);
a = await coll(A);
b = await coll(B);
const total = (no) => (a.c[no] ?? 0) + (b.c[no] ?? 0);
if (total(N.kami) !== 1) problems.push(`閉じたあと かみ が二重：A ${a.c[N.kami]} B ${b.c[N.kami]}`);
if (total(N.oteage) !== 155) problems.push(`閉じたあと おてあげ が合わない：A ${a.c[N.oteage]} B ${b.c[N.oteage]}`);
if (a.pending) problems.push('A に とちゅうの交換が残った');

// 5. commit を送ってすぐ（交換の保存の前に）閉じた：入り直すと仕上がる
await boot(A);
await enter(A);
await A.page.getByTestId('trade-opp').waitFor({ timeout: 30000 });
await A.page.getByTestId(`trade-mine-${N.kami}`).locator('.card-mini').click();
await A.page.waitForTimeout(500);
await lockBoth(A, B);
await A.page.getByTestId('trade-go').click();
await A.page.getByTestId('trade-confirm-yes').click();
await A.page.waitForTimeout(300);
await A.page.close(); // A は commit を送ったが、B はまだ押していない
await B.page.getByTestId('trade-go').click().catch(() => {});
await B.page.getByTestId('trade-confirm-yes').click().catch(() => {});
await B.page.waitForTimeout(1500);
const aPage2 = await A.ctx.newPage();
A.page = aPage2;
await aPage2.goto(B.page.url().split('?')[0] + '?debug=1&net=dev');
await aPage2.waitForTimeout(1500);
a = await coll(A);
b = await coll(B);
const bGot = (b.c[N.kami] ?? 0) === 1;
// B が交換を済ませていれば、A は入り直した時に仕上げる。済ませていなければ取り消す（どちらでも二重にならない）
await A.page.mouse.click(size.width / 2, size.height / 2);
await A.page.locator('.menu-scene').waitFor();
await snap(A, '08_menu_pending');
await enter(A);
await A.page.getByTestId('trade-opp').waitFor({ timeout: 30000 });
await A.page.waitForTimeout(400);
await snap(A, '09_resumed');
a = await coll(A);
b = await coll(B);
if (total(N.kami) !== 1) problems.push(`入り直したあと かみ が合わない：A ${a.c[N.kami]} B ${b.c[N.kami]}（B が済ませた：${bGot}）`);
// A が先に出ていったので B は最終確認できず、交換は取り消し（仕上げの流れは tests/trade.test.ts の H05）。どちらでも二重にならない
if (bGot !== ((a.c[N.kami] ?? 0) === 0)) problems.push('A と B で交換の結果が食い違う');
if (!(await A.page.getByTestId('trade-note').count())) problems.push('入り直した時に「とちゅうの こうかん」の知らせが出ない');
if (a.pending) problems.push('入り直しても とちゅうの交換が残った');

const errors = [A, B].flatMap((p) => p.errors.filter((e) => !/AudioContext|WebSocket/.test(e)).map((e) => `${p.name}: ${e}`));
console.log(size.name, lang, problems.length ? `\n${problems.join('\n')}` : '問題 なし');
console.log('errors:', errors.length ? errors : 'なし');
await browser.close();
