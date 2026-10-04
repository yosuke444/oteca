// ランキング（S19）と待合所のスクリーンショット（v2.0-I。SPEC §16-2i）。両方の言語・2つの大きさ。
// 手元の Worker（wrangler dev。ポート 8787。まっさらな保存領域）に 120人を入れて、?api=local で開く。
// 使い方：npm run dev（ポート 5175）のまま node scripts/shots-ranking.mjs
import { LOCAL_ADMIN_KEY as ADMIN, api, pid, startWorker } from './worker-dev.mjs';
import { SIZES, launch, openPage, shot } from './pw.mjs';

const NAMES = ['あおぞら', 'たぬき', 'ばかくん', 'ひまわり', 'もぐら', 'ゆきだるま', 'はやぶさ', 'こんぶ', 'ぺんぎん', 'かみなり', 'おにぎり', 'すいか'];
const w = await startWorker(8787);
const B = w.base;
const problems = [];
const ORIGIN = 'http://localhost:5175';
try {
  // 120人：名前を付けて登録し、試合結果を入れる（自分 ME は上位に）
  const ids = Array.from({ length: 120 }, (_, i) => pid(i + 1, 'f'));
  for (let i = 0; i < ids.length; i++)
    await api(B, '/register', { method: 'POST', origin: ORIGIN, body: { playerId: ids[i], name: `${NAMES[i % NAMES.length]}${i >= NAMES.length ? Math.floor(i / NAMES.length) : ''}`, optIn: i % 9 !== 4 } });
  const ME = pid(999, 'f');
  const token = (await api(B, '/register', { method: 'POST', origin: ORIGIN, body: { playerId: ME, name: 'じぶん', optIn: true } })).json.token;
  const now = Date.now();
  const results = [];
  for (let i = 0; i < ids.length; i++) for (let j = 1; j <= 3; j++) results.push({ a: ids[i], b: ids[(i + j * 7) % ids.length], winner: i % (j + 2) ? ids[i] : ids[(i + j * 7) % ids.length], at: now - 100000 + results.length });
  for (let k = 0; k < 3; k++) for (let i = 0; i < 6; i++) results.push({ a: ME, b: ids[50 + i * 3 + k], winner: ME, at: now - 50000 + results.length });
  await api(B, '/admin/seed', { method: 'POST', admin: ADMIN, origin: null, body: { results } });
  const batch = await api(B, '/admin/run-batch', { method: 'POST', admin: ADMIN, origin: null });
  if (!batch.json?.ok) problems.push(`まとめ処理：${JSON.stringify(batch.json)}`);

  const browser = await launch();
  for (const size of SIZES)
    for (const lang of ['hira', 'kanji']) {
      const tag = `${size.name}_${lang}`;
      /** セーブを入れて開く */
      const open = async (query, { withToken = true, provisional = true, cache = null, synced = false } = {}) => {
        const p = await openPage(browser, size, query);
        await p.page.evaluate(
          async ({ lang, ME, token, withToken, provisional, cache, synced }) => {
            const cs = await import('/src/save/cookieStore.ts');
            const sd = await import('/src/save/saveData.ts');
            const storage = { jar: cs.browserCookieJar(), local: window.localStorage, secure: false };
            cs.wipe(storage);
            localStorage.removeItem('oteca.rankingCache');
            if (cache) localStorage.setItem('oteca.rankingCache', JSON.stringify(cache));
            const d = sd.createDefaultSave();
            d.playerName = 'じぶん';
            // まだ のっていない人は、別の playerId
            d.playerId = withToken ? ME : 'ffff00000000abcd';
            d.rate = 163;
            d.ranking.token = withToken ? token : '';
            d.ranking.provisional = provisional;
            // もう今日の正式なレートを受け取った後（そのあと遊んだので「かり」）
            if (synced) d.ranking.syncedAt = Date.now();
            d.tutorial = { done: true, gachaInviteShown: true, step: 0 };
            d.settings.lang = lang;
            d.settings.fxSpeed = 2;
            d.loginBonus.claimedAt = Date.now();
            d.updateNoticeSeen = true;
            cs.persist(storage, d);
          },
          { lang, ME, token, withToken, provisional, cache, synced },
        );
        await p.page.reload();
        await p.page.waitForTimeout(1500);
        await p.page.mouse.click(size.width / 2, size.height / 2);
        await p.page.getByTestId('menu-online').waitFor();
        return p;
      };
      const go = (p, route) => p.page.evaluate((r) => window.__otecaGo(r), route);

      // 1. ランキング（自分は上位。蛍光ペン・メダル）
      let p = await open('?debug=1&api=local');
      await go(p, 'ranking');
      await p.page.getByTestId('ranking-row-mine').waitFor({ timeout: 15000 });
      await p.page.waitForTimeout(800);
      await shot(p.page, `ranking_${tag}_01_list`);
      const rows = await p.page.getByTestId('ranking-rows').locator('[role=row]').count();
      if (rows !== 100) problems.push(`${tag} 一覧の行数 ${rows}`);
      const myRank = await p.page.getByTestId('ranking-my-rank').textContent();
      const cd = await p.page.getByTestId('ranking-countdown').textContent();
      if (!/\d+:\d\d:\d\d/.test(cd ?? '')) problems.push(`${tag} 残り時間：${cd}`);
      // 1秒ごとに減る
      await p.page.waitForTimeout(1200);
      if ((await p.page.getByTestId('ranking-countdown').textContent()) === cd) problems.push(`${tag} 残り時間が動かない`);
      // 次の更新まで保存した一覧を使う（サーバーに聞かない）
      const cache = await p.page.evaluate(() => JSON.parse(localStorage.getItem('oteca.rankingCache') ?? 'null'));
      if (!cache || cache.top.length !== 100) problems.push(`${tag} 一覧が保存されていない`);
      let asked = 0;
      p.page.on('request', (r) => r.url().includes('/ranking') && asked++);
      await go(p, 'menu');
      await p.page.waitForTimeout(600);
      await go(p, 'ranking');
      await p.page.getByTestId('ranking-row-mine').waitFor();
      if (asked) problems.push(`${tag} 保存した一覧があるのにサーバーに聞いた`);
      // いちばん下までめくる
      await p.page.getByTestId('ranking-rows').evaluate((el) => (el.scrollTop = el.scrollHeight));
      await p.page.waitForTimeout(400);
      await shot(p.page, `ranking_${tag}_02_bottom`);
      // ななし（禁止語・載せない人）
      const names = await p.page.locator('.ranking-table__name').allTextContents();
      if (names.some((n) => n.includes('ばか'))) problems.push(`${tag} 禁止語の名前が出ている`);
      if (!names.some((n) => /ななし|名無し/.test(n))) problems.push(`${tag} 「ななし」が無い`);
      console.log(tag, myRank?.trim(), cd);
      await p.ctx.close();

      // 2. まだ のっていない（token なし）・つながらない（前に保存した一覧）
      p = await open('?debug=1&api=local', { withToken: false, provisional: false });
      await go(p, 'ranking');
      await p.page.getByTestId('ranking-not-yet').waitFor({ timeout: 15000 });
      await p.page.waitForTimeout(600);
      await shot(p.page, `ranking_${tag}_03_notyet`);
      await p.ctx.close();
      p = await open('?debug=1&api=off', { cache: { ...cache, nextAt: 0, savedAt: Date.now() - 3 * 3600e3 } });
      await go(p, 'ranking');
      await p.page.getByTestId('ranking-offline').waitFor({ timeout: 15000 });
      await p.page.waitForTimeout(600);
      await shot(p.page, `ranking_${tag}_04_offline_cache`);
      await p.ctx.close();
      p = await open('?debug=1&api=off');
      await go(p, 'ranking');
      await p.page.waitForTimeout(1500);
      await shot(p.page, `ranking_${tag}_05_offline`);
      await p.ctx.close();

      // 3. 待合所（受付係）：「いま 1にん まっています」と「かり」
      p = await open('?debug=1&api=local&net=dev', { synced: true });
      await go(p, 'rate');
      await p.page.getByTestId('rate-search').click();
      await p.page.getByTestId('rate-count').waitFor();
      await p.page.waitForTimeout(1500);
      await shot(p.page, `ranking_${tag}_06_lobby`);
      if (await p.page.getByTestId('rate-fallback').isVisible()) problems.push(`${tag} 受付係があるのに予備の待合所になった`);
      if (!(await p.page.getByTestId('rate-kari').isVisible())) problems.push(`${tag} 「かり」の印が無い`);
      await p.ctx.close();
      // 予備の待合所（受付係を使わない）
      p = await open('?debug=1&api=local&lobby=off&net=dev', { synced: true });
      await go(p, 'rate');
      await p.page.getByTestId('rate-search').click();
      await p.page.getByTestId('rate-fallback').waitFor({ timeout: 10000 });
      await p.page.waitForTimeout(800);
      await shot(p.page, `ranking_${tag}_07_lobby_fallback`);
      await p.ctx.close();
      // 設定（ランキングに なまえを のせる）・オンラインの画面（かり）
      p = await open('?debug=1&api=local', { synced: true });
      await go(p, 'settings');
      await p.page.getByTestId('settings-ranking').waitFor();
      await p.page.waitForTimeout(600);
      await shot(p.page, `ranking_${tag}_08_settings`);
      await go(p, 'online');
      await p.page.waitForTimeout(800);
      await shot(p.page, `ranking_${tag}_09_online`);
      const errs = p.errors.filter((e) => !/AudioContext|WebSocket|Failed to load resource/.test(e));
      if (errs.length) problems.push(`${tag} エラー：${errs.join(' / ')}`);
      await p.ctx.close();
    }
  await browser.close();
} catch (e) {
  problems.push(String(e?.stack ?? e));
} finally {
  w.stop();
}
console.log(problems.length ? problems.join('\n') : '問題 なし');
