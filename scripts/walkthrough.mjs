// 最後の通し確認（企画者の指示）：新しいセーブで チュートリアル → ガチャ → デッキ編集 → CPU → ストーリー → フレンド → レート → トレード、
// と、今までのセーブ（形式版数3の Cookie）からの移行。開発用の中継 ?net=dev（npm run dev のまま）。
// 使い方：node scripts/walkthrough.mjs 0（1280×720）／1（844×390）
import { SIZES, launch, openPage, shot } from './pw.mjs';

const size = SIZES[Number(process.argv[2] ?? 0)];
const browser = await launch();
const problems = [];
const log = (...a) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...a);
const Q = '?debug=1&net=dev';

async function snap(p, n) {
  await p.page.waitForTimeout(300);
  await shot(p.page, `walk_${size.name}_${n}_${p.name}`);
}

async function readSave(p) {
  return p.page.evaluate(async () => {
    const cs = await import('/src/save/cookieStore.ts');
    return cs.load({ jar: cs.browserCookieJar(), local: window.localStorage, secure: false });
  });
}

async function surrender(p) {
  await p.page.locator('.battle-board').waitFor({ timeout: 60000 });
  await p.page.waitForTimeout(2500);
  await p.page.locator('.battle-top__btn--gear').click();
  await p.page.getByRole('button', { name: 'おてあげする（こうさん）' }).click();
  await p.page.getByRole('button', { name: 'おてあげする', exact: true }).click();
  await p.page.locator('.result').waitFor({ timeout: 30000 });
}

const toMenu = async (p) => {
  await p.page.getByRole('button', { name: 'メニューへ' }).first().click();
  await p.page.locator('.menu-scene').waitFor();
};

// ---------------------------------------------------------------- チュートリアル（新しいセーブ）
const card = (p, uid) => p.page.locator(`.battle-board [data-uid="${uid}"]`).first();
async function tutorialStep(p, id) {
  const page = p.page;
  switch (id) {
    case 'dice':
      return page.getByTestId('tutorial-dice').click();
    case 'hand': {
      const box = await card(p, 'p1-0').boundingBox();
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.waitForTimeout(900);
      await page.mouse.up();
      return page.getByRole('button', { name: 'とじる', exact: true }).click();
    }
    case 'active':
      await card(p, 'p1-0').click();
      return page.getByRole('button', { name: 'バトルばに だす' }).click();
    case 'bench':
    case 'bench2':
      await card(p, id === 'bench' ? 'p1-1' : 'p1-2').click();
      return page.getByRole('button', { name: 'ベンチに だす' }).click();
    case 'firstEnd':
    case 'attack1':
    case 'attack2':
    case 'attack3':
    case 'swapEnd':
    case 'ko':
      return page.locator('.battle-end button').click();
    case 'yaiba':
    case 'kusuri':
      await card(p, id === 'yaiba' ? 'p1-3' : 'p1-4').click();
      return card(p, 'p1-0').click({ force: true });
    case 'swap':
      await card(p, 'p1-2').click();
      await page.getByRole('button', { name: 'こうたい', exact: true }).click();
      return page.getByRole('button', { name: 'こうたい する' }).click();
    case 'promote':
      return page.locator('[data-zone="p1-bench-0"] [data-uid]').first().click();
    case 'oppTurn':
      return;
    default:
      await page.locator('.guide__balloon').click();
      return page.getByTestId('tutorial-next').click();
  }
}

