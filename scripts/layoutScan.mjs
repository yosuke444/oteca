// 画面のはみ出しを自動で探す（v2.3）。tests/layout.slow.test.ts（npm run test:slow）と scripts/layout-scan.mjs から使う。
// - 文字がボタン・枠（手描きの箱・ふせん・ダイアログ）からはみ出している
// - 文字が、はみ出しを隠す要素（overflow: hidden）で切れている
// - ボタンが舞台（1280×720）の外や、はみ出しを隠す親の外に出ていて押せない（スクロールできる一覧の中は、スクロールで届くのでよい）
// - ボタンどうしが重なっている（v2.4。押せるボタンだけ）
// 全部の画面を、セーブを入れて開き（window.__otecaGo。?debug=1）、ダイアログもいくつか開いて調べる。

/** 調べる大きさ（横長2つと、縦向きのスマホ。縦向きは「よこむきに してね」が重なるが、下の画面も同じ並びで調べる） */
export const SCAN_SIZES = [
  { name: '1280x720', width: 1280, height: 720 },
  { name: '844x390', width: 844, height: 390 },
  { name: '390x844', width: 390, height: 844 },
];
export const SCAN_LANGS = ['hira', 'kanji'];

/** いま出ている画面を調べる。見つかったものを文の配列で返す */
export async function scanPage(page) {
  return page.evaluate(() => {
    const out = [];
    const stage = document.querySelector('.stage');
    if (!stage) return ['舞台が無い'];
    const sr = stage.getBoundingClientRect();
    const k = sr.width / 1280; // 舞台の拡大縮小
    const tol = 3 * Math.max(k, 0.5);
    const label = (el) => (el.getAttribute('data-testid') ? `[${el.getAttribute('data-testid')}] ` : '') + (el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 24);
    // 演出のための重ね物（飛んでいく文字・粒・ページめくりの写し）は調べない
    const skip = (el) => el.closest('.rotate-hint, .paper-bigtext, .gacha-open__layer, .fx-layer, .page-turn, .trophy-rain, .limited-fx__layer, .boss-cutin__layer, .trade-scene__layer');
    const shown = (el) => {
      for (let e = el; e && e !== document.body; e = e.parentElement) {
        const cs = getComputedStyle(e);
        if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) < 0.05) return false;
      }
      const r = el.getBoundingClientRect();
      return r.width > 1 && r.height > 1;
    };
    /** スクロールできる要素か（ストーリーのマップは、ドラッグで動かして見るので同じ） */
    const scrollable = (e) => /(auto|scroll)/.test(getComputedStyle(e).overflowY) || e.classList.contains('story-map');
    /**
     * はみ出しを隠す親を全部見て、見える範囲（舞台も含む）を返す。
     * スクロールできる親は、縦はスクロールで届くので横だけ狭める。いちばん内側のスクロールできる親を el に
     */
    const clip = (el) => {
      let box = { left: sr.left, top: sr.top, right: sr.right, bottom: sr.bottom };
      let sc = null;
      for (let e = el.parentElement; e && e !== stage; e = e.parentElement) {
        const cs = getComputedStyle(e);
        if (cs.overflowX === 'visible' && cs.overflowY === 'visible') continue;
        const r = e.getBoundingClientRect();
        if (scrollable(e)) {
          sc ??= e;
          box = { ...box, left: Math.max(box.left, r.left), right: Math.min(box.right, r.right) };
        } else {
          box = { left: Math.max(box.left, r.left), top: Math.max(box.top, r.top), right: Math.min(box.right, r.right), bottom: Math.min(box.bottom, r.bottom) };
        }
      }
      return { scroll: !!sc, box, el: sc };
    };
    const outsideX = (r, b, t = tol) => r.left < b.left - t || r.right > b.right + t;
    /** 要素の中の文字（直下の文字だけ）の四角 */
    const textRects = (el) => {
      const rs = [];
      for (const n of el.childNodes) {
        if (n.nodeType !== 3 || !n.textContent.trim()) continue;
        const range = document.createRange();
        range.selectNodeContents(n);
        for (const r of range.getClientRects()) if (r.width > 0) rs.push(r);
      }
      return rs;
    };
    const outside = (r, b, t = tol) => r.left < b.left - t || r.top < b.top - t || r.right > b.right + t || r.bottom > b.bottom + t;

    // 0. スクロールできる欄そのものが外に出ている・横にスクロールが出てしまう
    for (const e of stage.querySelectorAll('*')) {
      if (skip(e) || !scrollable(e) || e.classList.contains('story-map') || !shown(e)) continue;
      const r = e.getBoundingClientRect();
      const c = clip(e);
      if (c.scroll ? outsideX(r, c.box) : outside(r, c.box)) out.push(`スクロールの欄が画面・枠の外：${label(e).slice(0, 16)}`);
      if (getComputedStyle(e).overflowX !== 'hidden' && e.scrollWidth > e.clientWidth + 2) out.push(`横にスクロールが出る：${label(e).slice(0, 16)}`);
    }

    // 1. ボタンが外に出て押せない
    for (const b of stage.querySelectorAll('button, [role="button"], .rough-btn, input, select')) {
      if (skip(b) || !shown(b)) continue;
      const r = b.getBoundingClientRect();
      const c = clip(b);
      if (c.scroll) {
        // ストーリーのマップは ドラッグで縦横に動かせる
        if (c.el.classList.contains('story-map')) continue;
        // スクロールの中：横に はみ出していないか（縦はスクロールで届く）
        if (outsideX(r, c.box)) out.push(`ボタンが横に はみ出す：${label(b)}`);
        continue;
      }
      // 9割より見えていない
      const vis = Math.max(0, Math.min(r.right, c.box.right) - Math.max(r.left, c.box.left)) * Math.max(0, Math.min(r.bottom, c.box.bottom) - Math.max(r.top, c.box.top));
      if (vis < r.width * r.height * 0.9) out.push(`ボタンが画面・枠の外：${label(b)}`);
    }

    // 2. 文字が、いちばん近い枠（ボタン・手描きの箱・ふせん・ダイアログ）から はみ出す
    const FRAME = 'button, [role="button"], .rough-btn, .rough-box, .sticky, .dialog__box, .card-mini, .battle-card';
    /** わざと枠の角・線の上に重ねて出している印（枚数・のこり・NEW・S・パネルの見出し など）。枠からのはみ出しは見ない */
    const OVERHANG = '.card-mini__count, .card-mini__left, .card-mini__new, .card-stamp, .list-panel__title, .gacha-new, .gacha-summary__new, .trade-mine__limited, .card-art__trophy-no, .daily-icon__badge, .trade-received__count';
    for (const el of stage.querySelectorAll('*')) {
      if (skip(el)) continue;
      const rs = textRects(el);
      if (!rs.length || !shown(el)) continue;
      const frame = el.closest(FRAME);
      // ストーリーのマップの ステージの名前・番号は、印の下・横に わざと出している
      const c = clip(el);
      if (frame && !frame.closest('.story-map') && !el.closest(OVERHANG)) {
        const fr = frame.getBoundingClientRect();
        // 枠の中のスクロールの中なら、縦はスクロールで見えるので横だけ見る
        const inScroll = c.scroll && frame.contains(c.el);
        const bad = (r) => (inScroll ? r.left < fr.left - tol * 2 || r.right > fr.right + tol * 2 : outside(r, fr, tol * 2));
        // 傾けた枠は四角が大きくなるので、少し甘く
        if (rs.some(bad)) out.push(`文字が枠から はみ出す：${label(el)}（枠 ${label(frame).slice(0, 12)}）`);
      }
      // 3. はみ出しを隠す要素で切れている（スクロールできる要素は除く）
      if (c.scroll ? c.el.classList.contains('story-map') ? false : rs.some((r) => outsideX(r, c.box)) : rs.some((r) => outside(r, c.box))) out.push(`文字が切れている・画面の外：${label(el)}`);
    }

    // 4. ボタンどうしが重なっている（v2.4）。いちばん上に出ているボタン（中の9点のどこかを指すと、そのボタンに当たる）だけを比べる
    //    （ダイアログ・パネルの後ろに隠れたボタンは比べない）。わざと重ねて並べるもの（対戦の手札など）は除く。
    //    はみ出しを隠す親（スクロールの欄も）の外に出ている部分は見えないので、見える部分どうしで比べる
    const STACKED = '.battle-hand, .story-map, .gacha-open__bags, .choose-panel';
    const visibleBox = (el) => {
      let b = { left: sr.left, top: sr.top, right: sr.right, bottom: sr.bottom };
      for (let e = el.parentElement; e && e !== stage; e = e.parentElement) {
        const cs = getComputedStyle(e);
        if (cs.overflowX === 'visible' && cs.overflowY === 'visible') continue;
        const r = e.getBoundingClientRect();
        b = { left: Math.max(b.left, r.left), top: Math.max(b.top, r.top), right: Math.min(b.right, r.right), bottom: Math.min(b.bottom, r.bottom) };
      }
      return b;
    };
    const hits = [];
    for (const b of stage.querySelectorAll('button, [role="button"], .rough-btn')) {
      if (skip(b) || !shown(b) || b.closest(STACKED)) continue;
      const br = b.getBoundingClientRect();
      const vb = visibleBox(b);
      const r = { left: Math.max(br.left, vb.left), top: Math.max(br.top, vb.top), right: Math.min(br.right, vb.right), bottom: Math.min(br.bottom, vb.bottom) };
      if (r.right - r.left < 2 || r.bottom - r.top < 2) continue;
      let onTop = false;
      for (const fx of [0.15, 0.5, 0.85]) {
        for (const fy of [0.15, 0.5, 0.85]) {
          const at = document.elementFromPoint(r.left + (r.right - r.left) * fx, r.top + (r.bottom - r.top) * fy);
          if (at && (at === b || b.contains(at))) onTop = true;
        }
      }
      if (onTop) hits.push({ b, r });
    }
    const gap = 6 * Math.max(k, 0.5);
    for (let i = 0; i < hits.length; i++) {
      for (let j = i + 1; j < hits.length; j++) {
        const p = hits[i];
        const q = hits[j];
        if (p.b.contains(q.b) || q.b.contains(p.b)) continue;
        const w = Math.min(p.r.right, q.r.right) - Math.max(p.r.left, q.r.left);
        const h = Math.min(p.r.bottom, q.r.bottom) - Math.max(p.r.top, q.r.top);
        if (w > gap && h > gap) out.push(`ボタンどうしが重なる：${label(p.b).slice(0, 16)} と ${label(q.b).slice(0, 16)}`);
      }
    }
    return [...new Set(out)];
  });
}

