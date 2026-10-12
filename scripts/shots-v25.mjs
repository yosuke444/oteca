// v2.5 の確認とスクリーンショット（1280×720・844×390）。npm run dev（ポート 5175）のまま node scripts/shots-v25.mjs
// 持続効果の新しい見た目と動き：
// - カードの横の表：札が1つ・1行に3つ・3行すべて埋まった・入りきらない（「+N」を押して全部を見る）
// - 山札の遅延ドロー：1つ・2つ
// - 発動：持続ダメージ・持続回復・ばくだん・遅延ドロー・ターンが進む（行が上がる）・ベンチに戻って消える
// 見る点：札がカードの絵・HP・相手のカード・ベンチと重ならない、はみ出しが無い（scripts/layoutScan.mjs）、
//         発動の時に攻撃の動き（カードの突進）が出ない
// ONLY=名前 で1つの場面だけ撮る（例 ONLY=fire_bomb）。REDUCE=1 で「演出をへらす」（札が光って数字が出るだけ。しずく・煙が出ないこと）
import { BASE, SIZES, launch, openPage } from './pw.mjs';
import { scanPage } from './layoutScan.mjs';

const problems = [];
const REDUCE = process.env.REDUCE === '1';
const browser = await launch();
const DECK = [1, 1, 1, 2, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 6];
const KAMI = 8;
const MUTSU = 6;
const OTEAGE = 1;

const d = (amount, turns, at = 'active') => ({ kind: 'damage', amount, turns, at });
const h = (amount, turns, at = 'active') => ({ kind: 'heal', amount, turns, at });
const bomb = (turns, at = 'active') => ({ kind: 'faint', amount: 0, turns, at });
const draw = (amount, turns) => ({ kind: 'draw', amount, turns, at: 'player' });
const side = (active, bench, lasting = [], extra = {}) => ({ active, bench, hand: [], lasting, ...extra });

/** 場面：p1 が画面の下（自分）、p2 が上（相手） */
const SCENES = [
  { name: '01_tag_one', sb: { p1: side(KAMI, [MUTSU], [d(20, 1)]), p2: side(MUTSU, [OTEAGE]) } },
  { name: '02_row_three', sb: { p1: side(KAMI, [MUTSU]), p2: side(KAMI, [MUTSU], [d(10, 1), d(20, 1), h(10, 1)]) } },
  {
    name: '03_rows_full',
    sb: {
      p1: side(KAMI, [MUTSU, OTEAGE], [d(10, 1), h(20, 1), d(10, 1), d(10, 2), bomb(2), h(30, 3), d(10, 3)]),
      p2: side(KAMI, [MUTSU], [d(10, 1), bomb(3)]),
    },
  },
  {
    name: '04_overflow',
    sb: { p1: side(KAMI, [MUTSU], [d(10, 1), h(20, 1), d(10, 1), d(20, 1), h(10, 1), d(10, 1), d(10, 2), d(10, 2), h(20, 2), d(60, 2)]), p2: side(KAMI, [MUTSU], [d(10, 1), d(10, 1), d(10, 1), d(10, 1), d(10, 1)]) },
    openMore: true,
  },
  { name: '05_draw_one', sb: { p1: side(KAMI, [MUTSU], [draw(4, 9)]), p2: side(KAMI, [MUTSU]) } },
  { name: '06_draw_two', sb: { p1: side(KAMI, [MUTSU], [draw(4, 9), draw(2, 3)]), p2: side(KAMI, [MUTSU], [draw(1, 5), draw(4, 12)]) } },
  { name: '07_bench_bomb', sb: { p1: side(KAMI, [MUTSU, OTEAGE], [bomb(2, 'bench0'), d(10, 1)]), p2: side(KAMI, [MUTSU], [bomb(1, 'bench0')]) } },
  // 発動の場面（p1 の1ターン目は攻撃しない。ターンを終えると p1 に付いた持続効果が発動する）
  { name: 'fire_damage', sb: { p1: side(KAMI, [MUTSU], [d(30, 1), d(20, 2)]), p2: side(MUTSU, [OTEAGE]) }, fire: '.fx-lasting-drop', after: '.fx-burst' },
  { name: 'fire_heal', sb: { p1: side(KAMI, [MUTSU], [h(30, 1)], { activeHp: 120 }), p2: side(MUTSU, [OTEAGE]) }, fire: '.fx-lasting-pillar', after: '.fx-write--green' },
  { name: 'fire_bomb', sb: { p1: side(KAMI, [MUTSU], [bomb(1)]), p2: side(MUTSU, [OTEAGE]) }, fire: '.lasting-tag.is-blink', after: '.fx-lasting-smoke' },
  { name: 'fire_draw', sb: { p1: side(KAMI, [MUTSU], [draw(3, 1), draw(2, 4)]), p2: side(MUTSU, [OTEAGE]) }, fire: '.lasting-draw.is-fire', after: '.fx-cardback' },
  { name: 'fire_order', sb: { p1: side(KAMI, [MUTSU], [d(10, 1), h(20, 1), d(30, 1), d(10, 2), h(10, 3)], { activeHp: 150 }), p2: side(MUTSU, [OTEAGE]) }, fire: '.fx-lasting-drop', tick: true },
  { name: 'bench_clear', sb: { p1: side(KAMI, [MUTSU], [d(10, 1), h(20, 1), d(20, 2), bomb(2)]), p2: side(MUTSU, [OTEAGE]) }, swap: true, fire: '.lasting-tag', after: null },
];

