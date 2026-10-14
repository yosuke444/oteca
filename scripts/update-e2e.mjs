// v2.7 新しい版のお知らせ・版が違う人どうしが つながらない仕組みの確認（Playwright）。npm run dev（ポート 5175）のまま
//   node scripts/update-e2e.mjs
// 「古い版のページ」は ?fakeBuild=old&fakeProtocol=<今の版-1>（開発中だけ効く）。開発サーバーの version.json は今の版（build: dev）。
// レート対戦は手元の Worker（wrangler dev。ポート 8787 = ?api=local）。フレンド部屋は開発用の中継 ?net=dev
//  ① 古い版のページのメニューに ふせん（新しい版のページには出ない）
//  ③ 対戦中は出ず、メニューに戻ると出る
//  ④ 古い版ではフレンド対戦・レート対戦・トレードに入れない（同じ文と「さいよみこみ」）
//  ⑤ フレンド部屋で版が違うと始まらず、古い方に「さいよみこみ してね」、新しい方に「あいてに さいよみこみ…」
//  ⑥ レート対戦：古い版の申し込みは受付係が断り「さいよみこみ」。新しい版の人と組まれない
//  ⑦ 「さいよみこみ」で新しい版が読み込まれ（?v= は消える）、セーブが残る
// ふせんと、版が違う時の画面を 1280×720・844×390 で撮る
import { readFileSync } from 'node:fs';
import { BASE, SIZES, launch, openPage } from './pw.mjs';
import { scanPage } from './layoutScan.mjs';
import { startWorker } from './worker-dev.mjs';

const NL = String.fromCharCode(10);
const problems = [];
const PROTOCOL = Number(/PROTOCOL_VERSION = ([0-9]+);/.exec(readFileSync(new URL('../src/config/version.ts', import.meta.url), 'utf8'))[1]);
const NEW_Q = '?debug=1&api=local&net=dev';
const OLD_Q = `${NEW_Q}&fakeBuild=old&fakeProtocol=${PROTOCOL - 1}`;
const TEXT = {
  note: 'あたらしい バージョンが あります。さいよみこみ して アップデートしてね',
  older: 'バージョンが ちがいます。さいよみこみ してね',
  newer: 'あいての バージョンが ふるいです。あいてに さいよみこみ してもらってね',
};
const check = (name, ok, detail = '') => {
  if (!ok) problems.push(`${name} ${detail}`);
  console.log(`${ok ? '  ✓' : '  ✗'} ${name}${ok ? '' : `  ${detail}`}`);
};

const worker = await startWorker(8787);
const browser = await launch();

/** ページを開く。blockVersion：version.json を取れなくする（古い版だと気づいていないページを作る） */
async function page(size, q, { name = 'テスト', blockVersion = false } = {}) {
  const p = await openPage(browser, size, q);
  if (blockVersion) await p.page.route('**/version.json*', (r) => r.abort());
  await p.page.waitForTimeout(1200);
  await p.page.evaluate(async (name) => {
    const cs = await import('/src/save/cookieStore.ts');
    const sd = await import('/src/save/saveData.ts');
    const d = sd.createDefaultSave();
    d.playerName = name;
    d.tutorial = { done: true, gachaInviteShown: true, step: 0 };
    d.loginBonus.claimedAt = Date.now();
    d.coins = 777;
    cs.persist({ jar: cs.browserCookieJar(), local: window.localStorage, secure: false }, d);
  }, name);
  await p.page.goto(BASE + q);
  await p.page.waitForTimeout(1500);
  await p.page.mouse.click(size.width / 2, size.height / 2);
  await p.page.locator('.stage .menu-scene').first().waitFor();
  await p.page.waitForTimeout(800);
  return p;
}
const shot = (pg, name) => pg.screenshot({ path: `screenshots/v27u_${name}.png` });
const go = (pg, r, payload) => pg.evaluate(([r, p]) => window.__otecaGo(r, p), [r, payload ?? null]);
const visible = (pg, id) => pg.getByTestId(id).first().isVisible().catch(() => false);
const scan = async (pg, tag) => {
  for (const f of await scanPage(pg)) problems.push(`${tag}：${f}`);
};

