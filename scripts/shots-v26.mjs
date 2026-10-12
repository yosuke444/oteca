// v2.6 の確認とスクリーンショット（1280×720・844×390）。npm run dev（ポート 5175）のまま node scripts/shots-v26.mjs
// - 札がベンチにかぶった場面（ベンチを元の位置に戻した）：かぶった札だけ不透明度 --lasting-over-opacity（theme.css。v2.7 から 0.65）、ほかははっきり。数字が読める
// - 自爆の動き（ふつう・自分に999）
// - 自爆で両方が気絶する流れ（相手の気絶 → 相手のくりだし → 自爆した側の気絶 → 自爆した側のくりだし）
// ONLY=名前 で1つの場面だけ。REDUCE=1 で「演出をへらす」
import { BASE, SIZES, launch, openPage } from './pw.mjs';
import { scanPage } from './layoutScan.mjs';

const NL = String.fromCharCode(10);
const problems = [];
const REDUCE = process.env.REDUCE === '1';
const browser = await launch();
const DECK = [1, 1, 1, 2, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 6];
const KAMI = 8;
const MUTSU = 6;
const OTEAGE = 1;
const KARAAGE = 22;
const BAKEAGE = 27;
const TAKARA = 32;
const d = (amount, turns, at = 'active') => ({ kind: 'damage', amount, turns, at });
const h = (amount, turns, at = 'active') => ({ kind: 'heal', amount, turns, at });
const bomb = (turns, at = 'active') => ({ kind: 'faint', amount: 0, turns, at });
const side = (active, bench, lasting = [], extra = {}) => ({ active, bench, hand: [], lasting, ...extra });

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

async function openBattle(page, sb, dice = []) {
  // 前の対戦の画面が残っていると、そのボタンを押してしまうので、一度メニューへ
  await page.evaluate(() => window.__otecaGo('menu'));
  await page.locator('.stage .menu-scene').first().waitFor();
  await page.waitForTimeout(600);
  await page.evaluate(
    ({ sb, DECK, dice }) => {
      const fill = (s) => ({ ...s, deck: [...DECK] });
      window.__otecaGo('battle', { mode: 'local', decks: { p1: DECK, p2: DECK }, names: { p1: '1P', p2: '2P' }, seed: 'v26', me: 'p1', record: false, debug: true, sandbox: { p1: fill(sb.p1), p2: fill(sb.p2) }, forcedDice: dice });
    },
    { sb, DECK, dice },
  );
  await page.locator('.stage .battle-board').first().waitFor();
  await idle(page);
}

/** 札の表：かぶった札だけ --lasting-over-opacity、かぶっていない札は 1。バトル場のカード（自分の絵・HP）には重ならない。数字は 9px 以上 */
async function tagCheck(page) {
  return page.evaluate(() => {
    const out = [];
    const stage = document.querySelector('.stage');
    const k = stage.getBoundingClientRect().width / 1280;
    const hit = (a, b) => a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1;
    const others = [...stage.querySelectorAll('.battle-slot .battle-card, .battle-pile, .battle-name, .battle-turn, .battle-dice, .battle-draw')].map((e) => ({ e, r: e.getBoundingClientRect() }));
    const want = Number(getComputedStyle(document.documentElement).getPropertyValue('--lasting-over-opacity'));
    if (!(want > 0 && want < 1)) out.push(`--lasting-over-opacity が読めない（${want}）`);
    let over = 0;
    let clear = 0;
    for (const tag of stage.querySelectorAll('.lasting-table .lasting-row .lasting-tag, .lasting-table .lasting-row .lasting-more')) {
      const r = tag.getBoundingClientRect();
      const on = others.filter((o) => hit(r, o.r));
      if (on.some((o) => o.e.closest('.battle-slot--active'))) out.push('札がバトル場のカードに重なる');
      const op = Number(getComputedStyle(tag).opacity);
      if (on.length > 0) {
        over++;
        if (Math.abs(op - want) > 0.01) out.push(`かぶった札の不透明度が ${op}（${want} のはず）`);
      } else {
        clear++;
        if (op < 0.99) out.push(`かぶっていない札が透けている（${op}）`);
      }
      const num = tag.querySelector('.num');
      if (num && parseFloat(getComputedStyle(num).fontSize) * k < 9) out.push('札の数字が小さい');
    }
    return { out: [...new Set(out)], over, clear };
  });
}

async function shot(page, name) {
  await page.screenshot({ path: `screenshots/v26${REDUCE ? 'r' : ''}_${name}.png` });
}

/** 札がベンチにかぶった場面（札が多い） */
async function tagsOverBench(page, tag) {
  await openBattle(page, {
    p1: side(KAMI, [MUTSU, OTEAGE], [d(10, 1), h(20, 1), d(10, 1), d(20, 1), d(10, 2), h(10, 2), bomb(2), h(30, 3), d(10, 3), d(60, 3)]),
    p2: side(KAMI, [MUTSU, OTEAGE], [d(10, 1), d(20, 1), h(10, 1), bomb(1), d(10, 2), d(10, 3)]),
  });
  const c = await tagCheck(page);
  for (const f of c.out) problems.push(`${tag} 札がかぶる：${f}`);
  if (c.over === 0) problems.push(`${tag} 札がかぶる：ベンチにかぶった札が無い（場面の作り方）`);
  for (const f of await scanPage(page)) problems.push(`${tag} 札がかぶる：${f}`);
  await shot(page, `${tag}_01_tags_over_bench`);
  console.log(tag, 'tags_over_bench', c);
}

