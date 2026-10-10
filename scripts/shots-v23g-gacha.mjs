// パックガチャの演出（v2.3）の確認。1280×720 と 844×390 で：
// - スーパーレア（光る袋）・光ったのにノーマル・サプライズ（光らずスーパー）・ふつう・15袋目の かくてい・NEW 付き を撮る
// - めくっている間 0.1秒ごとに、集中線（.paper-radial）の始まりがカードにかぶっていないか、NEW がカードにかぶっていないかを確かめる
// - 「かくてい！」「サプライズ」の大きな文字が出ないこと、終わったあと粒が残らないこと
// - 演出をへらす（reduceFx）：集中線・光の筋・降るキラキラが出ず、粒が少ない。演出スピード（fxSpeed）：さいそく の方が早く終わる
// 使い方：npm run dev（ポート 5175）のまま node scripts/shots-v23g-gacha.mjs
import { BASE, SIZES, launch, openPage, shot } from './pw.mjs';

const problems = [];
const browser = await launch();

/** 乱数を決める：最初の何回かは values（0〜1）の順、そのあとは ふつうの乱数（1袋に [スーパーか・どれか・光るか]） */
const forceLuck = (page, values) =>
  page.evaluate((values) => {
    const real = crypto.getRandomValues.bind(crypto);
    const left = [...values];
    crypto.getRandomValues = (a) => {
      if (left.length && a instanceof Uint32Array && a.length === 1) {
        a[0] = Math.floor(left.shift() * 2 ** 32);
        return a;
      }
      return real(a);
    };
  }, values);

async function start(size, settings = {}) {
  const p = await openPage(browser, size);
  await p.page.evaluate(async (settings) => {
    const cs = await import('/src/save/cookieStore.ts');
    const sd = await import('/src/save/saveData.ts');
    const d = sd.createDefaultSave();
    d.tutorial = { done: true, gachaInviteShown: true, step: 0 };
    d.coins = 5000;
    d.loginBonus.claimedAt = Date.now();
    Object.assign(d.settings, settings);
    cs.persist({ jar: cs.browserCookieJar(), local: window.localStorage, secure: false }, d);
  }, settings);
  await p.page.goto(BASE + '?debug=1');
  await p.page.waitForTimeout(2500);
  await p.page.mouse.click(size.width / 2, size.height / 2);
  await p.page.locator('.menu-scene').waitFor();
  await p.page.evaluate(() => window.__otecaGo('gacha'));
  await p.page.getByTestId('gacha-scene').waitFor();
  return p;
}

/** いまの画面を調べる（かぶり・大きな文字・粒の数） */
const inspect = (page) =>
  page.evaluate(() => {
    const out = { lineHit: 0, newHit: 0, sparks: document.querySelectorAll('.spark').length, confetti: document.querySelectorAll('.paper-confetti').length, radial: 0, beams: document.querySelectorAll('.spark-beam').length, texts: [] };
    const hit = (a, b, m = 0) => a.left < b.right - m && b.left < a.right - m && a.top < b.bottom - m && b.top < a.bottom - m;
    const box = document.querySelector('.gacha-reveal__card');
    const front = document.querySelector('.gacha-reveal__front .prize-card');
    const frontVisible = front && Number(getComputedStyle(front.closest('.gacha-reveal__front')).opacity) > 0.5 && front.getBoundingClientRect().width > 40;
    // 集中線：見えている線の始まりが、カード（めくる前は裏のカードの箱）の中に入っていないか
    const cardRect = (frontVisible ? front : box)?.getBoundingClientRect();
    for (const svg of document.querySelectorAll('.paper-radial')) {
      if (Number(getComputedStyle(svg).opacity) < 0.2) continue;
      out.radial++;
      const r = svg.getBoundingClientRect();
      const k = r.width / 1280;
      for (const p of svg.querySelectorAll('path')) {
        const m = /^M([-\d.]+) ([-\d.]+)/.exec(p.getAttribute('d'));
        if (!m || !cardRect) continue;
        const x = r.left + Number(m[1]) * k;
        const y = r.top + Number(m[2]) * k;
        const pad = (Number(p.getAttribute('stroke-width')) / 2) * k + 1;
        if (x > cardRect.left - pad && x < cardRect.right + pad && y > cardRect.top - pad && y < cardRect.bottom + pad) out.lineHit++;
      }
    }
    // NEW：めくった後のカードにかぶっていないか（傾いた札の角の 3px までは見のがす）
    // （NEW はカードといっしょに回る・ふくらむので、カードが まっすぐ・等倍の時に見る）
    const nw = document.querySelector('.gacha-new');
    const ft = frontVisible ? new DOMMatrixReadOnly(getComputedStyle(front.closest('.gacha-reveal__front')).transform === 'none' ? undefined : getComputedStyle(front.closest('.gacha-reveal__front')).transform) : null;
    const still = ft && Math.abs(ft.b) < 0.02 && Math.abs(ft.a - 1) < 0.02 && Math.abs(ft.d - 1) < 0.02;
    if (nw && still && hit(nw.getBoundingClientRect(), front.getBoundingClientRect(), 3)) out.newHit++;
    for (const t of document.querySelectorAll('.paper-bigtext')) out.texts.push(t.textContent);
    return out;
  });

