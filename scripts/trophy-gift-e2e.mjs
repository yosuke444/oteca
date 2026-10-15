// トロフィあげを すぐ届ける（v2.7。SPEC §7 S20）の通しの確認とスクリーンショット。
// 手元の Worker（wrangler dev。ポート 8787。まっさらな保存領域）を立ち上げ、ゲームは ?api=local で開く。
// 使い方：npx vite --port 5175 のまま node scripts/trophy-gift-e2e.mjs
//
// ⑤ 管理画面のタブと受け取る人のタブを同時に開き、渡してから演出が出るまでの秒数を測る（5秒以内）
// ⑥ 対戦中に渡すと、対戦中は出ず、対戦が終わってから出る
// ⑦ ゲームを閉じていた人は、次に開いた時に受け取る
// スクリーンショット（1280×720・844×390）：受け取りの演出・カードのくわしく・デッキ編集
import { LOCAL_ADMIN_KEY as ADMIN, api, newToken, pid, startWorker } from './worker-dev.mjs';
import { BASE, SIZES, launch, openPage, shot } from './pw.mjs';
import { scanPage } from './layoutScan.mjs';

const ORIGIN = 'http://localhost:5175';
const Q = '?debug=1&api=local';
const started = Date.now();
const log = (...a) => console.log(`[${((Date.now() - started) / 1000).toFixed(1)}s]`, ...a);
const problems = [];
const expect = (ok, what) => {
  if (!ok) problems.push(what);
  log(ok ? '✓' : '✗', what);
};
const times = [];

