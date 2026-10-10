// カードを手に入れる場面（v2.3：対戦中と同じカード PrizeCard）の確認。1280×720 と 844×390 で撮り、
// カードが画面・枠から切れていないか（スクロールできる一覧はスクロールの中か）、名前とHPの文字が読める大きさかを確かめる。
// 場面：パックガチャ（めくる・袋の中・まとめ 3まい／15まい）、デイリーパック、ストーリーの限定カード、
//       きのうのデイリーの自動受け取り、トロフィーが届いた、トレードで受け取った
// 使い方：npm run dev（ポート 5175）のまま node scripts/shots-v23e-prize.mjs
import { BASE, SIZES, launch, openPage, shot } from './pw.mjs';

const MIN_PX = 8; // 名前・HP の文字の高さ（画面上の px）。これより小さいと読めない
const problems = [];
const browser = await launch();

/** 画面のカードを確かめる。scroll：スクロールできる一覧の中のカードは、一覧の中の位置で見る */
async function check(page, tag, name) {
  const res = await page.evaluate((MIN_PX) => {
    const out = [];
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let minName = Infinity;
    let minHp = Infinity;
    const cards = [...document.querySelectorAll('.prize-card')];
    for (const c of cards) {
      const r = c.getBoundingClientRect();
      if (r.width < 2) continue;
      const label = c.querySelector('.battle-card__name')?.textContent ?? '?';
      // スクロールできる親（一覧）
      let p = c.parentElement;
      let box = null;
      while (p) {
        const cs = getComputedStyle(p);
        if (/(auto|scroll)/.test(cs.overflowY) && p.scrollHeight > p.clientHeight) {
          box = p;
          break;
        }
        p = p.parentElement;
      }
      if (box) {
        const br = box.getBoundingClientRect();
        if (r.left < br.left - 2 || r.right > br.right + 2) out.push(`${label}：一覧から横にはみ出す`);
      } else if (r.left < -2 || r.top < -2 || r.right > vw + 2 || r.bottom > vh + 2) out.push(`${label}：画面から切れている`);
      const n = c.querySelector('.battle-card__name');
      const h = c.querySelector('.battle-card__hp .num, .card-hp .num');
      if (n) {
        const range = document.createRange();
        range.selectNodeContents(n);
        const rr = range.getClientRects()[0];
        if (rr) minName = Math.min(minName, rr.height);
      }
      if (h) minHp = Math.min(minHp, h.getBoundingClientRect().height);
    }
    if (cards.length && minName < MIN_PX * 1.1) out.push(`名前の文字が小さい（${minName.toFixed(1)}px）`);
    if (minHp !== Infinity && minHp < MIN_PX * 1.1) out.push(`HPの文字が小さい（${minHp.toFixed(1)}px）`);
    return { n: cards.length, out, minName, minHp };
  }, MIN_PX);
  for (const o of res.out) problems.push(`${tag} ${name}：${o}`);
  return res;
}

async function snap(page, tag, name, { want = 1 } = {}) {
  await page.waitForTimeout(400);
  const r = await check(page, tag, name);
  if (r.n < want) problems.push(`${tag} ${name}：カードが ${r.n}まい（${want}まい以上のはず）`);
  console.log(tag, name, `カード ${r.n}まい 名前 ${r.minName === Infinity ? '-' : r.minName.toFixed(1)}px HP ${r.minHp === Infinity ? '-' : r.minHp.toFixed(1)}px`);
  await shot(page, `v23e_${tag}_${name}`);
}

/** セーブを入れて開く */
async function prepare(page, size, fn, query = '?debug=1') {
  await page.evaluate(fn);
  await page.goto(BASE + query);
  await page.waitForTimeout(2500);
  await page.mouse.click(size.width / 2, size.height / 2);
  await page.locator('.menu-scene').waitFor();
}

const baseSave = async () => {
  const cs = await import('/src/save/cookieStore.ts');
  const sd = await import('/src/save/saveData.ts');
  const storage = { jar: cs.browserCookieJar(), local: window.localStorage, secure: false };
  const d = sd.createDefaultSave();
  d.tutorial = { done: true, gachaInviteShown: true, step: 0 };
  d.coins = 5000;
  d.loginBonus.claimedAt = Date.now();
  d.playerName = 'たろう';
  return { cs, storage, d };
};

