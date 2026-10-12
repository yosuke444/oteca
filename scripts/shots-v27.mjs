// v2.7 の確認とスクリーンショット（1280×720・844×390）。npm run dev（ポート 5175）のまま node scripts/shots-v27.mjs
// - 数値を変えた5枚のカードの「くわしく」（新しい数値が出ている・古い数値が残っていない）
// - おてあげザムライのボス戦：ステージの確認カード（ボスルールの文）→ カットイン → 対戦中のボスルールの表示
// - ボスの攻撃・持続ダメージで、ダメージの数字の横に「+10」の印
// ONLY=名前 で1つの場面だけ。REDUCE=1 で「演出をへらす」（「+10」の印は出る）
import { BASE, SIZES, launch, openPage } from './pw.mjs';
import { scanPage } from './layoutScan.mjs';

const NL = String.fromCharCode(10);
const problems = [];
const REDUCE = process.env.REDUCE === '1';
const browser = await launch();
const DECK = [1, 1, 1, 2, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 6];
const ZAMURAI_STAGE = 14;
// LANG_UI=kanji で漢字の画面（ボスルールの文が長いので、折り返しを確かめる）
const KANJI = process.env.LANG_UI === 'kanji';
const RULE_HIRA = KANJI ? 'ボスのおてあげが相手に与えるダメージ+10' : 'ボスの おてあげが あいてに あたえる ダメージ +10';

async function start(size) {
  const p = await openPage(browser, size, '?debug=1&api=off');
  await p.page.waitForTimeout(1500);
  await p.page.evaluate(async ({ reduce, kanji, cleared }) => {
    const cs = await import('/src/save/cookieStore.ts');
    const sd = await import('/src/save/saveData.ts');
    const cards = await import('/src/data/cards.ts');
    const d = sd.createDefaultSave();
    for (const c of cards.CARD_LIST) d.collection[c.no] = 9;
    d.tutorial = { done: true, gachaInviteShown: true, step: 0 };
    d.loginBonus.claimedAt = Date.now();
    d.settings.reduceFx = reduce;
    d.settings.lang = kanji ? 'kanji' : 'hira';
    d.story.stages = cleared.map((no) => ({ no, cleared: true, firstClear: true }));
    cs.persist({ jar: cs.browserCookieJar(), local: window.localStorage, secure: false }, d);
  }, { reduce: REDUCE, kanji: KANJI, cleared: Array.from({ length: ZAMURAI_STAGE - 1 }, (_, i) => i + 1) });
  await p.page.goto(BASE + '?debug=1&api=off');
  await p.page.waitForTimeout(2000);
  await p.page.mouse.click(size.width / 2, size.height / 2);
  await p.page.locator('.stage .menu-scene').first().waitFor();
  return p;
}

const go = (page, r, payload) => page.evaluate(([r, p]) => window.__otecaGo(r, p), [r, payload ?? null]);
const idle = (page) =>
  page.waitForFunction(() => document.querySelector('.stage .battle-board')?.getAttribute('data-state') !== 'busy', null, { timeout: 30000 }).then(() => page.waitForTimeout(250));

async function shot(page, name) {
  await page.screenshot({ path: `screenshots/v27${REDUCE ? 'r' : ''}${KANJI ? 'k' : ''}_${name}.png` });
}

async function scan(page, tag, name) {
  for (const f of await scanPage(page)) problems.push(`${tag} ${name}：${f}`);
}

/** 5枚のカードのくわしく。has：出ているはずの文字、not：もう出ないはずの文字 */
const DETAILS = [
  ['01_bunbunbun', 'ぶんぶんぶん', ['20', '50', '30'], ['40']],
  ['02_hosoage', 'ほそあげ', ['60', '999', '10'], []],
  ['03_hon777', '777ほん', ['20', '50', '30', '10', '300'], ['100']],
  ['04_moyasu', 'もやす', ['60', '80'], ['100']],
  ['05_zamurai', 'おてあげザムライ', ['30', '50', '70', '120'], ['40', '60', '80']],
];