async function start(size) {
  const p = await openPage(browser, size, '?debug=1&api=off');
  await p.page.waitForTimeout(1500);
  await p.page.evaluate(async (reduce) => {
    const cs = await import('/src/save/cookieStore.ts');
    const sd = await import('/src/save/saveData.ts');
    const cards = await import('/src/data/cards.ts');
    const d = sd.createDefaultSave();
    for (const c of cards.CARD_LIST) d.collection[c.no] = 3;
    d.tutorial = { done: true, gachaInviteShown: true, step: 0 };
    d.loginBonus.claimedAt = Date.now();
    d.settings.reduceFx = reduce;
    cs.persist({ jar: cs.browserCookieJar(), local: window.localStorage, secure: false }, d);
  }, REDUCE);
  await p.page.goto(BASE + '?debug=1&api=off');
  await p.page.waitForTimeout(2000);
  await p.page.mouse.click(size.width / 2, size.height / 2);
  await p.page.locator('.stage .menu-scene').first().waitFor();
  return p;
}

const idle = (page) =>
  page.waitForFunction(() => document.querySelector('.stage .battle-board')?.getAttribute('data-state') !== 'busy', null, { timeout: 30000 }).then(() => page.waitForTimeout(250));

async function openBattle(page, sb) {
  await page.evaluate(
    ({ sb, DECK }) => {
      const fill = (s) => ({ ...s, deck: [...DECK] });
      window.__otecaGo('battle', { mode: 'local', decks: { p1: DECK, p2: DECK }, names: { p1: '1P', p2: '2P' }, seed: 'v25', me: 'p1', record: false, debug: true, sandbox: { p1: fill(sb.p1), p2: fill(sb.p2) } });
    },
    { sb, DECK },
  );
  await page.locator('.stage .battle-board').first().waitFor();
  await idle(page);
}

/** 札の表が、カード（絵・HP）・ベンチ・相手のカードと重ならないか。山札の札が すてふだ と重ならないか */
async function overlapCheck(page) {
  return page.evaluate(() => {
    const out = [];
    const stage = document.querySelector('.stage');
    const k = stage.getBoundingClientRect().width / 1280;
    const R = (el) => el.getBoundingClientRect();
    const hit = (a, b) => a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1;
    const cards = [...stage.querySelectorAll('.battle-slot .battle-card')];
    for (const t of stage.querySelectorAll('.lasting-table')) {
      for (const tag of t.querySelectorAll('.lasting-tag, .lasting-more')) {
        for (const c of cards) if (hit(R(tag), R(c))) out.push(`表の札がカードと重なる：${c.textContent.slice(0, 8)}`);
        // 844×390 でも数字が読める（9px 以上）
        const num = tag.querySelector('.num') ?? tag;
        const px = parseFloat(getComputedStyle(num).fontSize) * k;
        if (tag.classList.contains('lasting-tag--bomb') === false && px < 9) out.push(`札の数字が小さい ${px.toFixed(1)}px`);
      }
    }
    const discard = [...stage.querySelectorAll('.battle-pile--discard')];
    for (const tg of stage.querySelectorAll('.lasting-draw')) {
      for (const p of discard) if (hit(R(tg), R(p.firstElementChild))) out.push('山札の札が すてふだ と重なる');
      const px = parseFloat(getComputedStyle(tg.querySelector('.lasting-draw__left')).fontSize) * k;
      if (px < 9) out.push(`「あと」が小さい ${px.toFixed(1)}px`);
    }
    return [...new Set(out)];
  });
}