/** 開く画面の一覧：[名前, 開き方]。開き方は page を受け取って画面を出す */
export const SCREENS = [
  ['title', async (p) => p.evaluate(() => window.__otecaGo('title'))],
  ['menu', async (p) => p.evaluate(() => window.__otecaGo('menu'))],
  ['menu_daily', async (p) => {
    await p.evaluate(() => window.__otecaGo('menu'));
    await p.getByTestId('menu-daily').click();
  }],
  ['deck', async (p) => p.evaluate(() => window.__otecaGo('deck'))],
  ['rules', async (p) => p.evaluate(() => window.__otecaGo('rules'))],
  ['settings', async (p) => p.evaluate(() => window.__otecaGo('settings'))],
  ['settings_wipe', async (p) => {
    await p.evaluate(() => window.__otecaGo('settings'));
    await p.getByTestId('settings-wipe').click();
  }],
  ['settings_make_code', async (p) => {
    await p.evaluate(() => window.__otecaGo('settings'));
    await p.getByRole('button', { name: /コードを つくる|コードを作る/ }).click();
  }],
  ['settings_enter_code', async (p) => {
    await p.evaluate(() => window.__otecaGo('settings'));
    await p.getByRole('button', { name: /コードを いれる|コードを入れる/ }).click();
  }],
  ['deck_detail', async (p) => {
    await p.evaluate(() => window.__otecaGo('deck'));
    await p.locator('.card-mini--tile').first().click({ button: 'right' });
  }],
  ['tutorial', async (p) => p.evaluate(() => window.__otecaGo('tutorial'))],
  ['lang', async (p) => p.evaluate(() => window.__otecaGo('lang'))],
  ['rate', async (p) => p.evaluate(() => window.__otecaGo('rate'))],
  ['cpu', async (p) => p.evaluate(() => window.__otecaGo('cpu'))],
  ['online', async (p) => p.evaluate(() => window.__otecaGo('online'))],
  ['lobby', async (p) => p.evaluate(() => window.__otecaGo('lobby'))],
  // フレンド対戦の待機画面（部屋番号を入れて入った後。v2.4）
  ['lobby_wait', async (p) => {
    await p.evaluate(() => window.__otecaGo('lobby'));
    for (const d of '482913') await p.getByRole('button', { name: d, exact: true }).click();
    await p.getByRole('button', { name: /へやに はいる|部屋に入る/ }).click();
    await p.locator('.lobby--wait').waitFor();
    await p.waitForTimeout(400);
  }],
  // レート対戦の「あいてを さがしています」（v2.4）
  ['rate_search', async (p) => {
    await p.evaluate(() => window.__otecaGo('rate'));
    await p.getByTestId('rate-search').click();
    await p.getByTestId('rate-searching').waitFor();
    await p.waitForTimeout(400);
  }],
  ['story', async (p) => p.evaluate(() => window.__otecaGo('story'))],
  ['story_confirm', async (p) => {
    await p.evaluate(() => window.__otecaGo('story'));
    await p.getByTestId('story-stage-1').click({ force: true });
  }],
  ['gacha', async (p) => p.evaluate(() => window.__otecaGo('gacha'))],
  ['gacha_contents', async (p) => {
    await p.evaluate(() => window.__otecaGo('gacha'));
    await p.getByTestId('gacha-pack').click();
  }],
  ['gacha_help', async (p) => {
    await p.evaluate(() => window.__otecaGo('gacha'));
    await p.getByTestId('mode-guide-gacha').getByTestId('mode-guide-help').click();
  }],
  ['gacha_summary', async (p) => {
    await p.evaluate(() => window.__otecaGo('gacha'));
    await p.getByTestId('gacha-buy-fifteen').click();
    await p.waitForTimeout(800);
    await p.getByTestId('gacha-skip').click();
    await p.getByTestId('gacha-summary').waitFor();
  }],
  ['trade', async (p) => p.evaluate(() => window.__otecaGo('trade'))],
  ['ranking', async (p) => p.evaluate(() => window.__otecaGo('ranking'))],
  ['name', async (p) => p.evaluate(() => window.__otecaGo('name'))],
  ['battle', async (p) => {
    const deck = [1, 2, 3, 4, 5, 6, 7, 9, 10, 1, 2, 3, 4, 5, 6];
    await p.evaluate((d) => window.__otecaGo('battle', { mode: 'cpu', cpuLevel: 'weak', decks: { p1: d, p2: d }, names: { p1: 'たろう', p2: 'CPU（よわい）' }, seed: 'scan', me: 'p1', record: false }), deck);
    await p.waitForTimeout(3500);
  }],
  ['result_cpu', async (p) => p.evaluate(() => window.__otecaGo('result', {
    setup: { mode: 'cpu', cpuLevel: 'weak', decks: { p1: [1], p2: [1] }, names: { p1: 'たろう', p2: 'CPU（よわい）' }, seed: 'x', me: 'p1', record: false },
    winner: 'p1', reason: 'ko',
    stats: { turns: 12, turnCounts: { p1: 6, p2: 6 }, sides: { p1: { damage: 300, kos: 3, mvpNo: 1, mvpDamage: 150 }, p2: { damage: 120, kos: 1, mvpNo: 2, mvpDamage: 120 } } },
    log: [], finalHash: '00000000',
  }))],
  ['result_online', async (p) => p.evaluate(() => window.__otecaGo('result', {
    setup: { mode: 'online', decks: { p1: [1], p2: [1] }, names: { p1: 'たろう', p2: 'はなこ' }, seed: 'x', me: 'p1', record: true, game: 1 },
    winner: 'p1', reason: 'ko',
    stats: { turns: 12, turnCounts: { p1: 6, p2: 6 }, sides: { p1: { damage: 300, kos: 3, mvpNo: 1, mvpDamage: 150 }, p2: { damage: 120, kos: 1, mvpNo: 2, mvpDamage: 120 } } },
    log: [], finalHash: '00000000',
  }))],
  ['result_story_lose', async (p) => p.evaluate(() => window.__otecaGo('result', {
    setup: { mode: 'cpu', cpuLevel: 'weak', decks: { p1: [1], p2: [1] }, names: { p1: 'たろう', p2: 'らくがき こぞう' }, seed: 'x', me: 'p1', record: false, story: { stage: 1 } },
    winner: 'p2', reason: 'ko',
    stats: { turns: 12, turnCounts: { p1: 6, p2: 6 }, sides: { p1: { damage: 100, kos: 1, mvpNo: 1, mvpDamage: 100 }, p2: { damage: 300, kos: 3, mvpNo: 2, mvpDamage: 150 } } },
    log: [], finalHash: '00000000',
  }))],
];

