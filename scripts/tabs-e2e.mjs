// 複数のタブ（v2.3）の確認。同じブラウザに2つのタブを開く。
// 使い方：npm run dev（ポート 5175）のまま node scripts/tabs-e2e.mjs
//
// ① 2つ目のタブは「ほかの タブで ひらいています」で止まり、セーブを書かない
// ② 2つ目で「この タブで あそぶ」を押すと（1つ目が対戦中なら確認が出る）、1つ目は「べつの タブで ひらかれました」で止まる
// ③ 止まったタブを操作しても（あとから書こうとしても）セーブは変わらない
import { BASE, SIZES, clickText, launch, shot, toMenu as toMenuBase } from './pw.mjs';

const started = Date.now();
const log = (...a) => console.log(`[${((Date.now() - started) / 1000).toFixed(1)}s]`, ...a);
const problems = [];
const expect = (ok, what) => {
  if (!ok) problems.push(what);
  log(ok ? '✓' : '✗', what);
};

/** いまのセーブ（Cookie と localStorage の控え） */
const saveOf = (page) =>
  page.evaluate(() => ({
    cookie: document.cookie
      .split('; ')
      .filter((c) => c.startsWith('oteca_s') || c.startsWith('oteca_meta'))
      .sort()
      .join('; '),
    local: localStorage.getItem('oteca_save'),
  }));
const same = (a, b) => a.cookie === b.cookie && a.local === b.local;
/** BGM を鳴らしているか（howler の音がひとつでも鳴っているか） */
const playing = (page) => page.evaluate(() => (window.Howler?._howls ?? []).some((h) => h.playing()));

