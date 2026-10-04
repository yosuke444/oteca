// 遊んでみての修正（v2.2。SPEC §16-2k K10）の通しの確認とスクリーンショット。
// 手元の Worker（wrangler dev。ポート 8787。まっさらな保存領域。手元用の管理キー）を立ち上げ、ゲームは ?api=local&net=dev で開く
// （net=dev：開発サーバーの中継で、別々のブラウザどうしをつなぐ）。
// 使い方：npm run dev（ポート 5175）のまま node scripts/v22-e2e.mjs
//
// 1. 同じユーザーID の2つのブラウザで、フレンド対戦・レート対戦・トレードが始まらない（「この あいてとは あそべないよ」）
// 2. レート対戦の VS 画面と対戦中の名前の欄に、両者のレートとトロフィあげ（0個・2個・7個）
// 3. 両方の言語・2つの大きさで：設定の「ランキングに のる」・ランキング（4じ と 16じ）・デッキ編集（持っているカードだけ）・
//    デイリーミッション（確定の印なし）・ストーリー1（よわい）
// （ガチャの光る袋・確定の袋は scripts/shots-gacha.mjs）
import { LOCAL_ADMIN_KEY as ADMIN, api, newToken, pid, startWorker } from './worker-dev.mjs';
import { SIZES, launch, openPage, shot } from './pw.mjs';

const ORIGIN = 'http://localhost:5175';
const Q = '?debug=1&api=local&net=dev';
const started = Date.now();
const log = (...a) => console.log(`[${((Date.now() - started) / 1000).toFixed(1)}s]`, ...a);
const problems = [];
const expect = (ok, what) => {
  if (!ok) problems.push(what);
  log(ok ? '✓' : '✗', what);
};
const COMBOS = [
  { size: SIZES[0], lang: 'hira' },
  { size: SIZES[1], lang: 'kanji' },
  { size: SIZES[0], lang: 'kanji' },
  { size: SIZES[1], lang: 'hira' },
];
const tag = (c) => `${c.size.name}_${c.lang}`;

