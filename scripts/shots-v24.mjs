// v2.4 の確認とスクリーンショット（1280×720・844×390）。npm run dev（ポート 5175）のまま node scripts/shots-v24.mjs
// - すりむ：カード一覧（スーパーの絞り込み）・くわしく・デッキ編集（スーパー2枚のデッキの「スーパーが 2まい いじょう はいっています」）・ガチャ（スーパー）・対戦
// - ひきかえカードの選択画面（スーパーおてあげは灰色・押すと「スーパーおてあげ は えらべません」）
// - オンラインの待機画面（「デッキを かえる」と「やめる」が重ならない）
// - ガチャ（通常・スーパー）
// 見る点：絵が出ている（読めている・乗算で白がなじむ）、重なり・はみ出しが無い（scripts/layoutScan.mjs の scanPage）
// 通信待ちの画面は scripts/online-disconnect.mjs（v24c_*_01_waiting）
import { BASE, SIZES, launch, openPage, shot } from './pw.mjs';
import { scanPage } from './layoutScan.mjs';

const problems = [];
const browser = await launch();
const SURIMU = 42;

/** 乱数を決める（パックガチャ：1袋に [スーパーか・どれか・光るか]） */
const forceLuck = (page, values) =>
  page.evaluate((values) => {
    const real = crypto.getRandomValues.bind(crypto);
    const left = [...values];
    crypto.getRandomValues = (a) => {
      if (left.length && a instanceof Uint32Array && a.length === 1) {
        a[0] = Math.floor(left.shift() * 2 ** 32);
        return a;
      }
      return real(a);
    };
  }, values);

async function start(size) {
  const p = await openPage(browser, size);
  // 開発サーバーが読み込み直すことがあるので、少し待つ
  await p.page.waitForTimeout(1500);
  await p.page.evaluate(async (SURIMU) => {
    const cs = await import('/src/save/cookieStore.ts');
    const sd = await import('/src/save/saveData.ts');
    const cards = await import('/src/data/cards.ts');
    const d = sd.createDefaultSave();
    d.tutorial = { done: true, gachaInviteShown: true, step: 0 };
    d.coins = 5000;
    d.loginBonus.claimedAt = Date.now();
    for (const c of cards.CARD_LIST) d.collection[c.no] = 3;
    const no = (id) => cards.cardById(id).no;
    const filler = [no('oteage'), no('oteage'), no('oteage'), no('mitsume'), no('mitsume'), no('mitsume'), no('otesage'), no('otesage'), no('yotsuashi'), no('yotsuashi'), no('kusuri'), no('kusuri'), no('kusuri'), no('himitsu_yaiba')];
    d.decks[0] = { name: 'すりむデッキ', cards: [...filler, SURIMU].sort((a, b) => a - b) };
    d.decks[1] = { name: 'スーパー2', cards: [...filler.slice(1), SURIMU, no('kami')].sort((a, b) => a - b) };
    d.selectedDeck = 0;
    cs.persist({ jar: cs.browserCookieJar(), local: window.localStorage, secure: false }, d);
  }, SURIMU);
  await p.page.goto(BASE + '?debug=1&api=off');
  await p.page.waitForTimeout(2500);
  await p.page.mouse.click(size.width / 2, size.height / 2);
  await p.page.locator('.stage .menu-scene').first().waitFor();
  return p;
}
/** 準備：手札のおてあげ（filter に合うもの）をバトル場に出す。出せるまで何回か試す */
async function placeActive(page, tag, pick) {
  for (let k = 0; k < 8; k++) {
    await pick().click();
    const place = page.locator('.stage').getByRole('button', { name: /^バトルばに だす|^バトル場に出す/ }).first();
    if (await place.waitFor({ timeout: 2000 }).then(() => true, () => false)) {
      await place.click();
      return true;
    }
    // 選んだカードは「ここに だす」の場所を押しても出せる
    const drop = page.locator('.stage .battle-slot.is-drop').first();
    if (await drop.count()) {
      await drop.click({ force: true });
      return true;
    }
    await shot(page, `v24_${tag}_debug_place_${k}`);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(1000);
  }
  return false;
}
const go = (page, r, payload) => page.evaluate(([r, p]) => window.__otecaGo(r, p), [r, payload ?? null]);

/** 画面の中の絵が読めて出ているか（読み込み中・失敗の数、乗算になっていない絵の数） */
const artCheck = (page, root = '.stage') =>
  page.evaluate((root) => {
    const r = document.querySelector(root);
    const imgs = [...r.querySelectorAll('img.card-art__img, img.item-art__img')].filter((i) => i.getBoundingClientRect().width > 4);
    return {
      shown: imgs.filter((i) => i.complete && i.naturalWidth > 0).length,
      broken: imgs.filter((i) => !(i.complete && i.naturalWidth > 0)).length,
      notMultiply: imgs.filter((i) => getComputedStyle(i).mixBlendMode !== 'multiply').length,
      waiting: r.querySelectorAll('.card-art__wait').length,
      webp: imgs.every((i) => /\.webp$/.test(i.src)),
    };
  }, root);