const size = SIZES[0];
/** 新しいセーブ：タイトル → ことば（にほんご）→ なまえ → チュートリアルを とばす → メニュー */
async function toMenu(page) {
  await page.waitForTimeout(800);
  await page.mouse.click(size.width / 2, size.height / 2);
  const lang = page.getByTestId('lang-hira');
  await lang.or(page.getByTestId('name-ok')).first().waitFor();
  if (await lang.isVisible()) await lang.click();
  await toMenuBase(page, size);
}
const browser = await launch();
try {
  const ctx = await browser.newContext({ viewport: { width: size.width, height: size.height }, deviceScaleFactor: 1 });
  const errors = [];
  const watch = (p, name) => {
    p.on('pageerror', (e) => errors.push(`${name}: ${e}`));
    p.on('console', (m) => m.type() === 'error' && errors.push(`${name}: ${m.text()}`));
  };
  const a = await ctx.newPage();
  watch(a, 'A');
  await a.goto(BASE + '?debug=1');
  await toMenu(a);
  expect((await a.evaluate(() => window.__otecaTab.state())) === 'active', '1つ目のタブが動いている');

  // ① 2つ目のタブ
  const before = await saveOf(a);
  const b = await ctx.newPage();
  watch(b, 'B');
  await b.goto(BASE + '?debug=1');
  await b.getByTestId('tab-blocked-other').waitFor({ timeout: 8000 });
  expect(await b.getByText(/ほかの タブで ひらいています|ほかのタブで開いています/).isVisible(), '① 2つ目のタブに「ほかの タブで ひらいています」');
  await shot(b, 'v23_tab_other');
  await b.mouse.click(200, 200);
  await b.waitForTimeout(1500);
  expect((await b.evaluate(() => window.__otecaTab.state())) === 'blocked', '① 2つ目のタブは止まっている');
  expect(same(before, await saveOf(a)), '① 2つ目のタブを開いてもセーブは変わらない');
  expect((await b.locator('.title-scene, .menu-scene').count()) === 0, '① 2つ目のタブにゲームの画面が出ない');
  expect(await playing(a), '（対照）1つ目のタブは BGM を鳴らしている');
  expect(!(await playing(b)), '① 2つ目のタブは BGM を鳴らさない');

  // ② 1つ目を対戦中にしてから、2つ目で「この タブで あそぶ」
  await clickText(a, 'CPUたいせん');
  await a.getByTestId('cpu-scene').waitFor();
  await clickText(a, 'よわい');
  await a.getByTestId('deck-slot-0').click();
  await a.waitForTimeout(300);
  await a.getByTestId('deck-slot-0').click();
  await a.locator('.battle-board').waitFor({ timeout: 15000 });
  await a.waitForTimeout(500);
  await b.getByTestId('tab-play-here').click();
  await b.getByTestId('tab-play-warn').waitFor({ timeout: 5000 });
  expect(await b.getByText(/もう ひとつの タブの たいせんは まけに なります|もう1つのタブの対戦は負けになります/).isVisible(), '② 対戦中なら「もう ひとつの タブの たいせんは まけに なります」');
  await shot(b, 'v23_tab_confirm');
  await b.getByTestId('tab-play-cancel').click();
  await b.waitForTimeout(300);
  expect((await b.evaluate(() => window.__otecaTab.state())) === 'blocked' && (await a.evaluate(() => window.__otecaTab.state())) === 'active', '② 「やめる」なら何も変わらない');
  await b.getByTestId('tab-play-here').click();
  await b.getByTestId('tab-play-ok').click();
  await a.getByTestId('tab-blocked-stolen').waitFor({ timeout: 8000 });
  expect(await a.getByText(/べつの タブで ひらかれました|別のタブで開かれました/).isVisible(), '② 元のタブに「べつの タブで ひらかれました」');
  expect((await a.evaluate(() => window.__otecaTab.state())) === 'stolen', '② 元のタブは止まった');
  expect((await a.locator('.battle-board').count()) === 0, '② 元のタブの対戦画面は消えた');
  await b.locator('.title-scene, [data-testid="title-scene"]').first().waitFor({ timeout: 8000 }).catch(() => {});
  expect((await b.evaluate(() => window.__otecaTab.state())) === 'active', '② 2つ目のタブが動き出した');
  await a.waitForTimeout(1200);
  expect(!(await playing(a)), '② 止まった元のタブは BGM を鳴らさない');
  expect(await playing(b), '② 動き出したタブは BGM を鳴らす（押した操作で音が戻る）');
  await shot(a, 'v23_tab_stolen');

  // ③ 止まったタブを操作しても、あとから書こうとしても、セーブは変わらない
  await b.waitForTimeout(800);
  const mid = await saveOf(b);
  await a.mouse.click(300, 300);
  await a.keyboard.press('Escape');
  await a.mouse.click(640, 600);
  await a.evaluate(() => window.__otecaTab.lateWrite(123456));
  await a.waitForTimeout(2500);
  const after = await saveOf(b);
  expect(same(mid, after), '③ 止まったタブを操作・あとから書こうとしてもセーブは変わらない');
  // 動いているタブからは書ける（確認用の書き込みが効くこと自体の確かめ）
  await b.evaluate(() => window.__otecaTab.lateWrite(777));
  expect(!same(after, await saveOf(b)), '③（対照）動いているタブからは書ける');

  // 取り返す：元のタブの「この タブで あそぶ」（2つ目は対戦中でないので確認なし）
  await a.getByTestId('tab-play-here').click();
  await b.getByTestId('tab-blocked-stolen').waitFor({ timeout: 8000 });
  // 移る側は、札を書いてから少し（0.3秒）待って動き出す
  await a.waitForFunction(() => window.__otecaTab.state() === 'active', null, { timeout: 5000 }).catch(() => {});
  expect((await a.evaluate(() => window.__otecaTab.state())) === 'active', '元のタブで取り返せる');

  // 読み込み直したタブは、すぐ動ける（前のページの鍵が残って「ほかの タブ」にならない）
  await b.close();
  await a.reload();
  await a.waitForTimeout(2500);
  expect((await a.evaluate(() => window.__otecaTab.state())) === 'active', '読み込み直しても動ける');

  // Web Locks が使えないブラウザの代わり（localStorage の札と心拍）
  const ctx2 = await browser.newContext({ viewport: { width: size.width, height: size.height } });
  await ctx2.addInitScript(() => {
    Object.defineProperty(navigator, 'locks', { value: undefined, configurable: true });
  });
  const c = await ctx2.newPage();
  watch(c, 'C');
  await c.goto(BASE + '?debug=1');
  await toMenu(c);
  const d = await ctx2.newPage();
  watch(d, 'D');
  await d.goto(BASE + '?debug=1');
  await d.getByTestId('tab-blocked-other').waitFor({ timeout: 8000 });
  expect(true, '（Web Locks なし）2つ目のタブが止まる');
  await d.getByTestId('tab-play-here').click();
  await c.getByTestId('tab-blocked-stolen').waitFor({ timeout: 8000 });
  expect(true, '（Web Locks なし）切り替えると元のタブが止まる');
  const m2 = await saveOf(d);
  await c.evaluate(() => window.__otecaTab.lateWrite(4242));
  await c.waitForTimeout(1500);
  expect(same(m2, await saveOf(d)), '（Web Locks なし）止まったタブはセーブを書かない');

  expect(errors.length === 0, `エラーなし ${errors.slice(0, 5).join(' / ')}`);
} finally {
  await browser.close();
}
log(problems.length === 0 ? 'すべて OK' : `問題 ${problems.length}件：\n- ${problems.join('\n- ')}`);
process.exit(problems.length === 0 ? 0 : 1);