/** 発動の間、バトル場のカードが突進（大きく縦に動く）しないか見張る */
async function watchLunge(page) {
  await page.evaluate(() => {
    window.__lunge = 0;
    window.__fired = false;
    window.__stop = false;
    // 持続効果の発動が始まってから見張る（その前の、ふつうの攻撃の突進は数えない）。気絶して飛んでいくカードも数えない
    const firing = () => document.querySelector('.lasting-tag.is-fire, .lasting-draw.is-fire, .fx-lasting-drop, .fx-lasting-pillar, .fx-lasting-smoke');
    const tick = () => {
      if (firing()) window.__fired = true;
      // 気絶（くしゃっと丸まって飛ぶ）と、そのあとのくりだし（ベンチから持ち上がる）は数えない
      if (document.querySelector('.stage .fx-wrinkle')) window.__stop = true;
      if (window.__stop) return;
      if (window.__fired) for (const c of document.querySelectorAll('.stage .battle-slot--active .battle-card')) {
        if (c.querySelector('.fx-wrinkle')) continue;
        const m = new DOMMatrixReadOnly(getComputedStyle(c).transform);
        window.__lunge = Math.max(window.__lunge, Math.abs(m.m42));
      }
      window.__lungeRaf = requestAnimationFrame(tick);
    };
    tick();
  });
}
const lunge = (page) => page.evaluate(() => (cancelAnimationFrame(window.__lungeRaf), window.__lunge));

/** 演出をへらす：札が光って、数字が出るだけ（しずく・光の柱・煙は出ない） */
async function reduceScene(page, tag, sc, base) {
  await page.evaluate(() => {
    window.__seen = new Set();
    const tick = () => {
      for (const s of ['.fx-lasting-drop', '.fx-lasting-pillar', '.fx-lasting-smoke', '.fx-lasting-ring']) if (document.querySelector(s)) window.__seen.add(s);
      if (document.querySelector('.lasting-tag.is-fire, .lasting-draw.is-fire')) window.__seen.add('glow');
      window.__seenRaf = requestAnimationFrame(tick);
    };
    tick();
  });
  await page.locator('.stage .battle-end__btn').first().click();
  await page.waitForSelector('.lasting-tag.is-fire, .lasting-draw.is-fire', { timeout: 15000 }).catch(() => {});
  await page.screenshot({ path: `${base}_1.png` });
  await idle(page);
  const seen = await page.evaluate(() => (cancelAnimationFrame(window.__seenRaf), [...window.__seen]));
  if (!seen.includes('glow')) problems.push(`${tag} ${sc.name}：演出をへらす で札が光らない`);
  const extra = seen.filter((s) => s !== 'glow');
  if (extra.length) problems.push(`${tag} ${sc.name}：演出をへらす なのに ${extra.join(' ')} が出た`);
  console.log(tag, sc.name, 'reduce', seen);
}

