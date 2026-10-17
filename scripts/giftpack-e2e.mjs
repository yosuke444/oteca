// 大会パックを贈る（v2.7。SPEC §7 S20）の通しの確認とスクリーンショット。
// 手元の Worker（wrangler dev。ポート 8787。まっさらな保存領域）を立ち上げ、ゲームは ?api=local で開く。
// 使い方：npx vite --port 5175 のまま node scripts/giftpack-e2e.mjs
//
// ③ 管理画面のタブと受け取る人のタブ（1280×720・844×390 の2人）を同時に開き、3人まとめて贈ってから演出が出るまでの秒数を測る（5秒以内）
// ④ ゲームを閉じていた3人目は、次に開いた時に受け取る
// ⑥ 見つからないID は飛ばして知らせる
// ガチャ画面の「もっている パック」（3つ）→ 1つ開ける（デイリーパックと同じ演出）→ 2つになる
// スクリーンショット（1280×720・844×390）：受け取りの演出・ガチャ画面の大会パック・開く演出・管理画面
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
const fmt = (id) => `${id.slice(0, 5)}-${id.slice(5, 10)}-${id.slice(10)}`;

const w = await startWorker(8787);
const B = w.base;
const browser = await launch();
try {
  const R = [
    { id: pid(21, 'f'), token: newToken(), name: 'さんかA', size: SIZES[0] },
    { id: pid(22, 'f'), token: newToken(), name: 'さんかB', size: SIZES[1] },
    { id: pid(23, 'f'), token: newToken(), name: 'さんかC', size: SIZES[0] },
  ];
  for (const u of R) await api(B, '/register', { method: 'POST', origin: ORIGIN, body: { userId: u.id, token: u.token, name: u.name, optIn: true } });

  /** セーブを入れて開く */
  const open = async (size, user = null, lang = 'hira') => {
    const p = await openPage(browser, size, Q);
    await p.page.evaluate(
      async ({ user, lang }) => {
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
        d.settings.lang = lang;
        d.loginBonus.claimedAt = Date.now();
        d.updateNoticeSeen = true;
        cs.persist(storage, d);
      },
      { user, lang },
    );
    await p.page.reload();
    await p.page.waitForTimeout(1200);
    await p.page.mouse.click(size.width / 2, size.height / 2);
    await p.page.getByTestId('menu-online').waitFor();
    return { ...p, size };
  };
  /** 画面を移る（ページをめくる動きが終わるまで待つ） */
  const go = async (p, route, payload) => {
    await p.page.evaluate(([r, pl]) => window.__otecaGo(r, pl), [route, payload ?? null]);
    await p.page.waitForTimeout(1300);
  };
  const linked = async (p) => {
    for (let i = 0; i < 100; i++) {
      if (await p.page.evaluate(async () => (await import('/src/online/giftLink.ts')).giftLinkOpen())) return true;
      await p.page.waitForTimeout(100);
    }
    return false;
  };
  const saved = (p) =>
    p.page.evaluate(async () => {
      const cs = await import('/src/save/cookieStore.ts');
      const s = cs.load({ jar: cs.browserCookieJar(), local: window.localStorage, secure: false });
      return s ? { ownedPacks: s.ownedPacks, giftIds: s.giftIds } : null;
    });
  const finishFx = async (p) => {
    // もう終わっていれば何もしない
    if ((await p.page.getByTestId('gift-arrival').count()) === 0) return;
    await p.page.locator('.limited-fx__skip').waitFor({ timeout: 20000 });
    await p.page.getByTestId('gift-fx').click().catch(() => {});
    await p.page.getByTestId('gift-arrival').waitFor({ state: 'detached', timeout: 10000 });
  };
  /** 管理画面に入る */
  const loginAdmin = async (p) => {
    await go(p, 'settings');
    await p.page.waitForTimeout(500);
    await p.page.keyboard.down('KeyO');
    await p.page.keyboard.down('KeyT');
    await p.page.keyboard.up('KeyT');
    await p.page.keyboard.up('KeyO');
    await p.page.getByTestId('admin-password').fill(ADMIN);
    await p.page.getByTestId('admin-login-go').click();
    await p.page.getByTestId('admin-code').waitFor();
    await p.page.waitForTimeout(1300);
  };
  const code = async (p, c) => {
    await p.page.getByTestId('admin-code').fill(c);
    await p.page.getByTestId('admin-code-go').click();
  };

  // 受け取る人のタブ（2つの大きさ）を先に開いて、届け係につなぐ
  const R1 = await open(R[0].size, R[0]);
  const R2 = await open(R[1].size, R[1]);
  expect((await linked(R1)) && (await linked(R2)), '受け取る2人のタブが届け係につながった');

  // 管理画面のタブ
  const C = await open(SIZES[0]);
  await loginAdmin(C);
  await code(C, 'ギフトたいかいパック');
  await C.page.getByTestId('admin-giftpack').waitFor();
  const missing = pid(98, 'f');
  await C.page.getByTestId('admin-userid').fill(`${fmt(R[0].id)}\n${R[1].id}, ${R[2].id} ${missing}`);
  expect((await C.page.getByTestId('admin-gift-count').inputValue()) === '3', '1人に おくる かず は、最初から 3');
  await shot(C.page, 'giftpack_1280x720_admin_01_input');
  await C.page.getByTestId('admin-next').click();
  await C.page.getByTestId('admin-gift-confirm').waitFor();
  const confirmText = await C.page.getByTestId('admin-gift-confirm').textContent();
  expect(confirmText?.includes('3にんに 3こずつ'), `確認に「3にんに 3こずつ おくります」（${confirmText}）`);
  const miss = await C.page.getByTestId('admin-batch-missing').textContent();
  expect(miss?.includes(fmt(missing)), `⑥ 見つからないID を一覧で知らせる（${miss}）`);
  await shot(C.page, 'giftpack_1280x720_admin_02_confirm');
  for (const f of await scanPage(C.page)) problems.push(`管理画面 確認：${f}`);

  const t0 = Date.now();
  await C.page.getByTestId('admin-gift-send').click();
  await C.page.getByTestId('admin-done').waitFor();
  await shot(C.page, 'giftpack_1280x720_admin_03_done');

  // ③ 開いている2人には5秒以内に届く
  await Promise.all(
    [R1, R2].map(async (p) => {
      await p.page.getByTestId('gift-arrival').waitFor({ timeout: 10000 });
      const sec = (Date.now() - t0) / 1000;
      times.push(sec);
      expect(sec < 5, `③ ${p.size.name} 贈ってから ${sec.toFixed(2)}秒で演出が出た（5秒以内）`);
    }),
  );
  await R1.page.waitForTimeout(3000);
  for (const p of [R1, R2]) {
    await shot(p.page, `giftpack_${p.size.name}_01_arrival`);
    const note = await p.page.getByTestId('gift-fx-note').textContent();
    expect(note?.includes('3つ'), `${p.size.name} 「たいかいパック が 3つ とどいた」（${note}）`);
    for (const f of await scanPage(p.page)) problems.push(`${p.size.name} 受け取りの演出：${f}`);
  }
  for (const p of [R1, R2]) {
    await finishFx(p);
    const s = await saved(p);
    expect(s?.ownedPacks?.taikai === 3, `② ${p.size.name} 大会パックを3つ もっている（${JSON.stringify(s)}）`);
  }

  // ガチャ画面：もっている パック → 開ける
  for (const p of [R1, R2]) {
    await go(p, 'gacha');
    await p.page.getByTestId('gacha-owned').waitFor();
    const n = await p.page.getByTestId('gacha-owned-count-taikai').textContent();
    expect(n?.trim() === '×3', `${p.size.name} ガチャ画面に もっている 大会パック ×3（${n}）`);
    await p.page.waitForTimeout(500);
    await shot(p.page, `giftpack_${p.size.name}_02_gacha`);
    for (const f of await scanPage(p.page)) problems.push(`${p.size.name} ガチャ画面：${f}`);
    await p.page.getByTestId('gacha-owned-open-taikai').click();
    await p.page.getByTestId('gacha-opening').waitFor();
    await p.page.waitForTimeout(1500);
    await shot(p.page, `giftpack_${p.size.name}_03_opening`);
    // 最後まで（とばす）
    await p.page.getByTestId('gacha-skip').click().catch(() => {});
    await p.page.getByTestId('gacha-summary').waitFor({ timeout: 30000 });
    await p.page.waitForTimeout(800);
    await shot(p.page, `giftpack_${p.size.name}_04_summary`);
    const results = await p.page.locator('[data-testid^="gacha-result-"]').count();
    expect(results === 3, `${p.size.name} 開けると3まい（デイリーパックと同じ袋の数）（${results}）`);
    const s = await saved(p);
    expect(s?.ownedPacks?.taikai === 2, `${p.size.name} 開けたので のこり2つ（${JSON.stringify(s)}）`);
  }

  // ④ 閉じていた3人目：次に開いた時に受け取る
  const R3 = await open(R[2].size, R[2], 'kanji');
  await R3.page.getByTestId('gift-arrival').waitFor({ timeout: 15000 });
  expect(true, '④ 閉じていた人は、次に開いた時に同じ演出で受け取る');
  await R3.page.waitForTimeout(3200);
  await shot(R3.page, 'giftpack_1280x720_05_arrival_kanji');
  await finishFx(R3);
  expect((await saved(R3))?.ownedPacks?.taikai === 3, '④ 3人目も3つ');
  await go(R3, 'gacha');
  await R3.page.getByTestId('gacha-owned').waitFor();
  const kanji = await R3.page.locator('.gacha-owned [data-testid="pack-art-taikai"]').first().textContent();
  expect(kanji?.trim() === '大会', `漢字の設定では袋に「大会」（${kanji}）`);
  await shot(R3.page, 'giftpack_1280x720_06_gacha_kanji');

  // 管理画面（844×390）：入れる画面・かんりログ（受け取ったか）
  const C2 = await open(SIZES[1]);
  await loginAdmin(C2);
  await code(C2, 'ギフトたいかいパック');
  await C2.page.getByTestId('admin-userid').fill(`${R[0].id} ${R[1].id}`);
  await shot(C2.page, 'giftpack_844x390_admin_01_input');
  await C2.page.getByTestId('admin-next').click();
  await C2.page.getByTestId('admin-gift-confirm').waitFor();
  await shot(C2.page, 'giftpack_844x390_admin_02_confirm');
  for (const f of await scanPage(C2.page)) problems.push(`管理画面 844 確認：${f}`);
  await code(C2, 'かんりログ');
  await C2.page.getByTestId('admin-log').waitFor();
  await C2.page.getByText('うけとった').first().waitFor({ timeout: 10000 });
  expect(true, 'かんりログに「たいかいパック ×3」と「うけとった」');
  await shot(C2.page, 'giftpack_844x390_admin_03_log');
  await code(C, 'かんりログ');
  await C.page.getByTestId('admin-log').waitFor();
  await C.page.waitForTimeout(500);
  await shot(C.page, 'giftpack_1280x720_admin_04_log');

  for (const p of [R1, R2, R3]) for (const e of p.errors.filter((e) => !/WebSocket|ERR_CONNECTION|Failed to load resource/.test(e))) problems.push(`${p.size.name} エラー：${e}`);
} catch (e) {
  problems.push(String(e?.stack ?? e));
} finally {
  await browser.close();
  await w.stop();
}
console.log(`\n贈ってから演出が出るまで：${times.map((t) => t.toFixed(2) + '秒').join('・')}`);
console.log(problems.length ? `\n問題 ${problems.length}件:\n` + problems.join('\n') : '\nすべて OK');
process.exit(problems.length ? 1 : 0);