/** 調べる用のセーブを入れる（チュートリアル済み・カードを全部・ストーリーを途中まで・コイン） */
export async function seedSave(page, lang) {
  // 文字のまま渡す（テストの道具が import() を書き換えないように）
  await page.evaluate(`(async (lang) => {
    const cs = await import('/src/save/cookieStore.ts');
    const sd = await import('/src/save/saveData.ts');
    const cards = await import('/src/data/cards.ts');
    const d = sd.createDefaultSave();
    d.tutorial = { done: true, gachaInviteShown: true, step: 0 };
    d.settings.lang = lang;
    d.coins = 12345;
    d.playerName = 'ながい なまえ';
    d.loginBonus.claimedAt = Date.now();
    for (const c of cards.CARD_LIST) d.collection[c.no] = Math.max(d.collection[c.no] ?? 0, 3);
    d.story.stages = Array.from({ length: 6 }, (_, i) => ({ no: i + 1, cleared: true, firstClear: true }));
    d.stats = { wins: 123, losses: 45 };
    cs.persist({ jar: cs.browserCookieJar(), local: window.localStorage, secure: false }, d);
  })(${JSON.stringify(lang)})`);
}

/**
 * 全部の画面・大きさ・言語を調べる。onShot(page, name) を渡すと各画面で呼ぶ（スクリーンショット用）
 * @returns 見つかったもの（「大きさ 言語 画面：内容」の文の配列）
 */