async function details(page, tag) {
  await go(page, 'deck');
  await page.locator('.stage .list-panel').first().waitFor();
  await page.waitForTimeout(500);
  for (const [name, card, has, not] of DETAILS) {
    let tile = page.locator('.list-panel .card-mini', { hasText: card }).first();
    if (!(await tile.count())) {
      await page.getByTestId('deck-filter-super').click();
      tile = page.locator('.list-panel .card-mini', { hasText: card }).first();
    }
    await tile.click({ button: 'right' });
    const dlg = page.locator('.dialog .card-detail', { hasText: card }).first();
    await dlg.waitFor();
    await page.waitForTimeout(400);
    const text = (await dlg.innerText()).replace(/\s+/g, ' ');
    const nums = new Set(text.match(/\d+/g) ?? []);
    for (const h of has) if (!nums.has(h)) problems.push(`${tag} ${card} くわしく：${h} が出ていない（${text}）`);
    for (const n of not) if (nums.has(n)) problems.push(`${tag} ${card} くわしく：古い数値 ${n} が残っている（${text}）`);
    await scan(page, tag, name);
    await shot(page, `${tag}_${name}_detail`);
    await page.locator('.dialog').getByRole('button', { name: 'とじる' }).first().click();
    await page.locator('.dialog').first().waitFor({ state: 'detached' }).catch(() => {});
    await page.waitForTimeout(200);
  }
}

/** ザムライのステージ：確認カード → カットイン → 対戦中のボスルール */
async function bossStage(page, tag) {
  await go(page, 'menu');
  await page.locator('.stage .menu-scene').first().waitFor();
  await page.getByRole('button', { name: 'ストーリー', exact: true }).click();
  await page.getByTestId('story-scene').waitFor();
  await page.waitForTimeout(800);
  await page.getByTestId(`story-stage-${ZAMURAI_STAGE}`).dispatchEvent('click');
  await page.getByTestId('stage-confirm').waitFor();
  await page.waitForTimeout(500);
  const rule = await page.locator('.stage-confirm__rule').first().textContent();
  if (rule !== RULE_HIRA) problems.push(`${tag} 確認カードのボスルール：${rule}`);
  await scan(page, tag, '06_confirm');
  await shot(page, `${tag}_06_boss_confirm`);
  await page.getByRole('button', { name: KANJI ? '挑戦！' : 'ちょうせん！' }).click();
  await page.getByTestId('boss-cutin').waitFor();
  await page.locator('.boss-cutin__rule').first().waitFor();
  // ペンで書き終わるまで待つ
  await page.waitForFunction(() => {
    const el = document.querySelector('.boss-cutin__rule');
    const c = el && getComputedStyle(el).clipPath;
    // clip-path の inset がすべて 0（右の 100% → 0% まで書き終わった）
    const n = (c?.match(/[0-9.]+/g) ?? []).map(Number);
    return !!c && Number(getComputedStyle(el).opacity) > 0.9 && n.length > 0 && n.every((x) => x === 0);
  }, null, { timeout: 15000 }).catch(() => problems.push(`${tag} カットインのボスルールが書き終わらない`));
  await page.waitForTimeout(150);
  const fit = await page.evaluate(() => {
    const el = document.querySelector('.boss-cutin__rule');
    const r = el.getBoundingClientRect();
    const st = document.querySelector('.stage').getBoundingClientRect();
    return { over: el.scrollWidth > el.clientWidth + 1, left: r.left - st.left, right: st.right - r.right, clip: getComputedStyle(el).clipPath };
  });
  if (fit.over || fit.left < 0 || fit.right < 0) problems.push(`${tag} カットインのボスルールが はみ出す ${JSON.stringify(fit)}`);
  await scan(page, tag, '07_cutin');
  const cut = await page.locator('.boss-cutin__rule').first().textContent();
  if (!cut?.includes(RULE_HIRA)) problems.push(`${tag} カットインのボスルール：${cut}`);
  await shot(page, `${tag}_07_boss_cutin`);
  await page.locator('.stage .battle-board').first().waitFor({ timeout: 30000 });
  // 先攻決めのサイコロと「せんこう！」のはんこが終わるまで待つ
  await page.waitForTimeout(1500);
  await idle(page);
  await page.waitForTimeout(1500);
  const inBattle = await page.getByTestId('boss-rule').textContent();
  if (!inBattle?.includes(RULE_HIRA)) problems.push(`${tag} 対戦中のボスルール：${inBattle}`);
  await scan(page, tag, '08_battle');
  await shot(page, `${tag}_08_boss_battle`);
}

