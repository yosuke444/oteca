// フレンド部屋に4つのブラウザ（v2.0-G。UPDATE_v2 §8-5・SPEC §16 R07）。開発用の中継 ?net=dev を使う（npm run dev のまま）。
// 1. A・B が入る（2人だけ → 今までどおり自動で始まる） 2. C が来る（A・B は たいせんちゅう）
// 3. A が降参 → リザルトに「ほかの ひとと あそぶ」（C が まちあい）→ 押すと A は へやの なかま、B には「あいては へやに もどったよ」
// 4. D が来る → A が C に、B が D に申し込む → 2試合が同時に進む。ことわり も確かめる。両方の言語・2サイズで撮る
// 使い方：node scripts/online-room.mjs 0（1280×720）／1（844×390）
import { SIZES, launch, openPage, shot } from './pw.mjs';

const size = SIZES[Number(process.argv[2] ?? 0)];
const lang = process.argv[3] ?? 'hira';
const browser = await launch();
const problems = [];
const room = String(Date.now()).slice(-6);
const K = lang === 'kanji';
const L = K
  ? { surrender: 'おてあげする（降参）', yes: 'おてあげする', other: '他の人と遊ぶ', accept: '遊ぶ', decline: '今はやめとく', menu: 'メニューへ', waiting: '待ち合い', playing: '対戦中', back: '相手は部屋に戻ったよ', enter: '部屋に入る' }
  : { surrender: 'おてあげする（こうさん）', yes: 'おてあげする', other: 'ほかの ひとと あそぶ', accept: 'あそぶ', decline: 'いまは やめとく', menu: 'メニューへ', waiting: 'まちあい', playing: 'たいせんちゅう', back: 'あいては へやに もどったよ', enter: 'へやに はいる' };

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
  await p.page.getByTestId('online-friend').click();
  await p.page.getByTestId('room-input').waitFor();
  return { name, ...p };
}

async function enter(p) {
  for (const d of room) await p.page.getByRole('button', { name: d, exact: true }).click();
  await p.page.getByRole('button', { name: L.enter }).click();
}

async function snap(p, n) {
  await p.page.waitForTimeout(400);
  await shot(p.page, `room_${size.name}_${lang}_${n}_${p.name}`);
}

async function surrender(p) {
  await p.page.locator('.battle-board').waitFor({ timeout: 60000 });
  await p.page.waitForTimeout(2500);
  await p.page.locator('.battle-top__btn--gear').click();
  await p.page.getByRole('button', { name: L.surrender }).click();
  await p.page.getByRole('button', { name: L.yes, exact: true }).click();
}

/** へやの なかま の一覧（名前 → 状態） */
async function list(p) {
  return p.page.evaluate(() =>
    Object.fromEntries(
      [...document.querySelectorAll('.lobby-room__member')].map((li) => [li.querySelector('.lobby-room__name')?.childNodes[0]?.textContent?.trim(), li.querySelector('.lobby-room__state')?.textContent?.trim()]),
    ),
  );
}

const A = await player('あおい');
const B = await player('ぶどう');
const C = await player('ちくわ');
const D = await player('だいず');

// 1. 2人だけ → 自動で始まる
await enter(A);
await A.page.getByTestId('room-number').waitFor();
await snap(A, '01_alone');
await enter(B);
await Promise.all([A.page.locator('.battle-board').waitFor({ timeout: 60000 }), B.page.locator('.battle-board').waitFor({ timeout: 60000 })]);

// 2. C が来る：A・B は たいせんちゅう
await enter(C);
await C.page.getByTestId('room').waitFor({ timeout: 30000 });
await C.page.waitForTimeout(1500);
await snap(C, '02_room_playing');
let l = await list(C);
if (l['あおい'] !== L.playing || l['ぶどう'] !== L.playing || l['ちくわ'] !== L.waiting) problems.push(`C の一覧：${JSON.stringify(l)}`);

// 3. A が降参 → ほかの ひとと あそぶ
await surrender(A);
await A.page.locator('.result').waitFor({ timeout: 30000 });
await B.page.locator('.result').waitFor({ timeout: 30000 });
await A.page.getByTestId('result-room').waitFor({ timeout: 15000 });
await snap(A, '03_result_other');
await A.page.getByTestId('result-room').click();
await A.page.getByTestId('room').waitFor();
await B.page.getByText(L.back).waitFor({ timeout: 15000 });
await snap(B, '04_result_oppback');
await B.page.getByTestId('result-room').click();
await B.page.getByTestId('room').waitFor();

// 4. D が来る → A→C、B→D の申し込み（B→D は1回ことわる）→ 2試合同時
await enter(D);
await D.page.getByTestId('room').waitFor({ timeout: 30000 });
await A.page.waitForTimeout(1500);
await snap(A, '05_room4');
l = await list(A);
if (Object.keys(l).length !== 4 || Object.values(l).some((s) => s !== L.waiting)) problems.push(`4人の一覧：${JSON.stringify(l)}`);
await A.page.getByTestId(`invite-ちくわ`).click();
await snap(A, '06_invite_sent');
await C.page.getByTestId('invite-accept').waitFor({ timeout: 15000 });
await snap(C, '07_invite_received');
await B.page.getByTestId(`invite-だいず`).click();
await D.page.getByTestId('invite-decline').waitFor({ timeout: 15000 });
await D.page.getByTestId('invite-decline').click();
await B.page.locator('.lobby-room__note').waitFor({ timeout: 15000 });
await snap(B, '08_declined');
await C.page.getByTestId('invite-accept').click();
await B.page.waitForTimeout(1200);
await B.page.getByTestId(`invite-だいず`).click();
await D.page.getByTestId('invite-accept').waitFor({ timeout: 15000 });
await D.page.getByTestId('invite-accept').click();
await Promise.all([A, B, C, D].map((p) => p.page.locator('.battle-board').waitFor({ timeout: 60000 })));
await A.page.waitForTimeout(2500);
await snap(A, '09_battle_AC');
await snap(D, '09_battle_BD');
// 2試合の相手の名前（混ざっていない）
const opp = async (p) => p.page.locator('.battle-name--opp').textContent();
const pairs = { A: await opp(A), B: await opp(B), C: await opp(C), D: await opp(D) };
if (!pairs.A.includes('ちくわ') || !pairs.C.includes('あおい') || !pairs.B.includes('だいず') || !pairs.D.includes('ぶどう')) problems.push(`2試合の相手：${JSON.stringify(pairs)}`);
// 片方の試合を終えても、もう片方は続く
await surrender(C);
await A.page.locator('.result').waitFor({ timeout: 30000 });
if (await B.page.locator('.result').count()) problems.push('A・C の決着で B の試合も終わった');
await surrender(D);
await B.page.locator('.result').waitFor({ timeout: 30000 });
await snap(B, '10_result');

const errors = [A, B, C, D].flatMap((p) => p.errors.map((e) => `${p.name}: ${e}`));
console.log(size.name, lang, problems.length ? `\n${problems.join('\n')}` : '問題 なし');
console.log('errors:', errors.length ? errors : 'なし');
await browser.close();