/** 自爆の動き：ふつう（からあげ 1：相手に30・自分に10）と、自分に999（たからばこ） */
async function selfHit(page, tag, name, sb) {
  await openBattle(page, sb, [1]);
  // 短い演出も見のがさないよう、毎フレーム見張る
  await page.evaluate(() => {
    window.__seen = new Set();
    const tick = () => {
      for (const sel of ['.fx-self-glow', '.fx-hatch', '.fx-burst', '.fx-lasting-smoke', '.fx-self-ring']) if (document.querySelector(sel)) window.__seen.add(sel);
      window.__seenRaf = requestAnimationFrame(tick);
    };
    tick();
  });
  await page.locator('.stage .battle-end__btn').first().click();
  await page.waitForSelector(REDUCE ? '.fx-hatch' : '.fx-self-glow', { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(REDUCE ? 50 : 160);
  await shot(page, `${tag}_${name}_1`);
  await page.waitForSelector('.fx-burst', { timeout: 15000 }).catch(() => {});
  await shot(page, `${tag}_${name}_2`);
  await idle(page);
  const seen = await page.evaluate(() => (cancelAnimationFrame(window.__seenRaf), [...window.__seen]));
  if (!seen.includes(REDUCE ? '.fx-hatch' : '.fx-self-glow')) problems.push(`${tag} ${name}：オレンジに光らない`);
  if (!seen.includes('.fx-burst')) problems.push(`${tag} ${name}：ダメージの数字が出ない`);
  if (REDUCE && seen.some((x) => ['.fx-self-glow', '.fx-lasting-smoke', '.fx-self-ring'].includes(x))) problems.push(`${tag} ${name}：演出をへらす なのに光・煙が出た`);
  if (!REDUCE && name.includes('big') && !seen.includes('.fx-lasting-smoke')) problems.push(`${tag} ${name}：大きな自爆の煙が出ない`);
  console.log(tag, name, seen);
}

/** 自爆で両方が気絶する流れ（ばけあげ 1：相手に300・自分に50。相手のベンチは2体＝選ぶ） */
async function bothFaint(page, tag) {
  await openBattle(page, { p1: side(BAKEAGE, [MUTSU, OTEAGE]), p2: side(MUTSU, [MUTSU, OTEAGE]) }, [1]);
  const bake = await page.locator('.stage .battle-slot--me.battle-slot--active .battle-card').first().getAttribute('data-uid').catch(() => null);
  await page.locator('.stage .battle-end__btn').first().click();
  await idle(page);
  // 1・2：相手が気絶して、相手が次を選ぶ。ばけあげ は HP0 のまま場に残る
  const hp0 = await page.evaluate(() => [...document.querySelectorAll('.stage .battle-slot--active .battle-card__hpnum')].map((e) => e.textContent));
  if (!hp0.some((t) => (t ?? '').startsWith('0/'))) problems.push(`${tag} 両方気絶：HP0 のおてあげが場に残っていない ${hp0}`);
  await shot(page, `${tag}_04_both_1_opp_choose`);
  // 相手（いまは画面の下）がベンチから出す
  await page.locator('.stage .battle-slot--me.battle-slot--bench0 .battle-card').first().click();
  const ok = page.locator('.stage').getByRole('button', { name: /だす|出す|くりだす|繰り出す/ }).first();
  if (await ok.isVisible().catch(() => false)) await ok.click();
  await page.waitForSelector('.fx-wrinkle', { timeout: 15000 }).catch(() => problems.push(`${tag} 両方気絶：自爆した側の気絶が見えない`));
  await page.waitForTimeout(300);
  await shot(page, `${tag}_04_both_2_self_faint`);
  await idle(page);
  await shot(page, `${tag}_04_both_3_self_choose`);
  const prompt = await page.locator('.stage .battle-prompt').first().textContent().catch(() => '');
  if (!/えらんで|選んで|だして|出して/.test(prompt ?? '')) problems.push(`${tag} 両方気絶：自爆した側の くりだし待ちにならない（${prompt}）`);
}

try {
  for (const size of SIZES) {
    const tag = size.name;
    const { page, ctx, errors } = await start(size);
    const run = async (name, fn) => {
      if (process.env.ONLY && process.env.ONLY !== name) return;
      try {
        await fn();
      } catch (e) {
        problems.push(`${tag} ${name}：${String(e).split(NL)[0]}`);
      }
    };
    if (!REDUCE) await run('tags', () => tagsOverBench(page, tag));
    await run('self', () => selfHit(page, tag, '02_self_hit', { p1: side(KARAAGE, [MUTSU]), p2: side(KAMI, [MUTSU]) }));
    await run('self_big', () => selfHit(page, tag, '03_self_big', { p1: side(TAKARA, [MUTSU, OTEAGE]), p2: side(KAMI, [MUTSU]) }));
    if (!REDUCE) await run('both', () => bothFaint(page, tag));
    for (const e of errors) problems.push(`${tag} エラー：${e}`);
    await ctx.close();
  }
} finally {
  await browser.close();
}
console.log(problems.length ? `${NL}見つかったこと ${problems.length}件：${NL}- ${problems.join(`${NL}- `)}` : `${NL}すべて OK`);
