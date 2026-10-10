// 画像を入れた後（v2.3）の確認：タイトル・カード一覧（デッキ編集）・ガチャ（なかみ）・ストーリーのステージ選択（ボスの絵）・ボスのカットイン・対戦を、
// 1280×720 と 844×390、にほんご と 日本語 で撮る。読み込めない絵・はみ出した絵が無いかも確かめる。
// 使い方：npm run dev（ポート 5175）のまま node scripts/shots-v23-art.mjs
import { SIZES, launch, openPage, shot, waitIdle } from './pw.mjs';

const problems = [];
const browser = await launch();
try {
  for (const size of SIZES) {
    for (const lang of ['hira', 'kanji']) {
      const tag = `${size.name}_${lang}`;
      const { page, ctx, errors } = await openPage(browser, size);
      const notFound = [];
      page.on('response', (r) => {
        if (r.status() >= 400 && /\.(png|jpe?g|webp)$/.test(r.url())) notFound.push(`${r.status()} ${r.url()}`);
      });
      /** 読み込めなかった絵・枠からはみ出した絵 */
      const check = async (name) => {
        const bad = await page.evaluate(() => {
          const out = [];
          for (const img of document.images) {
            if (img.complete && img.naturalWidth === 0) out.push(`読めない ${img.getAttribute('src')}`);
            const box = img.parentElement?.getBoundingClientRect();
            const r = img.getBoundingClientRect();
            if (img.classList.contains('card-art__img') && box && (r.width > box.width + 1 || r.height > box.height + 1)) out.push(`はみ出し ${img.getAttribute('src')}`);
          }
          return out;
        });
        for (const b of bad) problems.push(`${tag} ${name}：${b}`);
      };
      const snap = async (name) => {
        await page.waitForTimeout(500);
        await check(name);
        await shot(page, `v23art_${tag}_${name}`);
      };

      // セーブ：チュートリアル済み・全部のカードを3枚以上・ストーリーは14まで（ボスが全部見える）
      await page.evaluate(
        async ({ lang }) => {
          const cs = await import('/src/save/cookieStore.ts');
          const sd = await import('/src/save/saveData.ts');
          const cards = await import('/src/data/cards.ts');
          const storage = { jar: cs.browserCookieJar(), local: window.localStorage, secure: false };
          const data = sd.createDefaultSave();
          data.tutorial = { done: true, gachaInviteShown: true, step: 0 };
          data.settings.lang = lang;
          data.playerName = 'たろう';
          data.coins = 5000;
          data.loginBonus.claimedAt = Date.now();
          for (const c of cards.CARD_LIST) data.collection[c.no] = Math.max(data.collection[c.no] ?? 0, 3);
          data.story.stages = Array.from({ length: 14 }, (_, i) => ({ no: i + 1, cleared: true, firstClear: true }));
          cs.persist(storage, data);
        },
        { lang },
      );
      await page.goto(page.url().split('?')[0] + '?debug=1');
      await page.waitForTimeout(3500);
      await snap('01_title');
      await page.mouse.click(size.width / 2, size.height / 2);
      await page.locator('.menu-scene').waitFor();

      const go = (route) => page.evaluate((r) => window.__otecaGo(r), route);
      await go('deck');
      await page.waitForTimeout(900);
      await snap('02_cards');
      // カードの くわしく（絵が大きく出る）：最初・アイテム・限定カード（いちばん後ろ）
      const tiles = page.locator('.card-mini--tile');
      for (const [k, t] of [['first', tiles.first()], ['item', page.locator('.card-mini--tile.card-mini--item').first()], ['last', tiles.last()]]) {
        if (!(await t.count())) continue;
        await t.scrollIntoViewIfNeeded();
        await t.click({ button: 'right' });
        await page.waitForTimeout(500);
        await snap(`02_card_detail_${k}`);
        await page.getByRole('button', { name: /^(とじる|閉じる)$/ }).click();
      }

      await go('gacha');
      await page.getByTestId('gacha-scene').waitFor();
      await snap('03_gacha');
      await page.getByTestId('gacha-pack').click();
      await page.waitForTimeout(600);
      await snap('04_gacha_contents');

      await go('story');
      await page.getByTestId('story-scene').waitFor();
      await page.waitForTimeout(800);
      await snap('05_story_map');
      await page.getByTestId('story-stage-15').click({ force: true });
      await page.getByTestId('stage-confirm').waitFor();
      await snap('06_story_boss_confirm');
      if (await page.getByTestId('stage-go').isDisabled()) {
        // ボスのルールに合うデッキ：ステージのおすすめ（デッキを えらびなおす → 1番目）
        await page.getByTestId('stage-change-deck').click();
        await page.locator('[data-testid="deck-slot-0"]').click();
      }
      await page.getByTestId('stage-go').click();
      await page.waitForTimeout(900);
      await snap('07_boss_cutin');
      await page.locator('.battle-board').waitFor({ timeout: 20000 });
      await waitIdle(page, 30000);
      // バトル場に出す（演出が終わってから）
      const place = page.getByRole('button', { name: /バトルばに だす|バトル場に出す/ });
      for (let i = 0; i < 40 && !(await place.isVisible()); i++) {
        // せんこう きめ が終わるまで、手札のおてあげを押してみる
        await page.locator('.battle-hand .battle-card:not(.is-dim)').first().click({ timeout: 2000 }).catch(() => {});
        await page.waitForTimeout(500);
      }
      await place.click();
      await waitIdle(page, 30000);
      await page.waitForTimeout(1500);
      await waitIdle(page, 30000);
      await snap('08_battle');
      await page.locator('.battle-slot--me.battle-slot--active .battle-card').click({ button: 'right', force: true });
      await page.waitForTimeout(500);
      await snap('09_battle_detail');

      for (const e of errors) problems.push(`${tag} エラー：${e}`);
      for (const n of notFound) problems.push(`${tag} ${n}`);
      await ctx.close();
      console.log(tag, 'OK');
    }
  }
} finally {
  await browser.close();
}
console.log(problems.length ? `問題 ${problems.length}件：\n- ${problems.join('\n- ')}` : 'すべて OK');
process.exit(problems.length ? 1 : 0);