/** 1袋のめくりを、終わるまで 0.1秒ごとに見る。途中と最後を撮る */
async function watchReveal(page, tag, name, want) {
  await page.getByTestId('gacha-reveal').waitFor({ timeout: 20000 });
  const kind = await page.getByTestId('gacha-reveal').getAttribute('data-kind');
  if (want && kind !== want) problems.push(`${tag} ${name}：めくり方が ${kind}（${want} のはず）`);
  let max = { sparks: 0, confetti: 0, radial: 0, beams: 0 };
  const texts = new Set();
  const t0 = Date.now();
  let shotMid = false;
  for (;;) {
    const s = await inspect(page);
    if (s.lineHit) problems.push(`${tag} ${name}：集中線がカードにかぶった（${s.lineHit}本）`);
    if (s.newHit) problems.push(`${tag} ${name}：NEW がカードにかぶった`);
    for (const k of Object.keys(max)) max[k] = Math.max(max[k], s[k]);
    for (const t of s.texts) texts.add(t);
    if (!shotMid && Date.now() - t0 > 1250) {
      shotMid = true;
      await shot(page, `v23g_${tag}_${name}_a`);
    }
    if (await page.getByTestId('gacha-next').count()) break;
    if (Date.now() - t0 > 15000) break;
    await page.waitForTimeout(100);
  }
  await page.waitForTimeout(500);
  const s = await inspect(page);
  if (s.lineHit || s.newHit) problems.push(`${tag} ${name}：最後に かぶり（線 ${s.lineHit}・NEW ${s.newHit}）`);
  await shot(page, `v23g_${tag}_${name}_b`);
  for (const bad of ['サプライズ', 'かくてい', '確定']) if ([...texts].some((t) => t.includes(bad))) problems.push(`${tag} ${name}：「${bad}」の大きな文字が出た`);
  console.log(tag, name, kind, `最大：キラキラ ${max.sparks}・紙吹雪 ${max.confetti}・集中線 ${max.radial}・光の筋 ${max.beams}`, [...texts].join('／'));
  return { kind, max, ms: Date.now() - t0 };
}