export async function scanAll(browser, base, { sizes = SCAN_SIZES, langs = SCAN_LANGS, screens = SCREENS, onShot } = {}) {
  const found = [];
  for (const size of sizes) {
    for (const lang of langs) {
      const ctx = await browser.newContext({ viewport: { width: size.width, height: size.height }, deviceScaleFactor: 1 });
      const page = await ctx.newPage();
      page.setDefaultTimeout(15000);
      const errors = [];
      page.on('pageerror', (e) => errors.push(String(e)));
      await page.goto(base + '?debug=1');
      await page.waitForTimeout(800);
      await seedSave(page, lang);
      await page.goto(base + '?debug=1&api=off');
      await page.waitForTimeout(2000);
      // 縦向きの「よこむきに してね」は外して、下の画面を調べる（縦向きでも並びは横長と同じ舞台を縮めたもの）
      await page.addStyleTag({ content: '.rotate-hint { display: none !important; }' });
      await page.mouse.click(size.width / 2, size.height / 2);
      await page.waitForTimeout(1200);
      for (const [name, open] of screens) {
        try {
          await page.keyboard.press('Escape').catch(() => {});
          await open(page);
          await page.waitForTimeout(1300);
          for (const f of await scanPage(page)) found.push(`${size.name} ${lang} ${name}：${f}`);
          if (onShot) await onShot(page, `${size.name}_${lang}_${name}`);
        } catch (e) {
          found.push(`${size.name} ${lang} ${name}：開けなかった（${String(e).split('\n')[0]}）`);
        }
      }
      for (const e of errors) found.push(`${size.name} ${lang}：エラー ${e.slice(0, 120)}`);
      await ctx.close();
    }
  }
  return found;
}