const w = await startWorker(8787);
const B = w.base;
const browsers = [];
try {
  // 遊ぶ人（登録済み）。X は トロフィー2個、Y は7個、Z は0個
  const mk = async (n, name) => {
    const u = { id: pid(n, 'd'), token: newToken(), name };
    await api(B, '/register', { method: 'POST', origin: ORIGIN, body: { userId: u.id, token: u.token, name, optIn: true } });
    return u;
  };
  const X = await mk(1, 'あおぞら');
  const Y = await mk(2, 'たぬき');
  const Z = await mk(3, 'もぐら');
  let num = 900;
  for (const [u, n] of [
    [X, 2],
    [Y, 7],
  ])
    for (let i = 0; i < n; i++) await api(B, '/admin/trophy', { method: 'POST', admin: ADMIN, origin: null, body: { userId: u.id, number: num++ } });
  // X のレートを上げておく（正式なレートが VS に出るか）
  await api(B, '/admin/seed', { method: 'POST', admin: ADMIN, origin: null, body: { results: [{ a: X.id, b: Z.id, winner: X.id, at: Date.now() - 60000 }] } });
  await api(B, '/admin/run-batch', { method: 'POST', admin: ADMIN, origin: null });
  const xRate = (await api(B, `/me?userId=${X.id}&token=${X.token}`)).json?.me?.rate;
  log('X の正式なレート', xRate);

  const browser = await launch();
  browsers.push(browser);

  /** セーブを入れて開く（同じ user・同じ playerId なら「同じデータ」） */
  const open = async (c, user, extra = {}) => {
    const p = await openPage(browser, c.size, Q);
    await p.page.evaluate(
      async ({ lang, user, extra }) => {
        const cs = await import('/src/save/cookieStore.ts');
        const sd = await import('/src/save/saveData.ts');
        const storage = { jar: cs.browserCookieJar(), local: window.localStorage, secure: false };
        cs.wipe(storage);
        localStorage.removeItem('oteca.rankingCache');
        const d = sd.createDefaultSave();
        d.playerName = user.name;
        d.userId = user.id;
        d.userIdRegistered = true;
        d.ranking.token = user.token;
        if (extra.playerId) d.playerId = extra.playerId;
        d.tutorial = { done: true, gachaInviteShown: true, step: 0 };
        d.settings.lang = lang;
        d.settings.fxSpeed = 2;
        d.loginBonus.claimedAt = Date.now();
        d.updateNoticeSeen = true;
        cs.persist(storage, d);
      },
      { lang: c.lang, user, extra },
    );
    await p.page.reload();
    await p.page.waitForTimeout(1500);
    await p.page.mouse.click(c.size.width / 2, c.size.height / 2);
    await p.page.getByTestId('menu-online').waitFor();
    return { ...p, c };
  };
  const go = (p, route, payload) => p.page.evaluate(([r, pl]) => window.__otecaGo(r, pl), [route, payload ?? null]);
  const enterRoom = async (p, room) => {
    await go(p, 'lobby');
    await p.page.getByTestId('room-input').waitFor();
    for (const d of room) await p.page.getByRole('button', { name: d, exact: true }).click();
    await p.page.locator('.lobby__join').click();
  };
  const enterTrade = async (p, room) => {
    await go(p, 'trade');
    await p.page.getByTestId('trade-room-input').waitFor();
    for (const d of room) await p.page.getByRole('button', { name: d, exact: true }).click();
    await p.page.getByTestId('trade-join').click();
  };

  for (const [k, c] of COMBOS.entries()) {
    const t = tag(c);
    const cannot = c.lang === 'hira' ? 'この あいてとは あそべないよ' : 'この相手とは遊べないよ';

    // ---------------------------------------------------------------- 1. 同じユーザーID（同じデータ）
    const A1 = await open(c, X, { playerId: `abcdefabcdef${String(k).padStart(4, "0")}` });
    const A2 = await open(c, X, { playerId: `abcdefabcdef${String(k).padStart(4, "0")}` });
    // フレンド：同じ部屋に入っても始まらない
    const room = String(Date.now()).slice(-6);
    await enterRoom(A1, room);
    await enterRoom(A2, room);
    await A1.page.getByTestId('room-only-same').waitFor({ timeout: 30000 }).catch(() => {});
    await A1.page.waitForTimeout(3000);
    expect((await A1.page.getByTestId('room-only-same').count()) === 1 && (await A1.page.locator('.battle, [data-testid="vs"]').count()) === 0, `${t} フレンド：同じユーザーID では始まらず「${cannot}」`);
    await shot(A1.page, `v22_${t}_01_friend_same`);
    // レート：同じユーザーID の2つ目は さがせない
    await go(A1, 'rate');
    await go(A2, 'rate');
    await A1.page.getByTestId('rate-search').click();
    await A1.page.getByTestId('rate-searching').waitFor();
    await A1.page.waitForTimeout(1000);
    await A2.page.getByTestId('rate-search').click();
    await A2.page.getByText(cannot).waitFor({ timeout: 15000 }).catch(() => {});
    expect((await A2.page.getByText(cannot).count()) > 0, `${t} レート：同じユーザーID の2つ目は「${cannot}」`);
    await shot(A2.page, `v22_${t}_02_rate_same`);
    await A1.page.getByRole('button', { name: c.lang === 'hira' ? 'やめる' : 'やめる' }).first().click().catch(() => {});
    // トレード：同じユーザーID では始めない
    const troom = String(Date.now() + 7).slice(-6);
    await enterTrade(A1, troom);
    await enterTrade(A2, troom);
    await Promise.race([A1.page.getByText(cannot).waitFor({ timeout: 20000 }), A2.page.getByText(cannot).waitFor({ timeout: 20000 })]).catch(() => {});
    const tradeBlocked = (await A1.page.getByText(cannot).count()) + (await A2.page.getByText(cannot).count()) > 0 && (await A1.page.getByTestId('trade-give').count()) === 0;
    expect(tradeBlocked, `${t} トレード：同じユーザーID では始めない`);
    await shot((await A1.page.getByText(cannot).count()) ? A1.page : A2.page, `v22_${t}_03_trade_same`);
    await A1.ctx.close();
    await A2.ctx.close();

    // ---------------------------------------------------------------- 2. レート対戦の VS と名前の欄（ちがう人どうし）
    const [me, opp] = k % 2 === 0 ? [X, Y] : [Z, Y];
    const P1 = await open(c, me);
    const P2 = await open(c, opp);
    await go(P1, 'rate');
    await go(P2, 'rate');
    await P1.page.getByTestId('rate-search').click();
    await P1.page.waitForTimeout(800);
    await P2.page.getByTestId('rate-search').click();
    await P1.page.getByTestId('vs').waitFor({ timeout: 30000 });
    const oppRow = P1.page.getByTestId('vs').locator('[data-testid="trophy-row"]');
    const counts = await oppRow.evaluateAll((els) => els.map((e) => Number(e.getAttribute('data-count'))));
    const wantMine = me === X ? 2 : 0;
    expect(JSON.stringify(counts) === JSON.stringify(wantMine ? [wantMine, 7] : [7]), `${t} VS：トロフィー（自分 ${wantMine}・相手 7）${JSON.stringify(counts)}`);
    const myRateText = await P1.page.getByTestId('vs-my-rate').textContent();
    if (me === X) expect(myRateText?.includes(String(xRate)), `${t} VS：自分の正式なレート ${xRate}（${myRateText}）`);
    // 7個は5個の絵と「+2」
    const icons = await P1.page.getByTestId('vs').locator('.trophy-row__icon').count();
    const more = await P1.page.getByTestId('vs').locator('.trophy-row__more').allTextContents();
    expect(icons === (wantMine ? 2 + 5 : 5) && more.join() === '+2', `${t} VS：7個は5個の絵と「+2」（絵 ${icons}・${more.join()}）`);
    await shot(P1.page, `v22_${t}_04_rate_vs`);
    await shot(P2.page, `v22_${t}_04b_rate_vs_opp`);
    // 対戦中の名前の欄
    await P1.page.locator('.battle').waitFor({ timeout: 45000 }).catch(() => {});
    await P1.page.waitForTimeout(3000);
    const badges = await P1.page.locator('[data-testid^="name-badge-"]').count();
    expect(badges === 2, `${t} 対戦中の名前の欄に、両者のレートとトロフィー（${badges}）`);
    await shot(P1.page, `v22_${t}_05_battle_names`);
    await P1.ctx.close();
    await P2.ctx.close();

    // ---------------------------------------------------------------- 3. 画面の確認
    const S = await open(c, Z);
    await go(S, 'settings');
    await S.page.waitForTimeout(800);
    const label = await S.page.locator('.settings-ranking__label').textContent();
    expect(/ランキングに ?(のる|載る)/.test(label ?? ''), `${t} 設定：「ランキングに のる」（${label}）`);
    await shot(S.page, `v22_${t}_06_settings`);
    await go(S, 'ranking');
    await S.page.waitForTimeout(1500);
    const daily = await S.page.locator('.ranking-scene').textContent();
    expect(/16/.test(daily ?? '') && !/14じ|14時/.test(daily ?? ''), `${t} ランキング：4じ と 16じ`);
    await shot(S.page, `v22_${t}_07_ranking`);
    await go(S, 'deck');
    await S.page.waitForTimeout(1200);
    const unowned = await S.page.locator('.list-panel__grid .card-mini.is-unowned, .list-panel__grid [data-unowned="1"]').count();
    expect(unowned === 0 && (await S.page.locator('[data-testid="deck-filter-owned"]').count()) === 0, `${t} デッキ編集：持っていないカードと「もっている」ボタンが無い`);
    await shot(S.page, `v22_${t}_08_deck`);
    await go(S, 'menu');
    await S.page.getByTestId('menu-daily').click();
    await S.page.waitForTimeout(900);
    const allClear = await S.page.getByTestId('daily-allClear').textContent();
    expect(!/かくてい|確定/.test(allClear ?? ''), `${t} デイリー：「ぜんぶ クリア」に確定の印が無い`);
    await shot(S.page, `v22_${t}_09_daily`);
    await go(S, 'story');
    await S.page.getByTestId('story-stage-1').waitFor();
    await S.page.getByTestId('story-stage-1').click();
    await S.page.waitForTimeout(900);
    const card = await S.page.locator('.dialog').last().textContent();
    expect(/よわい|弱い/.test(card ?? ''), `${t} ストーリー1：よわい`);
    await shot(S.page, `v22_${t}_10_story1`);
    for (const p of [S]) if (p.errors.length) problems.push(`エラー（${t}）：${p.errors.slice(0, 3).join(' / ')}`);
    await S.ctx.close();
  }
} catch (e) {
  problems.push(`止まった：${e?.stack ?? e}`);
} finally {
  for (const b of browsers) await b.close().catch(() => {});
  await w.stop();
}
if (problems.length) {
  console.log('\n問題：');
  for (const p of problems) console.log(' -', p);
  process.exit(1);
}
console.log('\nv2.2 の通しの確認：すべて通過');