try {
  for (const size of SIZES) {
    const tag = size.name;
    const { page, ctx, errors } = await start(size);
    // 3まい：1 光ってスーパー（かみ・NEW）、2 光ったのにノーマル、3 光らずスーパー（サプライズ）
    await forceLuck(page, [0.01, 0.0, 0.1, 0.5, 0.0, 0.01, 0.01, 0.0, 0.95]);
    await page.getByTestId('gacha-buy-three').click();
    await page.waitForTimeout(1200);
    await page.getByTestId('gacha-bag-0').click({ force: true });
    await watchReveal(page, tag, '01_super_new', 'super');
    if (!(await page.locator('.gacha-new').count())) problems.push(`${tag} スーパー：NEW が出ていない（初めてのカード）`);
    await page.getByTestId('gacha-next').click();
    await watchReveal(page, tag, '02_letdown', 'letdown');
    await page.getByTestId('gacha-next').click();
    await watchReveal(page, tag, '03_surprise', 'surprise');
    await page.getByTestId('gacha-next').click();
    await page.getByTestId('gacha-summary').waitFor();
    await page.waitForTimeout(600);
    const sumHit = await page.evaluate(() => {
      let n = 0;
      for (const card of document.querySelectorAll('.gacha-summary__card')) {
        const nw = card.querySelector('.gacha-summary__new');
        const pc = card.querySelector('.prize-card');
        if (!nw || !pc) continue;
        const a = nw.getBoundingClientRect();
        const b = pc.getBoundingClientRect();
        if (a.left < b.right - 3 && b.left < a.right - 3 && a.top < b.bottom - 3 && b.top < a.bottom - 3) n++;
        // 一覧の上で切れていないか
        const g = card.closest('.gacha-summary__grid').getBoundingClientRect();
        if (a.top < g.top - 1) n++;
      }
      return { n, news: document.querySelectorAll('.gacha-summary__new').length };
    });
    if (sumHit.news === 0) problems.push(`${tag} まとめ：NEW が無い`);
    if (sumHit.n) problems.push(`${tag} まとめ：NEW がカードにかぶる／切れる（${sumHit.n}）`);
    await shot(page, `v23g_${tag}_04_summary_new`);
    // 終わったあと粒が残らない（降るキラキラは止まり、飛んでいる分も消える）
    await page.waitForTimeout(4500);
    const left = await page.evaluate(() => document.querySelectorAll('.gacha-open__layer *, .spark, .paper-confetti, .paper-radial, .spark-beam').length);
    if (left) problems.push(`${tag} まとめ：演出の要素が ${left}個 残っている`);

    // ふつう ×2 → 15袋目の かくてい（ぜんぶ ふつうにして、最後だけ確定）
    await page.getByRole('button', { name: /パックを えらぶ|パックを選ぶ/ }).click();
    await forceLuck(page, Array.from({ length: 14 * 3 }, (_, i) => (i % 3 === 0 ? 0.9 : i % 3 === 1 ? 0.3 : 0.99)));
    await page.getByTestId('gacha-buy-fifteen').click();
    await page.waitForTimeout(1500);
    await page.getByTestId('gacha-bag-0').click({ force: true });
    await watchReveal(page, tag, '05_normal', 'normal');
    for (let i = 1; i < 14; i++) {
      await page.getByTestId('gacha-next').click();
      await page.getByTestId('gacha-reveal').waitFor({ timeout: 20000 });
      await page.getByTestId('gacha-next').waitFor({ timeout: 20000 });
    }
    await page.getByTestId('gacha-next').click();
    await page.getByTestId('gacha-center-14').waitFor({ timeout: 20000 });
    await shot(page, `v23g_${tag}_06_center_guaranteed`);
    if (!(await page.getByTestId('gacha-center-14').getByTestId('gacha-guarantee-tag').count())) problems.push(`${tag} かくてい：袋の金色の印が無い`);
    await watchReveal(page, tag, '07_guaranteed', 'super');
    for (const e of errors) problems.push(`${tag} エラー：${e}`);
    await ctx.close();
  }

  // 演出をへらす（reduceFx）：集中線・光の筋・降るキラキラ・紙吹雪が出ない
  {
    const size = SIZES[0];
    const { page, ctx } = await start(size, { reduceFx: true });
    await forceLuck(page, [0.01, 0.0, 0.1, 0.9, 0.3, 0.99, 0.9, 0.3, 0.99]);
    await page.getByTestId('gacha-buy-three').click();
    await page.waitForTimeout(800);
    await page.getByTestId('gacha-bag-0').click({ force: true });
    const r = await watchReveal(page, 'reduce', '08_super', 'super');
    if (r.max.radial || r.max.beams || r.max.confetti) problems.push(`reduceFx：集中線 ${r.max.radial}・光の筋 ${r.max.beams}・紙吹雪 ${r.max.confetti} が出た`);
    if (await page.locator('.gacha-spin').count()) problems.push('reduceFx：回る集中線が出た');
    await ctx.close();
  }
  // 演出スピード（fxSpeed）：ふつう と さいそく で、ふつうの袋のめくりにかかる時間
  {
    const times = [];
    for (const fxSpeed of [0, 2]) {
      const { page, ctx } = await start(SIZES[0], { fxSpeed });
      await forceLuck(page, [0.9, 0.3, 0.99, 0.9, 0.3, 0.99, 0.9, 0.3, 0.99]);
      await page.getByTestId('gacha-buy-three').click();
      await page.waitForTimeout(1000);
      const t = Date.now();
      await page.getByTestId('gacha-bag-0').click({ force: true });
      await page.getByTestId('gacha-next').waitFor({ timeout: 20000 });
      times.push(Date.now() - t);
      await ctx.close();
    }
    console.log('めくりにかかった時間（ふつう／さいそく）', times.join(' ms ／ '), 'ms');
    if (!(times[1] < times[0] * 0.8)) problems.push(`fxSpeed：さいそく が早くならない（${times.join(' / ')} ms）`);
  }
} finally {
  await browser.close();
}
console.log(problems.length ? `問題 ${problems.length}件：\n- ${[...new Set(problems)].join('\n- ')}` : 'すべて OK');
process.exit(problems.length ? 1 : 0);
