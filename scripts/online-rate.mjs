// レート対戦に4つのブラウザ（v2.0-G。UPDATE_v2 §8-5・SPEC §16 R07）。開発用の中継 ?net=dev を使う（npm run dev のまま）。
// 1. 4人が「さがす」→ 2組できる → VS（名前とレート）→ 降参で決着 → レートの変化（+10／−10）とコイン
// 2. 4人が「つぎの しあいへ」→ 直前の相手とは組まれない
// 3. 対戦中にページを読み込み直した人は、次に開いた時に負け（おしらせ）。相手は30秒後に「つうしんが きれたので かち」
// 使い方：node scripts/online-rate.mjs 0（1280×720）／1（844×390） [hira|kanji]
import { SIZES, launch, openPage, shot } from './pw.mjs';

const size = SIZES[Number(process.argv[2] ?? 0)];
const lang = process.argv[3] ?? 'hira';
const browser = await launch();
const problems = [];
const K = lang === 'kanji';
const L = K ? { surrender: 'おてあげする（降参）', yes: 'おてあげする' } : { surrender: 'おてあげする（こうさん）', yes: 'おてあげする' };
const NAMES = ['あおい', 'ぶどう', 'ちくわ', 'だいず'];

async function save(p) {
  return p.page.evaluate(async () => {
    const cs = await import('/src/save/cookieStore.ts');
    const d = cs.load({ jar: cs.browserCookieJar(), local: window.localStorage, secure: false });
    return { rate: d.rate, stats: d.rateStats, last: d.lastRateOpponentId, pending: d.pendingRateMatch, id: d.playerId, coins: d.coins };
  });
}

async function player(name) {
  const p = await openPage(browser, size, '?debug=1&net=dev');
  await p.page.evaluate(
    async ({ name, lang }) => {
      const cs = await import('/src/save/cookieStore.ts');
      const sd = await import('/src/save/saveData.ts');
      const storage = { jar: cs.browserCookieJar(), local: window.localStorage, secure: false };
      cs.wipe(storage);
      const d = sd.createDefaultSave();
      d.playerName = name;
      d.tutorial = { done: true, gachaInviteShown: true };
      d.settings.lang = lang;
      d.settings.fxSpeed = 2;
      d.loginBonus.lastDate = 99999999;
      cs.persist(storage, d);
    },
    { name, lang },
  );
  await p.page.reload();
  await p.page.waitForTimeout(2000);
  await p.page.mouse.click(size.width / 2, size.height / 2);
  await p.page.getByTestId('menu-online').click();
  return { name, ...p };
}

async function snap(p, n) {
  await p.page.waitForTimeout(400);
  await shot(p.page, `rate_${size.name}_${lang}_${n}_${p.name}`);
}

async function surrender(p) {
  await p.page.locator('.battle-board').waitFor({ timeout: 60000 });
  await p.page.waitForTimeout(2500);
  await p.page.locator('.battle-top__btn--gear').click();
  await p.page.getByRole('button', { name: L.surrender }).click();
  await p.page.getByRole('button', { name: L.yes, exact: true }).click();
}

/** VS 画面の相手の名前 */
const vsOpp = async (p) => (await p.page.locator('.lobby-vs__side--opp .lobby-vs__name').textContent()).trim();

const ps = [];
for (const n of NAMES) ps.push(await player(n));
await snap(ps[0], '00_online');
for (const p of ps) await p.page.getByTestId('online-rate').click();
await snap(ps[0], '01_rate');

// ---------------- 1回目
for (const p of ps) {
  await p.page.getByTestId('rate-search').click();
  await p.page.waitForTimeout(300);
}
await snap(ps[3], '02_searching');
const first = {};
await Promise.all(ps.map((p) => p.page.getByTestId('vs').waitFor({ timeout: 60000 })));
for (const p of ps) first[p.name] = await vsOpp(p);
await snap(ps[0], '03_vs');
for (const p of ps) if (first[first[p.name]] !== p.name) problems.push(`1回目の組み合わせが合わない：${JSON.stringify(first)}`);
await Promise.all(ps.map((p) => p.page.locator('.battle-board').waitFor({ timeout: 60000 })));
// それぞれの組で、名前の早い方が降参
const losers = ps.filter((p) => NAMES.indexOf(p.name) < NAMES.indexOf(first[p.name]));
for (const p of losers) await surrender(p);
await Promise.all(ps.map((p) => p.page.getByTestId('rate-change').waitFor({ timeout: 30000 })));
await ps[0].page.waitForTimeout(1500);
for (const p of ps) await snap(p, '04_result');
for (const p of ps) {
  const s = await save(p);
  const lost = losers.includes(p);
  if (s.rate !== (lost ? 90 : 110)) problems.push(`${p.name} のレート：${s.rate}`);
  if (s.pending) problems.push(`${p.name} の「レート対戦中」の印が残った`);
  // すぐ降参したので「両者2ターン以上」に届かない：コインは増えない（SPEC §7 S11）
  if (s.coins !== 200) problems.push(`${p.name} のコイン：${s.coins}`);
}

// ---------------- 2回目：直前の相手とは組まない
for (const p of ps) {
  await p.page.getByTestId('rate-next').click();
  await p.page.waitForTimeout(300);
}
await Promise.all(ps.map((p) => p.page.getByTestId('vs').waitFor({ timeout: 60000 })));
const second = {};
for (const p of ps) second[p.name] = await vsOpp(p);
await snap(ps[1], '05_vs2');
for (const p of ps) if (second[p.name] === first[p.name]) problems.push(`${p.name} が直前の相手と また組まれた：${JSON.stringify(second)}`);
await Promise.all(ps.map((p) => p.page.locator('.battle-board').waitFor({ timeout: 60000 })));

// ---------------- 対戦中に読み込み直す → 次に開いた時に負け。相手は30秒で勝ち
const quitter = ps[0];
const stayer = ps.find((p) => p.name === second[quitter.name]);
const others = ps.filter((p) => p !== quitter && p !== stayer);
const before = await save(quitter);
if (!before.pending) problems.push('試合中なのに「レート対戦中」の印が無い');
const stayBefore = await save(stayer);
await quitter.page.reload();
await quitter.page.waitForTimeout(2500);
await quitter.page.mouse.click(size.width / 2, size.height / 2);
await quitter.page.getByTestId('rate-notice').waitFor({ timeout: 15000 });
await snap(quitter, '06_notice');
const after = await save(quitter);
if (after.pending || after.rate >= before.rate) problems.push(`読み込み直した人のレート：${before.rate} → ${after.rate}`);
// もう1組は ふつうに決着
await surrender(others[0]);
// 残った人は 30秒後に勝ち
await stayer.page.getByTestId('rate-change').waitFor({ timeout: 60000 });
await stayer.page.waitForTimeout(1500);
await snap(stayer, '07_win_disconnect');
const stayAfter = await save(stayer);
if (stayAfter.rate <= stayBefore.rate) problems.push(`切れた相手に勝った人のレート：${stayBefore.rate} → ${stayAfter.rate}`);

const errors = ps.flatMap((p) => p.errors.filter((e) => !/AudioContext|WebSocket/.test(e)).map((e) => `${p.name}: ${e}`));
console.log(size.name, lang, problems.length ? `\n${problems.join('\n')}` : '問題 なし');
console.log('errors:', errors.length ? errors : 'なし');
await browser.close();