try {
  for (const size of SIZES) {
    const tag = size.name;
    console.log(`${NL}[${tag}]`);
    const fresh = await page(size, NEW_Q, { name: 'あたらしい' });
    const old = await page(size, OLD_Q, { name: 'ふるい' });

    // ① ふせん
    await old.page.getByTestId('update-note').waitFor({ timeout: 10000 }).catch(() => {});
    const noteText = await old.page.getByTestId('update-note').textContent().catch(() => '');
    check('① 古い版のメニューに ふせんと「さいよみこみ」', noteText?.includes(TEXT.note) && (await visible(old.page, 'update-reload')), noteText);
    check('① 新しい版のメニューには出ない', !(await visible(fresh.page, 'update-note')));
    await scan(old.page, `${tag} ① ふせん`);
    await shot(old.page, `${tag}_01_menu_note`);

    // ③ 対戦中は出ない → メニューに戻ると出る
    const DECK = [1, 1, 1, 2, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 6];
    await go(old.page, 'battle', { mode: 'local', decks: { p1: DECK, p2: DECK }, names: { p1: '1P', p2: '2P' }, seed: 'u', me: 'p1', record: false, debug: true, sandbox: { p1: { active: 6, bench: [], hand: [], deck: DECK }, p2: { active: 6, bench: [], hand: [], deck: DECK } } });
    await old.page.locator('.stage .battle-board').first().waitFor();
    // 対戦中にタブが表に戻った（確かめ直し）
    await old.page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await old.page.waitForTimeout(1200);
    check('③ 対戦中は ふせんを出さない', !(await visible(old.page, 'update-note')));
    await go(old.page, 'menu');
    await old.page.getByTestId('update-note').waitFor({ timeout: 10000 }).catch(() => {});
    check('③ メニューに戻ると出る', await visible(old.page, 'update-note'));

    // ④ 入れない：フレンド対戦・レート対戦・トレード
    for (const [name, open] of [
      ['フレンド対戦', async () => (await old.page.getByTestId('menu-online').click(), await old.page.getByTestId('online-friend').click())],
      ['レート対戦', async () => (await old.page.getByTestId('menu-online').click(), await old.page.getByTestId('online-rate').click())],
      ['トレード', async () => await old.page.getByTestId('menu-trade').click()],
    ]) {
      await go(old.page, 'menu');
      await old.page.locator('.stage .menu-scene').first().waitFor();
      await old.page.waitForTimeout(400);
      await open();
      await old.page.getByTestId('update-dialog').waitFor({ timeout: 8000 }).catch(() => {});
      const t = await old.page.getByTestId('update-dialog').textContent().catch(() => '');
      const entered = (await old.page.getByTestId('room-input').count()) + (await old.page.getByTestId('rate-scene').count()) + (await old.page.locator('.trade-scene').count());
      check(`④ 古い版では ${name} に入れない（同じ文と「さいよみこみ」）`, t?.includes(TEXT.note) && entered === 0 && (await visible(old.page, 'update-reload')), `${t} ${entered}`);
      if (name === 'フレンド対戦') {
        // ページがめくれる演出が終わってから
        await old.page.waitForTimeout(1200);
        await scan(old.page, `${tag} ④ ダイアログ`);
        await shot(old.page, `${tag}_02_blocked_dialog`);
      }
      await old.page.locator('.dialog').getByRole('button', { name: 'もどる' }).first().click().catch(() => {});
    }

    // ⑤ フレンド部屋：古い版（まだ気づいていない）と新しい版が同じ部屋に入る
    const oldR = await page(size, OLD_Q, { name: 'ふるい2', blockVersion: true });
    const room = String(Date.now()).slice(-6);
    for (const p of [oldR, fresh]) {
      await go(p.page, 'menu');
      await p.page.getByTestId('menu-online').click();
      await p.page.getByTestId('online-friend').click();
      await p.page.getByTestId('room-input').waitFor();
      for (const d of room) await p.page.getByRole('button', { name: d, exact: true }).click();
    }
    await Promise.all([oldR, fresh].map((p) => p.page.getByRole('button', { name: 'へやに はいる' }).first().click()));
    await Promise.all([oldR, fresh].map((p) => p.page.getByTestId('lobby-error').waitFor({ timeout: 30000 }).catch(() => {})));
    const eo = await oldR.page.getByTestId('lobby-error').textContent().catch(() => '');
    const en = await fresh.page.getByTestId('lobby-error').textContent().catch(() => '');
    check('⑤ 古い方：「バージョンが ちがいます。さいよみこみ してね」と「さいよみこみ」', eo === TEXT.older && (await visible(oldR.page, 'update-reload')), eo);
    check('⑤ 新しい方：「あいての バージョンが ふるいです…」（さいよみこみ は出ない）', en === TEXT.newer && !(await visible(fresh.page, 'update-reload')), en);
    check('⑤ 対戦は始まらない', (await oldR.page.locator('.stage .battle-board').count()) === 0 && (await fresh.page.locator('.stage .battle-board').count()) === 0);
    await fresh.page.waitForTimeout(1200);
    for (const [p, n] of [[oldR, 'old'], [fresh, 'new']]) {
      await scan(p.page, `${tag} ⑤ ${n}`);
      await shot(p.page, `${tag}_03_room_${n}`);
    }

    // ⑥ レート対戦：古い版の申し込みは受付係が断る。新しい版の人とは組まれない
    const oldRate = await page(size, OLD_Q, { name: 'ふるい3', blockVersion: true });
    const newRate = await page(size, NEW_Q, { name: 'あたらしい3' });
    for (const p of [newRate, oldRate]) {
      await p.page.getByTestId('menu-online').click();
      await p.page.getByTestId('online-rate').click();
      await p.page.getByTestId('rate-search').click();
      await p.page.waitForTimeout(800);
    }
    await oldRate.page.getByTestId('rate-error').waitFor({ timeout: 30000 }).catch(() => {});
    const re = await oldRate.page.getByTestId('rate-error').textContent().catch(() => '');
    await newRate.page.waitForTimeout(2000);
    check('⑥ 古い版の申し込みは断られ「さいよみこみ」', re === TEXT.older && (await visible(oldRate.page, 'update-reload')), re);
    check('⑥ 新しい版の人は組まれず、さがしたまま（予備の待合所へも行かない）', (await newRate.page.getByTestId('vs').count()) === 0 && (await oldRate.page.getByTestId('vs').count()) === 0 && (await visible(newRate.page, 'rate-searching')));
    await scan(oldRate.page, `${tag} ⑥`);
    await shot(oldRate.page, `${tag}_04_rate_old`);
    await newRate.page.getByTestId('rate-searching').count();

    // ⑦ 「さいよみこみ」：新しい版を ?v= 付きで開き直し、?v= は消える。セーブ（名前・コイン）は残る
    await go(old.page, 'menu');
    await old.page.getByTestId('update-note').waitFor({ timeout: 10000 });
    const navs = [];
    old.page.on('framenavigated', (f) => {
      if (f === old.page.mainFrame()) navs.push(f.url());
    });
    await old.page.getByTestId('update-note').getByTestId('update-reload').click();
    await old.page.waitForURL(/v=dev/, { timeout: 15000 }).catch(() => {});
    await old.page.waitForTimeout(2500);
    const url = old.page.url();
    const save = await old.page.evaluate(async () => {
      const cs = await import('/src/save/cookieStore.ts');
      const d = cs.load({ jar: cs.browserCookieJar(), local: window.localStorage, secure: false });
      return { name: d?.playerName, coins: d?.coins };
    });
    const build = await old.page.evaluate(async () => (await import('/src/config/version.ts')).buildId);
    check('⑦ ?v=新しい番号 を付けて開き直した', navs.some((u) => /[?&]v=dev(&|$)/.test(u)), JSON.stringify(navs));
    check('⑦ 開き直した後は ?v= が消え、新しい版（ふせんが出ない）', !/[?&]v=/.test(url) && !/fakeBuild/.test(url) && build === 'dev', `${url} ${build}`);
    await old.page.mouse.click(size.width / 2, size.height / 2);
    await old.page.locator('.stage .menu-scene').first().waitFor().catch(() => {});
    await old.page.waitForTimeout(1500);
    check('⑦ 新しい版のメニューには ふせんが出ない', !(await visible(old.page, 'update-note')));
    check('⑦ セーブが残っている（名前・コイン）', save.name === 'ふるい' && save.coins === 777, JSON.stringify(save));

    for (const p of [fresh, old, oldR, oldRate, newRate]) {
      for (const e of p.errors.filter((x) => !/version\.json|ERR_FAILED|net::/.test(x))) problems.push(`${tag} エラー：${e}`);
      await p.ctx.close();
    }
  }
} finally {
  await browser.close();
  worker.stop?.();
}
console.log(problems.length ? `${NL}見つかったこと ${problems.length}件：${NL}- ${problems.join(`${NL}- `)}` : `${NL}すべて OK`);
process.exit(0);
