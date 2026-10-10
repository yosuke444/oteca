// アイテムのふせんに絵（v2.3）の確認。カード一覧・デッキ枠・カードの くわしく（6まい）・ガチャの なかみ・トレード・対戦の手札を、
// 1280×720／844×390、にほんご／日本語 で撮る。
// 絵と文字が重なっていないか・ふせんからはみ出していないか・文字が切れていないかを、画面の位置で確かめる。
// 使い方：npm run dev（ポート 5175）のまま node scripts/shots-v23c-items.mjs
import { SIZES, launch, openPage, shot, waitIdle } from './pw.mjs';

const ITEMS = ['kusuri', 'himitsu_yaiba', 'kimyou_drink', 'supodori', 'hikikae', 'yabaitsubo'];
const problems = [];
const browser = await launch();
try {
  for (const size of SIZES) {
    for (const lang of ['hira', 'kanji']) {
      const tag = `${size.name}_${lang}`;
      const { page, ctx, errors } = await openPage(browser, size);
      let checked = 0;
      /** 絵のあるふせん：絵・名前・文の位置を比べる */
      const check = async (name) => {
        const res = await page.evaluate(() => {
          const out = [];
          let n = 0;
          // 傾き（ふせん・手札の扇）があると画面上の四角が大きくなるので、測る間だけ傾きを外す（拡大縮小はそのまま）
          const undo = [];
          const rotated = (el) => {
            const cs = getComputedStyle(el);
            if (cs.rotate && cs.rotate !== 'none' && parseFloat(cs.rotate) !== 0) return true;
            const t = cs.transform;
            if (!t || t === 'none') return false;
            const m = new DOMMatrixReadOnly(t);
            return Math.abs(m.b) > 1e-4 || Math.abs(m.c) > 1e-4;
          };
          for (const el of document.querySelectorAll('*')) {
            if (rotated(el)) {
              undo.push([el, el.style.transform, el.style.animation, el.style.transition, el.style.rotate]);
              el.style.rotate = 'none';
              el.style.animation = 'none';
              el.style.transition = 'none';
              el.style.transform = 'none';
            }
          }
          const hit = (a, b) => a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1;
          for (const note of document.querySelectorAll('.has-art')) {
            const art = note.querySelector('.item-art');
            if (!art) continue;
            n++;
            const img = art.querySelector('img');
            const nr = note.getBoundingClientRect();
            const ir = img.getBoundingClientRect();
            const label = note.querySelector('[class*="__name"]')?.textContent ?? '?';
            if (img.complete && img.naturalWidth === 0) out.push(`${label}：絵が読めない`);
            if (ir.width < 8 || ir.height < 8) out.push(`${label}：絵が小さすぎる ${ir.width}×${ir.height}`);
            if (ir.left < nr.left - 1 || ir.right > nr.right + 1 || ir.top < nr.top - 1 || ir.bottom > nr.bottom + 1) out.push(`${label}：絵がふせんからはみ出す`);
            for (const t of note.querySelectorAll('[class*="__name"], [class*="__text"], [class*="__kind"]')) {
              // 文字の入っている範囲（行ごと）と絵の範囲が重ならないか
              const range = document.createRange();
              range.selectNodeContents(t);
              for (const r of range.getClientRects()) if (hit(r, ir)) out.push(`${label}：絵と「${t.textContent.slice(0, 8)}…」が重なる`);
              if (t.scrollHeight > t.clientHeight + 1 && getComputedStyle(t).overflow === 'hidden') out.push(`${label}：文字が切れている`);
              const tr = t.getBoundingClientRect();
              if (tr.bottom > nr.bottom + 1) out.push(`${label}：文字がふせんからはみ出す`);
            }
          }
          for (const [el, t, a, tr, ro] of undo) {
            el.style.rotate = ro;
            el.style.transform = t;
            el.style.animation = a;
            el.style.transition = tr;
          }
          return { n, out };
        });
        checked += res.n;
        for (const o of [...new Set(res.out)]) problems.push(`${tag} ${name}：${o}`);
        return res.n;
      };
      const snap = async (name) => {
        await page.waitForTimeout(500);
        const n = await check(name);
        await shot(page, `v23c_${tag}_${name}`);
        return n;
      };

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
          cs.persist(storage, data);
        },
        { lang },
      );
      await page.goto(page.url().split('?')[0] + '?debug=1');
      await page.waitForTimeout(2500);
      await page.mouse.click(size.width / 2, size.height / 2);
      await page.locator('.menu-scene').waitFor();
      const go = (route, payload) => page.evaluate(([r, p]) => window.__otecaGo(r, p), [route, payload ?? null]);

      // デッキ編集：デッキ枠（くすり など）とカード一覧のアイテム（「アイテム」の しぼりこみ）
      await go('deck');
      await page.waitForTimeout(900);
      await snap('01_deck');
      await page.getByRole('button', { name: /^アイテム$/ }).first().click();
      await page.waitForTimeout(600);
      if ((await snap('02_deck_items')) < 6) problems.push(`${tag} カード一覧に絵のあるアイテムが6まい出ていない`);
      // くわしく（6まい）
      const tiles = page.locator('.card-mini--tile .card-mini__note');
      const count = await tiles.count();
      for (let i = 0; i < count; i++) {
        await tiles.nth(i).click({ button: 'right' });
        await page.waitForTimeout(450);
        if ((await snap(`03_detail_${i + 1}`)) < 1) problems.push(`${tag} くわしく ${i + 1}：絵が出ていない`);
        await page.getByRole('button', { name: /^(とじる|閉じる)$/ }).click();
      }

      // ガチャの なかみ（デッキ枠と同じ小さいカード）
      await go('gacha');
      await page.getByTestId('gacha-pack').click();
      await page.waitForTimeout(600);
      await snap('04_gacha_contents');

      // トレード（交換に出すカードを選ぶ一覧があれば）
      await go('trade');
      await page.waitForTimeout(1200);
      await snap('05_trade');

      // 対戦：手札にアイテム（確認用のデッキ。デッキの決まりは見ない）
      const deck = [1, 2, 3, 4, 5, 9, 10, 11, 12, 47, 48, 9, 10, 11, 12];
      await go('battle', { mode: 'cpu', cpuLevel: 'weak', decks: { p1: deck, p2: deck }, names: { p1: 'たろう', p2: 'CPU' }, seed: 777, me: 'p1', record: false });
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
      if ((await snap('06_battle')) < 1) problems.push(`${tag} 対戦の手札に絵のあるアイテムが出ていない`);
      const handItem = page.locator('.battle-hand .battle-card__note.has-art').first();
      if (await handItem.count()) {
        await handItem.click({ button: 'right', force: true });
        await page.waitForTimeout(450);
        await snap('07_battle_detail');
      }

      for (const e of errors) problems.push(`${tag} エラー：${e}`);
      await ctx.close();
      console.log(tag, `おわり（絵のあるふせん ${checked}まいを確かめた）`);
    }
  }
} finally {
  await browser.close();
}
console.log(problems.length ? `問題 ${problems.length}件：\n- ${problems.join('\n- ')}` : 'すべて OK');
process.exit(problems.length ? 1 : 0);