async function check(page, tag, name, { needArt = true } = {}) {
  await page.waitForTimeout(700);
  const a = await artCheck(page);
  if (needArt && a.shown === 0) problems.push(`${tag} ${name}：絵が出ていない`);
  if (a.broken || a.notMultiply || !a.webp) problems.push(`${tag} ${name}：絵 ${JSON.stringify(a)}`);
  const found = await scanPage(page);
  for (const f of found) problems.push(`${tag} ${name}：${f}`);
  await shot(page, `v24_${tag}_${name}`);
  console.log(tag, name, JSON.stringify(a), found.length ? found : '');
}

try {
  for (const size of SIZES) {
    const tag = size.name;
    const { page, ctx, errors } = await start(size);

    // ONLY=hikikae の時は、ひきかえカードの所だけ（確かめ直し用）
    if (process.env.ONLY !== 'hikikae') {
    // すりむ：カード一覧（スーパー）・くわしく・デッキ編集
    await go(page, 'deck');
    await page.getByTestId('deck-filter-super').click();
    await check(page, tag, '01_deck_super_list', { needArt: false });
    const tile = page.locator('.list-panel .card-mini', { hasText: 'すりむ' }).first();
    await tile.click({ button: 'right' });
    await check(page, tag, '02_surimu_detail');
    if (!(await page.locator('.dialog .card-detail', { hasText: 'すりむ' }).count())) problems.push(`${tag} くわしく：すりむ が出ない`);
    if (!(await page.locator('.dialog .card-stamp').count())) problems.push(`${tag} くわしく：スーパーの見た目になっていない`);
    await page.keyboard.press('Escape');
    await page.locator('.dialog').first().waitFor({ state: 'detached' }).catch(() => {});
    if (await page.locator('.dialog').count()) await page.getByRole('button', { name: /とじる|閉じる/ }).first().click();
    await page.getByTestId('deck-pick').click();
    await page.getByTestId('deck-slot-1-super').waitFor();
    await check(page, tag, '03_deck_picker_two_supers', { needArt: false });
    await page.getByRole('button', { name: /とじる|閉じる/ }).first().click();

    // ガチャ：ふつう（光らない袋）→ すりむ（よせあつめパックのスーパー。光る袋）
    await go(page, 'gacha');
    await page.getByTestId('gacha-scene').waitFor();
    await forceLuck(page, [0.9, 0.3, 0.99]);
    await page.getByTestId('gacha-buy-two').click();
    await page.waitForTimeout(1000);
    await page.getByTestId('gacha-bag-0').click({ force: true });
    await page.getByTestId('gacha-next').waitFor({ timeout: 20000 });
    await check(page, tag, '04_gacha_normal');
    await page.getByTestId('gacha-skip-all').click();
    await page.getByTestId('gacha-summary').waitFor();
    await page.getByRole('button', { name: /パックを えらぶ|パックを選ぶ/ }).click();
    for (let i = 0; i < 2; i++) await page.getByRole('button', { name: /つぎの パック|次のパック/ }).click();
    await page.waitForTimeout(600);
    await forceLuck(page, [0.01, 0.9, 0.1]);
    await page.getByTestId('gacha-buy-two').click();
    await page.waitForTimeout(1000);
    await page.getByTestId('gacha-bag-0').click({ force: true });
    await page.getByTestId('gacha-next').waitFor({ timeout: 20000 });
    if (!(await page.locator('.gacha-reveal__front', { hasText: 'すりむ' }).count())) problems.push(`${tag} ガチャ：すりむ が出ない`);
    if ((await page.getByTestId('gacha-reveal').getAttribute('data-kind')) !== 'super') problems.push(`${tag} ガチャ：すりむ がスーパーの演出になっていない`);
    await check(page, tag, '05_gacha_super_surimu');
    await page.getByTestId('gacha-skip-all').click();

    // 対戦：すりむ をバトル場に
    const deck = [SURIMU, 9, 9, 9, 10, 10, 10, 11, 11, 11, 12, 12, 9, 10, 11];
    await go(page, 'battle', { mode: 'cpu', cpuLevel: 'weak', decks: { p1: deck, p2: [1, 1, 1, 2, 2, 2, 3, 3, 4, 4, 5, 5, 9, 9, 10] }, names: { p1: 'たろう', p2: 'CPU' }, seed: 'v24-surimu', me: 'p1', record: false });
    await page.locator('.battle').first().waitFor();
    await page.waitForFunction(() => document.querySelector('.stage .battle-board')?.getAttribute('data-state') === 'mine', null, { timeout: 30000 });
    await page.waitForTimeout(500);
    if (!(await placeActive(page, tag, () => page.locator('.stage .battle-hand .battle-card', { hasText: 'すりむ' }).first()))) problems.push(`${tag} 対戦：すりむ を出せない`);
    await page.waitForTimeout(4000);
    await check(page, tag, '06_battle_surimu');

    }
    // ひきかえカード：山札にスーパー（すりむ・かみ）がある時の選ぶ画面
    let ok = false;
    for (let s = 1; s <= (process.env.ONLY ? 4 : 40) && !ok; s++) {
      const d1 = [47, 47, 47, 47, 1, 1, 1, 1, 2, 2, 2, 3, SURIMU, 8, 9];
      await go(page, 'menu');
      await page.locator('.stage .menu-scene').first().waitFor();
      await page.waitForTimeout(800);
      await go(page, 'battle', { mode: 'cpu', cpuLevel: 'weak', decks: { p1: d1, p2: [1, 1, 1, 2, 2, 2, 3, 3, 4, 4, 5, 5, 9, 9, 10] }, names: { p1: 'たろう', p2: 'CPU' }, seed: `v24-hikikae-${s}`, me: 'p1', record: false });
      await page.locator('.battle').first().waitFor();
      const ready = await page.waitForFunction(() => document.querySelector('.stage .battle-board')?.getAttribute('data-state') === 'mine', null, { timeout: 30000 }).then(() => true, () => false);
      if (!ready) {
        await shot(page, `v24_${tag}_debug_wait_${s}`);
        continue;
      }
      await page.waitForTimeout(500);
      if (!(await page.locator('.stage .battle-hand .battle-card', { hasText: 'ひきかえ' }).count())) continue;
      if (!(await placeActive(page, tag, () => page.locator('.stage .battle-hand .battle-card').filter({ hasText: /HP/ }).first()))) continue;
      // 自分の番になるまで待つ
      await page.waitForTimeout(1500);
      // 自分のメインの番（ターンおわりのボタンが押せる）になるまで待つ
      const myTurn = () => {
        const st = document.querySelector('.stage .battle-board')?.getAttribute('data-state');
        const end = document.querySelector('.stage .battle-end button');
        return st === 'mine' && !!end && end.getAttribute('aria-disabled') !== 'true';
      };
      if (!(await page.waitForFunction(myTurn, null, { timeout: 60000 }).then(() => true, () => false))) continue;
      await page.waitForTimeout(800);
      const item = page.locator('.stage .battle-hand .battle-card', { hasText: 'ひきかえ' }).first();
      if (!(await item.count())) continue;
      // 演出中は押しても選べないので、「つかう」が出るまで何回か押す
      const use = page.locator('.stage').getByRole('button', { name: /^つかう$|^使う$/ }).first();
      for (let k = 0; k < 3 && !(await use.isVisible().catch(() => false)); k++) {
        await item.click();
        await use.waitFor({ timeout: 1500 }).catch(() => {});
        if (process.env.ONLY) await shot(page, `v24_${tag}_debug_click_${s}_${k}`);
      }
      if (await use.isVisible().catch(() => false)) await use.click();
      else {
        // おてあげに使わないアイテムは、場へドラッグしても使える
        await page.keyboard.press('Escape');
        const from = await item.boundingBox();
        const to = await page.locator('.stage .battle-slot--active.battle-slot--me').boundingBox();
        if (from && to) {
          await page.mouse.move(from.x + from.width / 2, from.y + from.height / 3);
          await page.mouse.down();
          await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 12 });
          await page.mouse.up();
        }
      }
      if (!(await page.getByTestId('choose-panel').first().waitFor({ timeout: 6000 }).then(() => true, () => false))) {
        await shot(page, `v24_${tag}_debug_use_${s}`);
        if (s >= (process.env.ONLY ? 1 : 38)) console.log('buttons', await page.locator('.stage button').allInnerTexts(), await page.locator('.stage .battle-prompt, .stage .battle-reason').allInnerTexts());
        continue;
      }
      ok = true;
    }
    if (!ok) problems.push(`${tag} ひきかえカード：選ぶ画面を出せなかった`);
    else {
      const locked = await page.getByTestId('choose-locked').count();
      if (locked < 1) problems.push(`${tag} ひきかえカード：灰色のスーパーが無い`);
      await page.getByTestId('choose-locked').first().click({ force: true });
      const warn = await page.getByTestId('choose-no-super').textContent();
      if (!/スーパーおてあげ は えらべません|スーパーおてあげは選べません/.test(warn ?? '')) problems.push(`${tag} ひきかえカード：注意の文が違う「${warn}」`);
      await check(page, tag, '07_hikikae_choose');
      console.log(tag, 'ひきかえ：灰色', locked, '枚');
    }

    // オンラインの待機画面
    await go(page, 'lobby');
    for (const d of '482913') await page.getByRole('button', { name: d, exact: true }).click();
    await page.getByRole('button', { name: /へやに はいる|部屋に入る/ }).click();
    await page.locator('.lobby--wait').waitFor();
    await check(page, tag, '08_lobby_wait', { needArt: false });

    for (const e of errors) if (!/AudioContext|Failed to load resource|WebSocket|tracker/i.test(e)) problems.push(`${tag} エラー：${e.slice(0, 160)}`);
    await ctx.close();
  }
} finally {
  await browser.close();
}
console.log(problems.length ? `\n見つかったこと ${problems.length}件：\n- ${problems.join('\n- ')}` : '\nすべて OK');
process.exitCode = problems.length ? 1 : 0;
