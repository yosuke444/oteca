// 公開サイトの確認：タイトル → デッキ編集 → デバッグ対戦 で、画像・BGM・効果音の読み込みエラーが無いか
// 使い方：node scripts/check-public.mjs（ほかの URL は OTECA_URL=... を付ける）
process.env.OTECA_URL ??= 'https://yosuke444.github.io/oteca/';
const { BASE, SIZES, clickText, launch, openPage, toMenu, waitIdle } = await import('./pw.mjs');

const size = SIZES[0];
const problems = [];
const check = (ok, msg) => {
  console.log(`${ok ? 'OK ' : 'NG '} ${msg}`);
  if (!ok) problems.push(msg);
};

const browser = await launch();
try {
  const { ctx, page, errors } = await openPage(browser, size);
  const failed = [];
  const loaded = new Set();
  page.on('response', (r) => {
    const path = new URL(r.url()).pathname;
    if (r.status() >= 400) failed.push(`${r.status()} ${path}`);
    else if (/\.(png|mp3|js|css)$/.test(path)) loaded.add(path);
  });
  page.on('requestfailed', (r) => failed.push(`失敗 ${new URL(r.url()).pathname} ${r.failure()?.errorText ?? ''}`));

  const howls = () => page.evaluate(() => (window.Howler?._howls ?? []).map((h) => ({ src: String(h._src).split('/').slice(-2).join('/'), state: h.state(), playing: h.playing() })));
  const broken = () => page.evaluate(() => [...document.images].filter((i) => i.complete && i.naturalWidth === 0).map((i) => i.getAttribute('src')));

  // タイトル
  await page.waitForTimeout(3000);
  check((await page.locator('.title-scene .otege-art').evaluate((i) => i.naturalWidth)) > 0, 'タイトル：おてあげの絵が読めた');
  await toMenu(page, size);
  await page.waitForTimeout(3000);
  const t = await howls();
  check(t.some((h) => h.src.endsWith('bgm_title.mp3') && h.playing), `メニュー：bgm_title が流れている ${JSON.stringify(t)}`);

  // デッキ編集
  await clickText(page, 'デッキへんしゅう');
  await page.waitForTimeout(3000);
  const d = await howls();
  check(d.some((h) => h.src.endsWith('bgm_deck.mp3') && h.playing), `デッキ編集：bgm_deck が流れている ${JSON.stringify(d)}`);
  await page.locator('.card-mini--tile').first().click({ button: 'right' });
  await page.waitForTimeout(500);
  check((await page.locator('.card-art__img').evaluate((i) => i.naturalWidth)) > 0, 'デッキ編集：カードの絵が読めた');
  await clickText(page, 'とじる');
  // 自動保存 → Cookie の path
  await page.locator('.card-mini--tile').first().click();
  await page.waitForTimeout(500);
  const cookies = (await ctx.cookies()).filter((c) => c.name.startsWith('oteca'));
  check(cookies.length > 0 && cookies.every((c) => c.path === new URL(BASE).pathname), `Cookie の path（${[...new Set(cookies.map((c) => c.path))].join(',') || 'Cookie なし'}）`);
  await clickText(page, 'もどる');

  // デバッグ対戦
  await clickText(page, 'デバッグ たいせん');
  await clickText(page, 'ひとりで りょうほう');
  await waitIdle(page, 30000);
  await page.locator('.battle-hand .battle-card:not(.is-dim)').first().click();
  await clickText(page, 'バトルばに だす');
  await waitIdle(page);
  await page.locator('.battle-hand .battle-card:not(.is-dim)').first().click();
  await clickText(page, 'バトルばに だす');
  await waitIdle(page, 30000);
  await page.waitForTimeout(3000);
  const b = await howls();
  check(b.some((h) => h.src.startsWith('battle/battle_') && h.playing), `対戦：戦闘曲が流れている ${JSON.stringify(b.filter((h) => h.playing))}`);
  // 攻撃して効果音を鳴らす（合成音。音の出口が動いているか）
  await page.locator('.battle-end button').click();
  await page.waitForTimeout(4000);
  const ctxState = await page.evaluate(() => window.Howler?.ctx?.state);
  check(ctxState === 'running', `効果音：音の出口（AudioContext）が動いている（${ctxState}）`);
  check((await broken()).length === 0, `対戦：壊れた画像なし ${JSON.stringify(await broken())}`);

  // 効果音の差し替えファイル（audio/se/*.mp3）は置いていないので、確認の 404 は正常（DECISIONS #49）
  const seProbe = failed.filter((f) => /\/audio\/se\/se_|\/audio\/se\/jingle_/.test(f));
  const real = failed.filter((f) => !seProbe.includes(f));
  console.log(`効果音の差し替えファイルの確認（無くて正常）：${seProbe.length}件`);
  check(real.length === 0, `読み込みエラー（画像・BGM・プログラム）：${real.length ? real.join(' / ') : 'なし'}`);
  const kinds = { 画像: [...loaded].filter((p) => p.endsWith('.png')).length, 曲: [...loaded].filter((p) => p.endsWith('.mp3')).length };
  console.log('読み込めたファイル', JSON.stringify(kinds));
  check(errors.length === 0, `ページのエラー：${errors.length ? errors.join(' / ') : 'なし'}`);
} finally {
  await browser.close();
}
console.log(problems.length ? `\n問題 ${problems.length} 件` : '\nすべて OK');
process.exit(problems.length ? 1 : 0);