try {
  for (const size of SIZES) {
    const tag = size.name;
    // ---------------- パックガチャ 3まい：めくる → まとめ
    {
      const { page, ctx, errors } = await openPage(browser, size);
      await prepare(page, size, async () => {
        const cs = await import('/src/save/cookieStore.ts');
        const sd = await import('/src/save/saveData.ts');
        const d = sd.createDefaultSave();
        d.tutorial = { done: true, gachaInviteShown: true, step: 0 };
        d.coins = 5000;
        d.loginBonus.claimedAt = Date.now();
        cs.persist({ jar: cs.browserCookieJar(), local: window.localStorage, secure: false }, d);
      });
      await page.evaluate(() => window.__otecaGo('gacha'));
      await page.getByTestId('gacha-scene').waitFor();
      await page.getByTestId('gacha-buy-three').click();
      await page.waitForTimeout(900);
      await page.getByTestId('gacha-bag-1').click({ force: true });
      await page.getByTestId('gacha-next').waitFor({ timeout: 20000 });
      await snap(page, tag, '01_gacha_reveal');
      // 開けた袋の中のカード（つぎの袋が真ん中に来るところ）
      await page.getByTestId('gacha-next').click();
      await page.waitForTimeout(150);
      await snap(page, tag, '01b_gacha_bags', { want: 0 });
      await page.getByTestId('gacha-next').waitFor({ timeout: 20000 });
      for (let i = 0; i < 6 && !(await page.getByTestId('gacha-summary').count()); i++) {
        await page.getByTestId('gacha-next').click();
        await page.waitForTimeout(200);
        if (!(await page.getByTestId('gacha-summary').count())) await page.getByTestId('gacha-next').waitFor({ timeout: 20000 });
      }
      await page.getByTestId('gacha-summary').waitFor();
      await snap(page, tag, '02_gacha_summary3', { want: 3 });

      // ---------------- 15まい：ぜんぶ スキップ（袋の中のカード）→ まとめ（多い時は小さく・スクロール）
      await page.getByRole('button', { name: /パックを えらぶ|パックを選ぶ/ }).click();
      await page.getByTestId('gacha-buy-fifteen').click();
      await page.waitForTimeout(1500);
      const skip = page.getByRole('button', { name: /ぜんぶ スキップ|全部スキップ/ });
      if (await skip.count()) {
        await skip.first().click();
        await page.waitForTimeout(900);
        if (!(await page.getByTestId('gacha-summary').count())) await snap(page, tag, '03_gacha_bags15', { want: 1 });
      }
      for (let i = 0; i < 40 && !(await page.getByTestId('gacha-summary').count()); i++) {
        await page.getByTestId('gacha-next').click({ timeout: 3000 }).catch(() => {});
        await page.waitForTimeout(250);
      }
      await page.getByTestId('gacha-summary').waitFor();
      await snap(page, tag, '04_gacha_summary15', { want: 15 });
      // 一覧の下までスクロール
      await page.locator('.gacha-summary__grid').evaluate((el) => el.scrollTo(0, el.scrollHeight));
      await snap(page, tag, '05_gacha_summary15_bottom', { want: 15 });
      for (const e of errors) problems.push(`${tag} ガチャ エラー：${e}`);
      await ctx.close();
    }

    // ---------------- デイリーパック（ぜんぶ クリアの報酬 3袋）
    {
      const { page, ctx, errors } = await openPage(browser, size);
      await prepare(page, size, async () => {
        const cs = await import('/src/save/cookieStore.ts');
        const sd = await import('/src/save/saveData.ts');
        const daily = await import('/src/daily/daily.ts');
        const d = sd.createDefaultSave();
        d.tutorial = { done: true, gachaInviteShown: true, step: 0 };
        d.loginBonus.claimedAt = Date.now();
        d.playerId = '0123456789abcdef';
        daily.rollDaily(d, Date.now());
        for (const m of d.daily.missions) {
          m.progress = daily.missionDef(m.id).target;
          m.claimed = true;
        }
        cs.persist({ jar: cs.browserCookieJar(), local: window.localStorage, secure: false }, d);
      });
      await page.getByTestId('menu-daily').click();
      await page.getByTestId('daily-claim-allClear').click();
      await page.getByTestId('gacha-scene').waitFor({ timeout: 10000 });
      await page.getByTestId('gacha-next').waitFor({ timeout: 20000 }).catch(() => {});
      if (await page.getByTestId('gacha-next').count()) await snap(page, tag, '06_daily_reveal');
      for (let i = 0; i < 20 && !(await page.getByTestId('gacha-summary').count()); i++) {
        if (await page.getByTestId('gacha-next').count()) await page.getByTestId('gacha-next').click({ timeout: 3000 }).catch(() => {});
        else await page.locator('[data-testid^="gacha-bag-"]:not(.is-opened)').first().click({ force: true, timeout: 2000 }).catch(() => {});
        await page.waitForTimeout(500);
      }
      if (!(await page.getByTestId('gacha-summary').count())) await shot(page, `v23e_${tag}_debug_daily`);
      await page.getByTestId('gacha-summary').waitFor();
      await snap(page, tag, '07_daily_summary', { want: 3 });
      for (const e of errors) problems.push(`${tag} デイリー エラー：${e}`);
      await ctx.close();
    }

    // ---------------- ストーリーのクリア報酬（限定カード）
    {
      const { page, ctx, errors } = await openPage(browser, size);
      await prepare(page, size, async () => {
        const cs = await import('/src/save/cookieStore.ts');
        const sd = await import('/src/save/saveData.ts');
        const d = sd.createDefaultSave();
        d.tutorial = { done: true, gachaInviteShown: true, step: 0 };
        d.loginBonus.claimedAt = Date.now();
        d.story.stages = [1, 2].map((no) => ({ no, cleared: true, firstClear: true }));
        cs.persist({ jar: cs.browserCookieJar(), local: window.localStorage, secure: false }, d);
      });
      await page.evaluate(() =>
        window.__otecaGo('result', {
          setup: { mode: 'cpu', cpuLevel: 'strong', decks: { p1: [1], p2: [43] }, names: { p1: 'たろう', p2: 'おてあげニンゲン' }, seed: 'x', me: 'p1', record: false, story: { stage: 3 } },
          winner: 'p1',
          reason: 'ko',
          stats: { turns: 14, turnCounts: { p1: 7, p2: 7 }, sides: { p1: { damage: 300, kos: 3, mvpNo: 1, mvpDamage: 150 }, p2: { damage: 120, kos: 1, mvpNo: 43, mvpDamage: 120 } } },
          log: [],
          finalHash: '00000000',
        }),
      );
      await page.getByTestId('limited-fx').waitFor({ timeout: 15000 });
      await page.waitForTimeout(2200);
      await snap(page, tag, '08_story_limited');
      for (const e of errors) problems.push(`${tag} ストーリー エラー：${e}`);
      await ctx.close();
    }

    // ---------------- きのうのデイリー（受け取っていなかった報酬を自動で受け取った知らせ。カード入り）
    {
      const { page, ctx, errors } = await openPage(browser, size);
      await prepare(page, size, async () => {
        const cs = await import('/src/save/cookieStore.ts');
        const sd = await import('/src/save/saveData.ts');
        const daily = await import('/src/daily/daily.ts');
        const d = sd.createDefaultSave();
        d.tutorial = { done: true, gachaInviteShown: true, step: 0 };
        d.loginBonus.claimedAt = Date.now();
        d.playerId = '0123456789abcdef';
        daily.rollDaily(d, Date.now());
        for (const m of d.daily.missions) m.progress = daily.missionDef(m.id).target;
        // 「その日」を1日前に（12時を過ぎた）
        daily.debugNextDaily(d);
        cs.persist({ jar: cs.browserCookieJar(), local: window.localStorage, secure: false }, d);
      });
      await page.getByTestId('daily-carry').waitFor({ timeout: 10000 });
      await snap(page, tag, '09_daily_carry', { want: 3 });
      for (const e of errors) problems.push(`${tag} きのうのデイリー エラー：${e}`);
      await ctx.close();
    }

    // ---------------- トロフィーが届いた（郵便受けは手元の偽物で答える。本物のサーバーには送らない）
    {
      const { page, ctx, errors } = await openPage(browser, size, '?debug=1&api=local');
      await page.route('http://localhost:8787/**', (route) => {
        const u = route.request().url();
        if (u.includes('/mailbox/ack')) return route.fulfill({ status: 200, body: '{}' });
        if (u.includes('/mailbox')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ trophies: [{ number: 7 }] }) });
        return route.fulfill({ status: 503, body: '' });
      });
      await prepare(
        page,
        size,
        async () => {
          const cs = await import('/src/save/cookieStore.ts');
          const sd = await import('/src/save/saveData.ts');
          const d = sd.createDefaultSave();
          d.tutorial = { done: true, gachaInviteShown: true, step: 0 };
          d.loginBonus.claimedAt = Date.now();
          d.userId = '123456789012345';
          d.userIdRegistered = true;
          d.ranking.token = 'tok-test-0000000000000000';
          cs.persist({ jar: cs.browserCookieJar(), local: window.localStorage, secure: false }, d);
        },
        '?debug=1&api=local',
      );
      await page.getByTestId('trophy-get-ok').waitFor({ timeout: 15000 });
      await page.waitForTimeout(1600);
      await snap(page, tag, '10_trophy');
      for (const e of errors.filter((e) => !/503|Failed to load resource/.test(e))) problems.push(`${tag} トロフィー エラー：${e}`);
      await ctx.close();
    }

    // ---------------- トレードで受け取った（2つのブラウザ。開発用の中継 ?net=dev）
    {
      const room = String(Date.now()).slice(-6);
      const mk = async (name, extra) => {
        const p = await openPage(browser, size, '?debug=1&net=dev');
        await p.page.evaluate(
          async ({ name, extra }) => {
            const cs = await import('/src/save/cookieStore.ts');
            const sd = await import('/src/save/saveData.ts');
            const d = sd.createDefaultSave();
            d.playerName = name;
            d.tutorial = { done: true, gachaInviteShown: true, step: 0 };
            d.settings.fxSpeed = 2;
            d.loginBonus.claimedAt = Date.now();
            for (const [no, n] of Object.entries(extra)) d.collection[no] = n;
            cs.persist({ jar: cs.browserCookieJar(), local: window.localStorage, secure: false }, d);
          },
          { name, extra },
        );
        await p.page.goto(BASE + '?debug=1&net=dev');
        await p.page.waitForTimeout(2000);
        await p.page.mouse.click(size.width / 2, size.height / 2);
        await p.page.locator('.menu-scene').waitFor();
        await p.page.getByRole('button', { name: 'カードトレード', exact: true }).click();
        await p.page.getByTestId('trade-room-input').waitFor();
        for (const d of room) await p.page.getByRole('button', { name: d, exact: true }).click();
        await p.page.getByTestId('trade-join').click();
        return p;
      };
      const A = await mk('あおぞら', { 13: 2, 14: 1, 15: 1, 43: 1 });
      const B = await mk('たぬき', { 7: 1 });
      await Promise.all([A.page.getByTestId('trade-opp').waitFor({ timeout: 30000 }), B.page.getByTestId('trade-opp').waitFor({ timeout: 30000 })]);
      // 限定カード（おてあげニンゲン）は灰色で、押すと「ストーリー げんてい は こうかん できません」
      await snap(A.page, tag, '11_trade_limited_grey', { want: 0 });
      if (!(await A.page.locator('[data-testid="trade-mine-43"][data-limited]').count())) problems.push(`${tag} トレード：限定カードが灰色で出ていない`);
      await A.page.getByTestId('trade-mine-43').locator('.card-mini').click();
      await A.page.waitForTimeout(300);
      if (await A.page.getByTestId('give-plus-43').count()) problems.push(`${tag} トレード：限定カードを選べてしまった`);
      if (!(await A.page.getByText(/ストーリー げんてい は こうかん できません|ストーリー限定は交換できません/).first().isVisible())) problems.push(`${tag} トレード：「ストーリー げんてい は こうかん できません」が出ない`);
      // A が はさみ2・よんほん・やつあし をあげ、B が レボリューション をあげる
      for (const no of [13, 14, 15]) await A.page.getByTestId(`trade-mine-${no}`).locator('.card-mini').click();
      await A.page.getByTestId('give-plus-13').click();
      await B.page.getByTestId('trade-mine-7').locator('.card-mini').click();
      await A.page.waitForTimeout(800);
      await A.page.getByTestId('trade-ok').click();
      await B.page.getByTestId('trade-ok').click();
      for (const p of [A, B]) await p.page.getByTestId('trade-go').waitFor({ timeout: 15000 });
      await A.page.getByTestId('trade-go').click();
      await A.page.getByTestId('trade-confirm-yes').click();
      await B.page.getByTestId('trade-go').click();
      await B.page.getByTestId('trade-confirm-yes').click();
      await Promise.all([A, B].map((p) => p.page.getByTestId('trade-received').waitFor({ timeout: 15000 })));
      await Promise.all([
        snap(B.page, tag, '12_trade_received_B', { want: 3 }),
        snap(A.page, tag, '12_trade_received_A', { want: 1 }),
      ]);
      for (const p of [A, B]) {
        for (const e of p.errors) problems.push(`${tag} トレード エラー：${e}`);
        await p.ctx.close();
      }
    }
  }
} finally {
  await browser.close();
}
console.log(problems.length ? `問題 ${problems.length}件：\n- ${problems.join('\n- ')}` : 'すべて OK');
process.exit(problems.length ? 1 : 0);