const A = { name: 'A', ...(await openPage(browser, size, Q)) };
await A.page.waitForTimeout(2000);
log('新しいセーブ：タイトル → なまえ');
await A.page.mouse.click(size.width / 2, size.height / 2);
await A.page.getByTestId('name-scene').waitFor();
await A.page.getByTestId('name-input').fill('あおい');
await A.page.getByTestId('name-ok').click();
log('チュートリアル');
let prev = null;
for (let i = 0; i < 40; i++) {
  await A.page.waitForFunction((prev) => {
    const g = document.querySelector('[data-testid="tutorial-guide"]');
    return g && g.getAttribute('data-step') !== prev;
  }, prev, { timeout: 60000 });
  const id = await A.page.getByTestId('tutorial-guide').getAttribute('data-step');
  await tutorialStep(A, id);
  if (id === 'free') break;
  prev = id;
}
await A.page.getByTestId('tutorial-guide').waitFor({ state: 'detached' });
await A.page.locator('.battle-top__btn--gear').click();
await A.page.getByRole('button', { name: 'おてあげする（こうさん）' }).click();
await A.page.getByRole('button', { name: 'おてあげする', exact: true }).click();
for (let i = 0; i < 3; i++) await A.page.getByTestId('tutorial-end').click();
await snap(A, '01_invite');
log('ガチャ（15まい）');
await A.page.getByTestId('tutorial-gacha').click();
await A.page.getByTestId('gacha-buy-fifteen').click();
await A.page.waitForTimeout(1200);
await A.page.getByTestId('gacha-skip').click();
await A.page.getByTestId('gacha-summary').waitFor();
await snap(A, '02_gacha');
let s = await readSave(A);
if (s.coins !== 0) problems.push(`ガチャのあとのコイン：${s.coins}`);
const cardsAfterGacha = Object.values(s.collection).reduce((a, b) => a + b, 0);
if (cardsAfterGacha < 15 + 15) problems.push(`ガチャのあとのカード：${cardsAfterGacha}`);
await A.page.getByRole('button', { name: 'もどる' }).click();
await A.page.getByRole('button', { name: 'もどる' }).click();
await A.page.locator('.menu-scene').waitFor();

log('デッキ編集');
await A.page.getByRole('button', { name: 'デッキへんしゅう' }).click();
await A.page.waitForTimeout(800);
await snap(A, '03_deck');
await A.page.getByRole('button', { name: 'もどる' }).first().click();
await A.page.locator('.menu-scene').waitFor();

log('CPU たいせん');
await A.page.getByRole('button', { name: /CPUたいせん/ }).click();
await A.page.getByTestId('cpu-scene').waitFor();
await A.page.locator('.cpu-scene__level--weak').click();
await A.page.getByTestId('deck-slot-0').click();
await A.page.getByTestId('deck-slot-0').click();
await surrender(A);
await snap(A, '04_cpu_result');
await toMenu(A);

log('ストーリー');
await A.page.getByRole('button', { name: 'ストーリー', exact: true }).click();
await A.page.getByTestId('story-stage-1').click();
await A.page.getByTestId('stage-go').click();
await surrender(A);
await A.page.getByTestId('story-stages').click();
await A.page.getByTestId('story-scene').waitFor();
await snap(A, '05_story');
await A.page.getByRole('button', { name: 'もどる' }).click();
await A.page.locator('.menu-scene').waitFor();

// 2人め（ふつうのセーブ）
const B = { name: 'B', ...(await openPage(browser, size, Q)) };
await B.page.evaluate(async () => {
  const cs = await import('/src/save/cookieStore.ts');
  const sd = await import('/src/save/saveData.ts');
  const st = { jar: cs.browserCookieJar(), local: window.localStorage, secure: false };
  const d = sd.createDefaultSave();
  d.playerName = 'ぶどう';
  d.tutorial = { done: true, gachaInviteShown: true };
  d.loginBonus.lastDate = 99999999;
  cs.persist(st, d);
});
await B.page.reload();
await B.page.waitForTimeout(2000);
await B.page.mouse.click(size.width / 2, size.height / 2);
await B.page.locator('.menu-scene').waitFor();

log('フレンドたいせん');
const room = String(Date.now()).slice(-6);
for (const p of [A, B]) {
  await p.page.getByTestId('menu-online').click();
  await p.page.getByTestId('online-friend').click();
  for (const d of room) await p.page.getByRole('button', { name: d, exact: true }).click();
  await p.page.getByRole('button', { name: 'へやに はいる' }).click();
}
await Promise.all([A, B].map((p) => p.page.locator('.battle-board').waitFor({ timeout: 60000 })));
await surrender(A);
await B.page.locator('.result').waitFor({ timeout: 30000 });
await snap(B, '06_friend_result');
for (const p of [A, B]) await toMenu(p);

log('レートたいせん');
for (const p of [A, B]) {
  await p.page.getByTestId('menu-online').click();
  await p.page.getByTestId('online-rate').click();
  await p.page.getByTestId('rate-search').click();
}
await Promise.all([A, B].map((p) => p.page.locator('.battle-board').waitFor({ timeout: 60000 })));
await surrender(B);
await Promise.all([A, B].map((p) => p.page.getByTestId('rate-change').waitFor({ timeout: 30000 })));
await snap(A, '07_rate_result');
const ra = await readSave(A);
if (ra.rate !== 110) problems.push(`レートのあと A のレート：${ra.rate}`);
for (const p of [A, B]) await toMenu(p);