const w = await startWorker(8787);
const B = w.base;
const browser = await launch();
try {
  const R1 = { id: pid(11, 'f'), token: newToken(), name: 'もらうひと' };
  const R2 = { id: pid(12, 'f'), token: newToken(), name: 'スマホのひと' };
  for (const u of [R1, R2]) await api(B, '/register', { method: 'POST', origin: ORIGIN, body: { userId: u.id, token: u.token, name: u.name, optIn: true } });

  /** セーブを入れて開く */
  const open = async (size, user = null) => {
    const p = await openPage(browser, size, Q);
    await p.page.evaluate(async (user) => {
      const cs = await import('/src/save/cookieStore.ts');
      const sd = await import('/src/save/saveData.ts');
      const storage = { jar: cs.browserCookieJar(), local: window.localStorage, secure: false };
      cs.wipe(storage);
      const d = sd.createDefaultSave();
      d.playerName = user?.name ?? 'かんりしゃ';
      if (user) {
        d.userId = user.id;
        d.userIdRegistered = true;
        d.ranking.token = user.token;
      }
      d.tutorial = { done: true, gachaInviteShown: true, step: 0 };
      d.settings.lang = 'hira';
      d.loginBonus.claimedAt = Date.now();
      d.updateNoticeSeen = true;
      cs.persist(storage, d);
    }, user);
    await p.page.reload();
    await p.page.waitForTimeout(1200);
    await p.page.mouse.click(size.width / 2, size.height / 2);
    await p.page.getByTestId('menu-online').waitFor();
    return { ...p, size };
  };
  const go = (p, route, payload) => p.page.evaluate(([r, pl]) => window.__otecaGo(r, pl), [route, payload ?? null]);
  /** 届け係につながるまで待つ */
  const linked = async (p) => {
    for (let i = 0; i < 100; i++) {
      if (await p.page.evaluate(async () => (await import('/src/online/giftLink.ts')).giftLinkOpen())) return true;
      await p.page.waitForTimeout(100);
    }
    return false;
  };
  const savedTrophies = (p) =>
    p.page.evaluate(async () => {
      const cs = await import('/src/save/cookieStore.ts');
      return cs.load({ jar: cs.browserCookieJar(), local: window.localStorage, secure: false })?.trophies.map((t) => t.number) ?? null;
    });
  /** 演出が終わるまで（とばせるようになったら とばす） */
  const finishFx = async (p) => {
    await p.page.locator('.limited-fx__skip').waitFor({ timeout: 20000 });
    await p.page.getByTestId('limited-fx').click();
    await p.page.getByTestId('trophy-arrival').waitFor({ state: 'detached', timeout: 10000 });
  };

  // 管理画面のタブ
  const C = await open(SIZES[0]);
  await go(C, 'settings');
  await C.page.waitForTimeout(500);
  await C.page.keyboard.down('KeyO');
  await C.page.keyboard.down('KeyT');
  await C.page.keyboard.up('KeyT');
  await C.page.keyboard.up('KeyO');
  await C.page.getByTestId('admin-password').fill(ADMIN);
  await C.page.getByTestId('admin-login-go').click();
  await C.page.getByTestId('admin-code').waitFor();
  /** 管理画面で渡す（押した時刻を返す） */
  const give = async (user, number) => {
    await go(C, 'menu');
    await go(C, 'admin');
    await C.page.getByTestId('admin-code').fill('ギフトトロフィあげ');
    await C.page.getByTestId('admin-code-go').click();
    await C.page.getByTestId('admin-userid').fill(user.id);
    await C.page.getByTestId('admin-next').click();
    await C.page.getByTestId('admin-trophy-number').fill(String(number));
    await C.page.getByTestId('admin-next').click();
    await C.page.getByTestId('admin-trophy-preview').waitFor();
    const at = Date.now();
    await C.page.getByTestId('admin-trophy-send').click();
    await C.page.getByTestId('admin-done').waitFor();
    return at;
  };

  // ---------------------------------------------------------------- ⑤ 開いている人には すぐ届く
  for (const [size, user, number] of [[SIZES[0], R1, 101], [SIZES[1], R2, 201]]) {
    const R = await open(size, user);
    expect(await linked(R), `${size.name} 受け取る人のタブが届け係につながった`);
    const t0 = await give(user, number);
    await R.page.getByTestId('trophy-arrival').waitFor({ timeout: 10000 });
    const sec = (Date.now() - t0) / 1000;
    times.push(sec);
    expect(sec < 5, `⑤ ${size.name} 渡してから ${sec.toFixed(2)}秒で演出が出た（5秒以内）`);
    await R.page.waitForTimeout(2600);
    await shot(R.page, `trophygift_${size.name}_01_arrival`);
    for (const f of await scanPage(R.page)) problems.push(`${size.name} 演出：${f}`);
    await finishFx(R);
    const saved = await savedTrophies(R);
    expect(saved?.includes(number), `${size.name} セーブに ${number}（${JSON.stringify(saved)}）`);
    const box = await api(B, `/mailbox?userId=${user.id}&token=${user.token}`, { origin: ORIGIN });
    expect(box.json?.trophies?.length === 0, `${size.name} 郵便受けは「渡し済み」（${JSON.stringify(box.json)}）`);

    // デッキ編集の一覧と、カードのくわしく
    await go(R, 'deck');
    const card = R.page.getByText(`トロフィあげ（${number}）`).first();
    await card.waitFor({ timeout: 15000 });
    await card.scrollIntoViewIfNeeded();
    await R.page.waitForTimeout(800);
    await shot(R.page, `trophygift_${size.name}_02_deckedit`);
    await card.click({ button: 'right' });
    await R.page.getByTestId('card-trophy-note').waitFor({ timeout: 10000 });
    await R.page.waitForTimeout(800);
    await shot(R.page, `trophygift_${size.name}_03_detail`);
    for (const f of await scanPage(R.page)) problems.push(`${size.name} くわしく：${f}`);
    await R.page.keyboard.press('Escape');

    if (size === SIZES[0]) {
      // ---------------------------------------------------------------- ⑥ 対戦中に渡すと、終わってから
      await go(R, 'menu');
      await R.page.evaluate(() => {
        const deck = [1, 1, 1, 2, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 6];
        window.__otecaGo('battle', {
          mode: 'local',
          decks: { p1: deck, p2: deck },
          names: { p1: '1P', p2: '2P' },
          seed: 'gift',
          me: 'p1',
          record: false,
          debug: true,
          sandbox: { p1: { active: 1, bench: [], hand: [], deck: [...deck] }, p2: { active: 6, bench: [], hand: [], deck: [...deck], activeHp: 1 } },
        });
      });
      await R.page.locator('.stage .battle-board').first().waitFor();
      await give(user, 102);
      await R.page.waitForTimeout(6000);
      expect((await R.page.getByTestId('trophy-arrival').count()) === 0, '⑥ 対戦中は演出を出さない');
      expect((await savedTrophies(R))?.includes(102), '⑥ 対戦中でもセーブには入っている');
      await shot(R.page, `trophygift_${size.name}_04_inbattle`);
      // 決着まで（ターンおわり を押し続ける）
      for (let i = 0; i < 60 && !(await R.page.locator('.result').count()); i++) {
        const end = R.page.locator('.battle-end button');
        if ((await end.count()) && (await end.getAttribute('aria-disabled')) !== 'true' && (await R.page.locator('.battle-board').getAttribute('data-state')) !== 'busy') await end.click().catch(() => {});
        await R.page.waitForTimeout(500);
      }
      await R.page.locator('.result').waitFor({ timeout: 30000 });
      const tEnd = Date.now();
      await R.page.getByTestId('trophy-arrival').waitFor({ timeout: 10000 });
      expect(true, `⑥ 対戦が終わったら演出が出た（${((Date.now() - tEnd) / 1000).toFixed(2)}秒後）`);
      await R.page.waitForTimeout(2600);
      await shot(R.page, `trophygift_${size.name}_05_afterbattle`);
      await finishFx(R);

      // ---------------------------------------------------------------- ⑦ 閉じていた人は、次に開いた時に
      await R.page.goto('about:blank');
      await give(user, 103);
      await R.page.goto(BASE + Q);
      await R.page.waitForTimeout(1200);
      await R.page.mouse.click(size.width / 2, size.height / 2);
      await R.page.getByTestId('trophy-arrival').waitFor({ timeout: 15000 });
      expect(true, '⑦ 閉じていた間に渡したものは、次に開いた時に同じ演出で受け取る');
      await finishFx(R);
      const all = await savedTrophies(R);
      expect(JSON.stringify(all) === JSON.stringify([101, 102, 103]), `⑧ 1つの番号は1枚だけ（${JSON.stringify(all)}）`);
    }
    for (const e of R.errors.filter((e) => !/WebSocket|ERR_CONNECTION|Failed to load resource/.test(e))) problems.push(`${size.name} エラー：${e}`);
    await R.ctx.close();
  }
  // かんりログに、その人に渡した枚数
  await go(C, 'menu');
  await go(C, 'admin');
  await C.page.getByTestId('admin-code').fill('かんりログ');
  await C.page.getByTestId('admin-code-go').click();
  await C.page.getByText('ぜんぶで 3まい').first().waitFor({ timeout: 10000 });
  expect(true, 'かんりログに「この ひとに ぜんぶで 3まい」');
  await shot(C.page, 'trophygift_1280x720_06_adminlog');
} catch (e) {
  problems.push(String(e?.stack ?? e));
} finally {
  await browser.close();
  await w.stop();
}
console.log(`\n渡してから演出が出るまで：${times.map((t) => t.toFixed(2) + '秒').join('・')}`);
console.log(problems.length ? `\n問題 ${problems.length}件:\n` + problems.join('\n') : '\nすべて OK');
process.exit(problems.length ? 1 : 0);