/** ボス戦の「+10」の印：自分（むつあし 目1：回復）→ ボスの攻撃。持続ダメージなら、さらに自分のターンの終わり */
async function bonusMark(page, tag, name, boss, dice, ends) {
  const rules = await page.evaluate(async (no) => {
    const st = await import('/src/story/story.ts');
    return st.stageRules(st.stageByNo(no));
  }, ZAMURAI_STAGE);
  await go(page, 'menu');
  await page.locator('.stage .menu-scene').first().waitFor();
  await page.waitForTimeout(600);
  await page.evaluate(
    ({ DECK, dice, rules, boss, stage }) => {
      const side = (active) => ({ active, bench: [6], hand: [], lasting: [], deck: [...DECK] });
      window.__otecaGo('battle', { mode: 'local', decks: { p1: DECK, p2: DECK }, names: { p1: '1P', p2: 'おてあげザムライ' }, seed: 'v27', me: 'p1', record: false, debug: true, rules, story: { stage }, sandbox: { p1: side(6), p2: side(boss) }, forcedDice: dice });
    },
    { DECK, dice, rules, boss, stage: ZAMURAI_STAGE },
  );
  await page.locator('.stage .battle-board').first().waitFor();
  await idle(page);
  for (let i = 0; i < ends - 1; i++) {
    await page.locator('.stage .battle-end__btn').first().click();
    await idle(page);
  }
  await page.evaluate(() => {
    window.__marks = [];
    const tick = () => {
      for (const el of document.querySelectorAll('.fx-burst__bonus')) {
        const num = el.parentElement?.querySelector('.fx-burst__num')?.textContent;
        const key = `${num}${el.textContent}`;
        if (!window.__marks.includes(key) && getComputedStyle(el).opacity > 0.9) window.__marks.push(key);
      }
      window.__marksRaf = requestAnimationFrame(tick);
    };
    tick();
  });
  await page.locator('.stage .battle-end__btn').first().click();
  await page.waitForFunction(() => [...document.querySelectorAll('.fx-burst__bonus')].some((e) => getComputedStyle(e).opacity > 0.9), null, { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(80);
  await shot(page, `${tag}_${name}`);
  await idle(page);
  const marks = await page.evaluate(() => (cancelAnimationFrame(window.__marksRaf), window.__marks));
  console.log(tag, name, marks);
  return marks;
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
        problems.push(`${tag} ${name}：${String(e).split(NL).slice(0, 3).join(' ')}`);
        await shot(page, `${tag}_fail_${name}`).catch(() => {});
      }
    };
    if (!REDUCE) await run('details', () => details(page, tag));
    if (!REDUCE) await run('stage', () => bossStage(page, tag));
    await run('attack', async () => {
      // ザムライ 目1：30 → 40
      const m = await bonusMark(page, tag, '09_boss_attack_plus10', 44, [1, 1], 2);
      if (!m.includes('40+10')) problems.push(`${tag} ボスの攻撃：「40」と「+10」が出ない ${m}`);
    });
    await run('lasting', async () => {
      // どくさげ 目1：今すぐ 10 → 20、自分のターンの終わりに あとから 10 → 20
      const m = await bonusMark(page, tag, '10_boss_lasting_plus10', 39, [1, 1, 1], 3);
      if (!m.includes('20+10')) problems.push(`${tag} 持続ダメージ：「20」と「+10」が出ない ${m}`);
    });
    for (const e of errors) problems.push(`${tag} エラー：${e}`);
    await ctx.close();
  }
} finally {
  await browser.close();
}
console.log(problems.length ? `${NL}見つかったこと ${problems.length}件：${NL}- ${problems.join(`${NL}- `)}` : `${NL}すべて OK`);