log('カードトレード');
const troom = String(Date.now() + 7).slice(-6);
for (const p of [A, B]) {
  await p.page.getByRole('button', { name: 'カードトレード', exact: true }).click();
  for (const d of troom) await p.page.getByRole('button', { name: d, exact: true }).click();
  await p.page.getByTestId('trade-join').click();
}
await Promise.all([A, B].map((p) => p.page.getByTestId('trade-opp').waitFor({ timeout: 30000 })));
await A.page.getByTestId('trade-mine-9').locator('.card-mini').click(); // くすり
await A.page.waitForTimeout(500);
for (const p of [A, B]) await p.page.getByTestId('trade-ok').click();
for (const p of [A, B]) {
  await p.page.getByTestId('trade-go').click();
  await p.page.getByTestId('trade-confirm-yes').click();
}
await A.page.waitForTimeout(2000);
await snap(A, '08_trade');
const ta = await readSave(A);
const tb = await readSave(B);
if (tb.collection[9] !== 3) problems.push(`トレードのあと B の くすり：${tb.collection[9]}`);
if (ta.trade.doneIds.length !== 1) problems.push('トレードの交換IDが記録されていない');

log('今までのセーブ（形式版数3）からの移行');
const C = { name: 'C', ...(await openPage(browser, size, Q)) };
await C.page.evaluate(async () => {
  const old = await import('/tests/save.oldFormat.ts');
  const cs = await import('/src/save/cookieStore.ts');
  const st = { jar: cs.browserCookieJar(), local: window.localStorage, secure: false };
  cs.wipe(st);
  const v3 = {
    saveVersion: 1,
    saveCounter: 7,
    playerName: 'むかし',
    settings: { bgm: 7, se: 7, fxSpeed: 2, reduceFx: false, hints: true, lang: 'hira' },
    decks: [
      { name: 'つよい デッキ', cards: [1, 1, 1, 2, 2, 3, 3, 4, 5, 6, 8, 9, 9, 10, 11] },
      { name: '', cards: [] },
      { name: '', cards: [] },
      { name: '', cards: [] },
      { name: '', cards: [] },
    ],
    selectedDeck: 0,
    stats: { wins: 4, losses: 2 },
    cpuStats: [{ wins: 1, losses: 0 }, { wins: 0, losses: 0 }, { wins: 0, losses: 0 }, { wins: 0, losses: 0 }],
    coins: 0,
    collection: [],
    unlockAll: false,
    story: { cleared: [] },
  };
  cs.writeCookies(st.jar, old.oldCookie(v3, 3), false);
});
await C.page.reload();
await C.page.waitForTimeout(2000);
await C.page.mouse.click(size.width / 2, size.height / 2);
await C.page.getByTestId('update-notice').waitFor({ timeout: 15000 });
await snap(C, '09_migrate_notice');
await C.page.getByRole('button', { name: 'あとで', exact: true }).click();
const sc = await readSave(C);
if (sc.playerName !== 'むかし' || sc.stats.wins !== 4) problems.push(`移行：名前・成績 ${sc.playerName} ${JSON.stringify(sc.stats)}`);
if (sc.coins !== 200) problems.push(`移行：コイン ${sc.coins}`);
if (sc.decks[0].cards.length !== 15) problems.push('移行：保存デッキが消えた');
if ((sc.collection[8] ?? 0) < 1 || (sc.collection[1] ?? 0) < 5) problems.push(`移行：所持数 ${JSON.stringify(sc.collection)}`);
await C.page.getByRole('button', { name: /CPUたいせん/ }).click();
await C.page.locator('.cpu-scene__level--normal').click();
const slot0 = await C.page.getByTestId('deck-slot-0').getAttribute('disabled');
if (slot0 !== null) problems.push('移行：今までのデッキが使えなくなった');

const errors = [A, B, C].flatMap((p) => p.errors.filter((e) => !/AudioContext|WebSocket/.test(e)).map((e) => `${p.name}: ${e}`));
console.log(size.name, problems.length ? `\n${problems.join('\n')}` : '問題 なし');
console.log('errors:', errors.length ? errors : 'なし');
await browser.close();
