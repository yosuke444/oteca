// 追加の画像（v2.3 の2回目：すりむ・きみょうなドリンク・パック3つ）の確認。
// カード一覧（すりむ・きみょうなドリンクの くわしく）・対戦（すりむ と きみょうなドリンク が手札に来るデッキ）・ガチャ（パック3つ）を
// 1280×720 と 844×390 で撮る。読み込めない絵・はみ出した絵が無いかも確かめる。
// 使い方：npm run dev（ポート 5175）のまま node scripts/shots-v23b-art.mjs
import { SIZES, launch, openPage, shot, waitIdle } from './pw.mjs';

const problems = [];
const browser = await launch();
try {
  for (const size of SIZES) {
    const tag = size.name;
    const { page, ctx, errors } = await openPage(browser, size);
    const notFound = [];
    page.on('response', (r) => {
      if (r.status() >= 400 && /\.(png|jpe?g|webp)$/.test(r.url())) notFound.push(`${r.status()} ${r.url()}`);
    });
    const check = async (name) => {
      const bad = await page.evaluate(() => {
        const out = [];
        for (const img of document.images) {
          if (img.complete && img.naturalWidth === 0) out.push(`読めない ${img.getAttribute('src')}`);
          const box = img.parentElement?.getBoundingClientRect();
          const r = img.getBoundingClientRect();
          if (box && (r.width > box.width + 1 || r.height > box.height + 1)) out.push(`はみ出し ${img.getAttribute('src')}`);
        }
        return out;
      });
      for (const b of bad) problems.push(`${tag} ${name}：${b}`);
    };
    const snap = async (name) => {
      await page.waitForTimeout(500);
      await check(name);
      await shot(page, `v23b_${tag}_${name}`);
    };
    /** 画面に出ている絵（src に name を含むもの）が1つ以上あるか */
    const shows = async (name, what) => {
      const n = await page.locator(`img[src*="${name}"]`).count();
      if (n === 0) problems.push(`${tag} ${what}：${name} の絵が出ていない`);
    };

    await page.evaluate(async () => {
      const cs = await import('/src/save/cookieStore.ts');
      const sd = await import('/src/save/saveData.ts');
      const cards = await import('/src/data/cards.ts');
      const storage = { jar: cs.browserCookieJar(), local: window.localStorage, secure: false };
      const data = sd.createDefaultSave();
      data.tutorial = { done: true, gachaInviteShown: true, step: 0 };
      data.playerName = 'たろう';
      data.coins = 5000;
      data.loginBonus.claimedAt = Date.now();
      for (const c of cards.CARD_LIST) data.collection[c.no] = Math.max(data.collection[c.no] ?? 0, 3);
      cs.persist(storage, data);
    });
    await page.goto(page.url().split('?')[0] + '?debug=1');
    await page.waitForTimeout(2500);
    await page.mouse.click(size.width / 2, size.height / 2);
    await page.locator('.menu-scene').waitFor();
    const go = (route, payload) => page.evaluate(([r, p]) => window.__otecaGo(r, p), [route, payload ?? null]);

    // カード一覧：すりむ・きみょうなドリンク の くわしく
    await go('deck');
    await page.waitForTimeout(900);
    await snap('01_cards');
    for (const [k, name] of [
      ['surimu', 'すりむ'],
      ['kimyou_drink', 'きみょうな'],
    ]) {
      const t = page.locator('.card-mini--tile').filter({ hasText: name }).first();
      await t.scrollIntoViewIfNeeded();
      await t.click({ button: 'right' });
      await page.waitForTimeout(500);
      // アイテムは ふせん の形で、絵を出さない（今までどおり）。おてあげ（すりむ）だけ絵を確かめる
      if (k === 'surimu') await shows(`cards/${k}.png`, 'カードの くわしく');
      await snap(`02_detail_${k}`);
      await page.getByRole('button', { name: /^(とじる|閉じる)$/ }).click();
    }

    // ガチャ：パック3つ（▶ で次のパック）
    await go('gacha');
    await page.getByTestId('gacha-scene').waitFor();
    for (const p of ['ganso', 'shin', 'yoseatsume']) {
      for (let i = 0; i < 4 && !(await page.locator(`img[src*="pack_${p}.png"]`).count()); i++) {
        await page.locator('.gacha-scene button').filter({ hasText: '▶' }).first().click().catch(() => {});
        await page.keyboard.press('ArrowRight').catch(() => {});
        await page.waitForTimeout(700);
      }
      await shows(`packs/pack_${p}.png`, 'ガチャ');
      await snap(`03_gacha_${p}`);
    }

    // 対戦：すりむ と きみょうなドリンク ばかりのデッキ（手札に必ず来る。確認用なのでデッキの決まりは見ない）
    const deck = [...Array(11).fill(42), ...Array(4).fill(11)];
    await go('battle', { mode: 'cpu', cpuLevel: 'weak', decks: { p1: deck, p2: deck }, names: { p1: 'たろう', p2: 'CPU' }, seed: 12345, me: 'p1', record: false });
    await page.locator('.battle-board').waitFor({ timeout: 20000 });
    await waitIdle(page, 30000);
    const place = page.getByRole('button', { name: /バトルばに だす|バトル場に出す/ });
    for (let i = 0; i < 40 && !(await place.isVisible()); i++) {
      await page.locator('.battle-hand .battle-card:not(.is-dim)').first().click({ timeout: 2000 }).catch(() => {});
      await page.waitForTimeout(500);
    }
    await place.click();
    await waitIdle(page, 30000);
    await page.waitForTimeout(1500);
    await waitIdle(page, 30000);
    await shows('cards/surimu.png', '対戦');
    await snap('04_battle');
    await page.locator('.battle-slot--me.battle-slot--active .battle-card').click({ button: 'right', force: true });
    await page.waitForTimeout(500);
    await snap('05_battle_detail');

    for (const e of errors) problems.push(`${tag} エラー：${e}`);
    for (const n of notFound) problems.push(`${tag} ${n}`);
    await ctx.close();
    console.log(tag, 'おわり');
  }
} finally {
  await browser.close();
}
console.log(problems.length ? `問題 ${problems.length}件：\n- ${problems.join('\n- ')}` : 'すべて OK');
process.exit(problems.length ? 1 : 0);
