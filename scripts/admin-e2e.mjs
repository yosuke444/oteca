// 管理者メニュー（v2.0-J。SPEC §7 S20・§16-2j J09）の通しの確認とスクリーンショット。
// 手元の Worker（wrangler dev。ポート 8787。まっさらな保存領域。手元用の管理キー）を立ち上げ、ゲームは ?api=local で開く。
// 使い方：npm run dev（ポート 5175）のまま node scripts/admin-e2e.mjs
//
// 1. 空の部屋を観戦 →「まだ ひとは いません」→ 2人が入って対戦が始まると映る（両者の手札は裏）・対戦者に「かんせんちゅう」
// 2. 途中から観戦に入る（2人目・3人目の観戦者）→ 4人目は「かんせんは 3にん まで」
// 3. トロフィーを送る → 受け取る（v2.7：限定カードと同じ演出）→ デッキに入れられる → トレードに出せない
// 4. 停止 → オンラインに入れない → 停止解除で戻る
// 5. スクリーンショット（両方の言語・2つの大きさ）：設定のユーザーID・管理者メニュー・観戦・トロフィーのカード
//    （ランキングは scripts/shots-ranking.mjs。まとめ処理を2回動かす確認は npm run test:worker と PROGRESS の 1.）
import { LOCAL_ADMIN_KEY as ADMIN, api, newToken, pid, startWorker } from './worker-dev.mjs';
import { SIZES, launch, openPage, shot } from './pw.mjs';
import { step } from './online-step.mjs';

const ORIGIN = 'http://localhost:5175';
const Q = '?debug=1&api=local';
const started = Date.now();
const log = (...a) => console.log(`[${((Date.now() - started) / 1000).toFixed(1)}s]`, ...a);
const problems = [];
const expect = (ok, what) => {
  if (!ok) problems.push(what);
  log(ok ? '✓' : '✗', what);
};