async function scene(page, tag, sc) {
  await openBattle(page, sc.sb);
  const base = `screenshots/v25${REDUCE ? 'r' : ''}_${tag}_${sc.name}`;
  if (REDUCE && sc.fire && !sc.swap) return reduceScene(page, tag, sc, base);
  if (!sc.fire) {
    const found = [...(await scanPage(page)), ...(await overlapCheck(page))];
    for (const f of found) problems.push(`${tag} ${sc.name}：${f}`);
    await page.screenshot({ path: `${base}.png` });
    if (sc.openMore) {
      const more = page.locator('.stage .lasting-table--me .lasting-more').first();
      if (!(await more.count())) problems.push(`${tag} ${sc.name}：「+N」が出ていない`);
      else {
        await more.click();
        await page.locator('.stage .lasting-all').first().waitFor();
        await page.screenshot({ path: `${base}_open.png` });
        const all = await page.locator('.stage .lasting-all .lasting-tag').count();
        if (all < 10) problems.push(`${tag} ${sc.name}：全部を見ても ${all}こ しか出ない`);
      }
    }
    console.log(tag, sc.name, found.length ? found : 'ok');
    return;
  }
  await watchLunge(page);
  if (sc.swap) {
    // ベンチのおてあげを選んで「こうたい」
    await page.locator('.stage .battle-slot--me.battle-slot--bench0 .battle-card').first().click();
    await page.locator('.stage').getByRole('button', { name: /^こうたい$|^交代$/ }).first().click();
    await page.locator('.stage .dialog').getByRole('button', { name: /こうたい する|交代する/ }).first().click();
    await page.waitForSelector('.fx-overlay .fx-onom, .stage .fx-onom', { timeout: 8000 }).catch(() => {});
    await page.screenshot({ path: `${base}_1.png` });
    await idle(page);
    await page.screenshot({ path: `${base}_2.png` });
  } else {
    await page.locator('.stage .battle-end__btn').first().click();
    const firstSeen = await page.waitForSelector(sc.fire, { timeout: 15000 }).then(() => true, () => false);
    if (!firstSeen) problems.push(`${tag} ${sc.name}：発動の動き（${sc.fire}）が出ない`);
    await page.screenshot({ path: `${base}_1.png` });
    if (sc.after) {
      const seen = await page.waitForSelector(sc.after, { timeout: 15000 }).then(() => true, () => false);
      if (!seen) problems.push(`${tag} ${sc.name}：続きの動き（${sc.after}）が出ない`);
      await page.screenshot({ path: `${base}_2.png` });
    }
    if (sc.tick) {
      // ターンが進む：行が1つ上がる途中
      await page.waitForFunction(() => [...document.querySelectorAll('.stage .lasting-table [data-seq]')].some((e) => /matrix|translate/.test(getComputedStyle(e).transform) && getComputedStyle(e).transform !== 'none'), null, { timeout: 15000 }).catch(() => problems.push(`${tag} ${sc.name}：行が上がる動きが見えない`));
      await page.screenshot({ path: `${base}_2.png` });
    }
    await idle(page);
    await page.screenshot({ path: `${base}_3.png` });
  }
  const l = await lunge(page);
  if (l > 30) problems.push(`${tag} ${sc.name}：カードが突進している（${l.toFixed(0)}px）`);
  console.log(tag, sc.name, `lunge ${l.toFixed(0)}px`);
}

/** 説明文：ルールせつめいの「あとから くる こうか」・カードのくわしく（どくさげ・ばくだん・たからばこ） */
async function texts(page, tag) {
  const check = async (name) => {
    await page.waitForTimeout(800);
    const found = await scanPage(page);
    for (const f of found) problems.push(`${tag} ${name}：${f}`);
    await page.screenshot({ path: `screenshots/v25_${tag}_${name}.png` });
    console.log(tag, name, found.length ? found : 'ok');
  };
  await page.evaluate(() => window.__otecaGo('rules'));
  await page.locator('.stage .rules-scene, .stage .rules-page').first().waitFor();
  for (let i = 0; i < 6; i++) {
    await page.locator('.stage').getByRole('button', { name: /つぎ|次/ }).first().click();
    await page.waitForTimeout(900);
  }
  if (!(await page.locator('.stage .rules-art--lasting').count())) problems.push(`${tag} ルール：あとから くる こうか のページが無い`);
  await check('text_rules');
  for (const name of ['どくさげ', 'ばくだん', 'たからばこ']) {
    await page.evaluate(() => window.__otecaGo('deck'));
    await page.locator('.stage .list-panel').first().waitFor();
    await page.locator('.stage .list-panel .card-mini', { hasText: name }).first().click({ button: 'right' });
    await page.locator('.dialog .card-detail').first().waitFor();
    if (!(await page.getByTestId('card-lasting-note').count())) problems.push(`${tag} くわしく ${name}：ちゅういが無い`);
    await check(`text_detail_${name === 'どくさげ' ? 'dokusage' : name === 'ばくだん' ? 'bakudan' : 'takarabako'}`);
    await page.keyboard.press('Escape');
  }
  await page.evaluate(() => window.__otecaGo('menu'));
}

try {
  for (const size of SIZES) {
    const tag = size.name;
    const { page, ctx, errors } = await start(size);
    if (!process.env.ONLY || process.env.ONLY === 'text') await texts(page, tag).catch((e) => problems.push(`${tag} 説明文：${String(e).split('\n')[0]}`));
    for (const sc of SCENES) {
      if (process.env.ONLY && sc.name !== process.env.ONLY) continue;
      try {
        await scene(page, tag, sc);
      } catch (e) {
        problems.push(`${tag} ${sc.name}：${String(e).split('\n')[0]}`);
      }
    }
    for (const e of errors) problems.push(`${tag} エラー：${e}`);
    await ctx.close();
  }
} finally {
  await browser.close();
}
console.log(problems.length ? `\n見つかったこと ${problems.length}件：\n- ${problems.join('\n- ')}` : '\nすべて OK');