const w = await startWorker(8787);
const B = w.base;
const browsers = [];
try {
  // 遊ぶ2人（登録済み）
  const A = { id: pid(1, 'e'), token: newToken(), name: 'あおぞら' };
  const Bp = { id: pid(2, 'e'), token: newToken(), name: 'たぬき' };
  for (const u of [A, Bp]) await api(B, '/register', { method: 'POST', origin: ORIGIN, body: { userId: u.id, token: u.token, name: u.name, optIn: true } });

  const browser = await launch();
  browsers.push(browser);

  /** セーブを入れて開く（user：登録済みのユーザー。無ければ未登録の新しい ID） */
  const open = async (size, lang, user = null) => {
    const p = await openPage(browser, size, Q);
    await p.page.evaluate(
      async ({ lang, user }) => {
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
        d.settings.fxSpeed = 2;
        d.loginBonus.claimedAt = Date.now();
        d.updateNoticeSeen = true;
        cs.persist(storage, d);
      },
      { lang, user },
    );
    await p.page.reload();
    await p.page.waitForTimeout(1500);
    await p.page.mouse.click(size.width / 2, size.height / 2);
    await p.page.getByTestId('menu-online').waitFor();
    return { ...p, size, lang };
  };
  const go = (p, route, payload) => p.page.evaluate(([r, pl]) => window.__otecaGo(r, pl), [route, payload ?? null]);

  /** O と T の同時押し → パスワード（v2.4）→ 管理者メニュー */
  const loginAdmin = async (p, tag) => {
    await go(p, 'settings');
    await p.page.waitForTimeout(600);
    await p.page.keyboard.down('KeyO');
    expect((await p.page.getByTestId('admin-password').count()) === 0, `${tag} O だけでは何も出ない`);
    await p.page.keyboard.down('KeyT');
    await p.page.keyboard.up('KeyT');
    await p.page.keyboard.up('KeyO');
    await p.page.getByTestId('admin-password').fill('wrong-password');
    await p.page.getByTestId('admin-login-go').click();
    await p.page.getByTestId('admin-login-note').filter({ hasText: /4/ }).waitFor();
    if (tag) await shot(p.page, `admin_${tag}_01_login_wrong`);
    await p.page.getByTestId('admin-password').fill(ADMIN);
    await p.page.getByTestId('admin-login-go').click();
    await p.page.getByTestId('admin-scene').waitFor();
    await p.page.getByTestId('admin-code').waitFor();
  };
  const code = async (p, c) => {
    await p.page.getByTestId('admin-code').fill(c);
    await p.page.getByTestId('admin-code-go').click();
  };
  /** 大会閲覧：部屋番号を入れて観戦の画面へ */
  const watch = async (p, room) => {
    await code(p, '大会閲覧');
    await p.page.getByTestId('admin-watch-room').fill(room);
    await p.page.getByTestId('admin-watch-go').click();
    await p.page.getByTestId('spectate-scene').or(p.page.locator('.battle')).first().waitFor();
  };

  // ---------------------------------------------------------------- 1. 空の部屋を観戦 → 対戦が始まって映る
  const room = String(Date.now()).slice(-6);
  const C = await open(SIZES[0], 'hira');
  await loginAdmin(C, '1280x720_hira');
  await shot(C.page, 'admin_1280x720_hira_02_menu');
  await watch(C, room);
  await C.page.getByTestId('spectate-empty').waitFor({ timeout: 20000 });
  expect(true, '空の部屋：「まだ ひとは いません」');
  await shot(C.page, 'spectate_1280x720_hira_01_empty');

  const PA = await open(SIZES[0], 'hira', A);
  const PB = await open(SIZES[1], 'hira', Bp);
  for (const p of [PA, PB]) {
    await p.page.getByTestId('menu-online').click();
    await p.page.getByTestId('online-friend').click();
    await p.page.getByTestId('room-input').waitFor();
    for (const d of room) await p.page.getByRole('button', { name: d, exact: true }).click();
    await p.page.getByRole('button', { name: 'へやに はいる' }).click();
  }
  await Promise.all([PA.page.locator('.battle').waitFor({ timeout: 60000 }), PB.page.locator('.battle').waitFor({ timeout: 60000 })]);
  log('対戦が始まった');
  await C.page.locator('.battle').waitFor({ timeout: 30000 });
  expect(true, '対戦が始まったら観戦の画面に映る');
  await C.page.waitForTimeout(2500);
  const hidden = await C.page.locator('.battle-hand .battle-card:not(.is-back)').count();
  expect(hidden === 0, `観戦：両者の手札は裏（表のカード ${hidden}枚）`);
  await shot(C.page, 'spectate_1280x720_hira_02_battle');
  await PA.page.getByTestId('spectated-badge').waitFor({ timeout: 15000 });
  expect(true, '対戦者に「かんせんちゅう」');
  await shot(PA.page, 'spectate_1280x720_hira_03_player_badge');

  // 少し進める
  const st = { A: { item: false, ends: 0 }, B: { item: false, ends: 0 } };
  const play = async (n) => {
    for (let i = 0; i < n; i++) {
      const ra = await step({ page: PA.page }, st.A);
      const rb = await step({ page: PB.page }, st.B);
      if (ra === 'over' && rb === 'over') return true;
      if (ra === 'wait' && rb === 'wait') await PA.page.waitForTimeout(120);
    }
    return false;
  };
  await play(40);

  // ---------------------------------------------------------------- 2. 途中から観戦（2人目・3人目）→ 4人目は入れない
  const D = await open(SIZES[1], 'kanji');
  await loginAdmin(D, '844x390_kanji');
  await shot(D.page, 'admin_844x390_kanji_02_menu');
  await watch(D, room);
  await D.page.locator('.battle').waitFor({ timeout: 30000 });
  await D.page.waitForTimeout(3000);
  expect(true, '途中から観戦に入って映る');
  // 同じ場面（状態ハッシュ。デバッグ表示がある時だけ比べる）
  const hashOf = (p) => p.page.getByTestId('state-hash').textContent({ timeout: 2000 }).catch(() => null);
  for (let i = 0; i < 20; i++) {
    const [ha, hd] = await Promise.all([hashOf(PA), hashOf(D)]);
    if (ha && hd && ha === hd) {
      expect(true, '途中から入っても、対戦者と同じ場面（状態ハッシュ）');
      break;
    }
    if (i === 19) expect(!ha || !hd, `途中から入った場面が対戦者と同じ（${ha} / ${hd}）`);
    await D.page.waitForTimeout(500);
  }
  await shot(D.page, 'spectate_844x390_kanji_01_midway');
  const E = await open(SIZES[0], 'kanji');
  await loginAdmin(E, '1280x720_kanji');
  await shot(E.page, 'admin_1280x720_kanji_02_menu');
  await watch(E, room);
  await E.page.locator('.battle').waitFor({ timeout: 30000 });
  await E.page.waitForTimeout(2000);
  await shot(E.page, 'spectate_1280x720_kanji_01_battle');
  const F = await open(SIZES[1], 'hira');
  await loginAdmin(F, '844x390_hira');
  await shot(F.page, 'admin_844x390_hira_02_menu');
  await watch(F, room);
  await F.page.getByTestId('spectate-full').waitFor({ timeout: 20000 });
  expect(true, '4人目の観戦者は「かんせんは 3にん まで」');
  await shot(F.page, 'spectate_844x390_hira_01_full');

  // 決着まで
  expect(await play(3000), '対戦が決着した');
  await C.page.getByTestId('spectate-winner').waitFor({ timeout: 30000 });
  expect(true, '観戦の画面にも勝ち負けが出る');
  await shot(C.page, 'spectate_1280x720_hira_04_winner');
  for (const p of [PA, PB]) await p.page.getByRole('button', { name: 'メニューへ' }).click();

  // ---------------------------------------------------------------- 3. トロフィー：送る → 受け取る → デッキ → トレード不可
  await go(C, 'admin');
  await code(C, 'ギフトトロフィあげ');
  await C.page.getByTestId('admin-userid').fill(A.id);
  await C.page.getByTestId('admin-next').click();
  await C.page.getByTestId('admin-trophy-number').fill('77');
  await C.page.getByTestId('admin-next').click();
  await C.page.getByTestId('admin-trophy-preview').waitFor();
  await shot(C.page, 'trophy_1280x720_hira_01_confirm');
  await C.page.getByTestId('admin-trophy-send').click();
  await C.page.getByTestId('admin-done').waitFor();
  // 同じ番号は送れない
  await go(C, 'menu');
  await go(C, 'admin');
  await code(C, 'ギフトトロフィあげ');
  await C.page.getByTestId('admin-userid').fill(Bp.id);
  await C.page.getByTestId('admin-next').click();
  await C.page.getByTestId('admin-trophy-number').fill('77');
  await C.page.getByTestId('admin-next').click();
  await C.page.getByTestId('admin-trophy-send').click();
  await C.page.getByTestId('admin-note').filter({ hasText: 'もう つかわれているよ' }).waitFor();
  expect(true, '同じ番号は「その ばんごうは もう つかわれているよ」');
  await shot(C.page, 'trophy_1280x720_hira_02_used');

  // 受け取る（起動した時に郵便受けを確かめる）
  await PA.page.reload();
  await PA.page.waitForTimeout(1500);
  await PA.page.mouse.click(PA.size.width / 2, PA.size.height / 2);
  await PA.page.getByTestId('trophy-arrival').waitFor({ timeout: 20000 });
  expect(true, 'トロフィーが届いて、限定カードと同じ演出（v2.7）');
  await PA.page.waitForTimeout(2600);
  await shot(PA.page, 'trophy_1280x720_hira_03_arrival');
  await PA.page.locator('.limited-fx__skip').waitFor({ timeout: 20000 });
  await PA.page.getByTestId('limited-fx').click();
  await PA.page.getByTestId('trophy-arrival').waitFor({ state: 'detached' });
  const owned = await PA.page.evaluate(async () => {
    const c = await import('/src/save/collection.ts');
    const cs = await import('/src/save/cookieStore.ts');
    const tr = await import('/src/trade/trade.ts');
    const save = cs.load({ jar: cs.browserCookieJar(), local: window.localStorage, secure: false });
    if (!save) return null;
    return { trophies: save.trophies.map((t) => t.number), count: c.getOwnedCount(save, 50077), canTrade: tr.canAdd(save, {}, 50077) };
  });
  expect(owned?.trophies?.includes(77) && owned.count === 1, `セーブにトロフィー 77（${JSON.stringify(owned)}）`);
  expect(owned && owned.canTrade === false, 'トロフィーはトレードに出せない');
  // デッキに入れる（デッキへんしゅうの一覧に出る）
  await go(PA, 'deck');
  const trophyCard = PA.page.getByText('トロフィあげ（77）').first();
  await trophyCard.waitFor({ timeout: 15000 });
  expect(true, 'デッキへんしゅうの一覧にトロフィあげ（77）');
  await shot(PA.page, 'trophy_1280x720_hira_04_deckedit');

  // ---------------------------------------------------------------- 4. 停止 → オンラインに入れない → 停止解除で戻る
  await go(C, 'menu');
  await go(C, 'admin');
  await code(C, 'アカウント停止');
  await C.page.getByTestId('admin-userid').fill(A.id);
  await C.page.getByTestId('admin-next').click();
  await C.page.getByTestId('admin-days-7').click();
  await C.page.getByTestId('admin-reason').fill('かくにん');
  await C.page.getByTestId('admin-next').click();
  await shot(C.page, 'suspend_1280x720_hira_01_confirm');
  await C.page.getByTestId('admin-suspend-send').click();
  await C.page.getByTestId('admin-done').waitFor();
  await go(PA, 'menu');
  await PA.page.getByTestId('menu-online').click();
  await PA.page.getByTestId('suspension-text').waitFor({ timeout: 15000 });
  expect(true, '停止中はオンラインに入れない（知らせが出る）');
  await shot(PA.page, 'suspend_1280x720_hira_02_blocked');
  await PA.page.getByTestId('suspension-ok').click();
  await PA.page.getByTestId('menu-online').waitFor();

  await go(C, 'menu');
  await go(C, 'admin');
  await code(C, '停止解除');
  await C.page.getByTestId('admin-userid').fill(A.id);
  await C.page.getByTestId('admin-next').click();
  await C.page.getByTestId('admin-unsuspend-send').click();
  await C.page.getByTestId('admin-done').waitFor();
  await PA.page.getByTestId('menu-online').click();
  await PA.page.getByTestId('online-friend').waitFor();
  await PA.page.waitForTimeout(3000);
  expect((await PA.page.getByTestId('suspension-text').count()) === 0, '停止解除の後はオンラインに入れる');

  // 検索・かんりログ
  await go(C, 'menu');
  await go(C, 'admin');
  await code(C, '検索');
  await C.page.getByTestId('admin-search-go').click();
  await C.page.getByTestId('admin-search-row').first().waitFor();
  await shot(C.page, 'admin_1280x720_hira_03_search');
  await go(C, 'menu');
  await go(C, 'admin');
  await code(C, 'かんりログ');
  await C.page.getByTestId('admin-log-row').first().waitFor();
  await shot(C.page, 'admin_1280x720_hira_04_log');

  // ---------------------------------------------------------------- 5. 両方の言語・2つの大きさ：設定のユーザーID・トロフィーのカード
  await api(B, '/admin/trophy', { method: 'POST', admin: ADMIN, origin: null, body: { userId: Bp.id, number: 5 } });
  for (const size of SIZES)
    for (const lang of ['hira', 'kanji']) {
      const tag = `${size.name}_${lang}`;
      const p = await open(size, lang, Bp);
      await go(p, 'settings');
      await p.page.getByTestId('settings-userid-value').waitFor();
      await shot(p.page, `settings_${tag}_userid`);
      // トロフィーのカード（郵便受けで受け取った後のデッキへんしゅう）
      await p.page.evaluate(async () => {
        const cs = await import('/src/save/cookieStore.ts');
        const storage = { jar: cs.browserCookieJar(), local: window.localStorage, secure: false };
        const save = cs.load(storage);
        save.trophies = [{ number: 5, receivedAt: Date.now() }];
        cs.persist(storage, save);
      });
      await p.page.reload();
      await p.page.waitForTimeout(1500);
      await p.page.mouse.click(size.width / 2, size.height / 2);
      await p.page.getByTestId('menu-online').waitFor();
      await go(p, 'deck');
      await p.page.getByText('トロフィあげ（5）').first().click();
      await p.page.waitForTimeout(800);
      await shot(p.page, `trophy_${tag}_card`);
      await p.ctx.close();
    }

  for (const p of [C, D, E, F, PA, PB]) if (p.errors.length) problems.push(`エラー（${p.lang} ${p.size.name}）：${p.errors.slice(0, 3).join(' / ')}`);
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
console.log('\n管理者メニューの通しの確認：すべて通過');
