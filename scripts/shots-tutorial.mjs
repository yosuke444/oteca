// チュートリアル（UPDATE_v2 §6T・SPEC §7 S13）の確認：新しいセーブで タイトル → なまえ → チュートリアル → パックガチャの案内 まで進める。
// スキップ（とばしたら次から自動で始まらない）と、ルールせつめい・せってい からの見返しも確かめる。両方の言語で撮る。
// 使い方：npm run dev を動かしたまま node scripts/shots-tutorial.mjs 0（1280×720）／1（844×390）
import { SIZES, launch, openPage, shot } from './pw.mjs';

const size = SIZES[Number(process.argv[2] ?? 0)];
const browser = await launch();
const { page, errors } = await openPage(browser, size);
const problems = [];

const LABELS = {
  hira: { toActive: 'バトルばに だす', toBench: 'ベンチに だす', swap: 'こうたい', swapYes: 'こうたい する', close: 'とじる', surrender: 'おてあげする（こうさん）', surrenderYes: 'おてあげする', name: 'テスター', rules: 'ルールせつめい', settings: 'せってい', yesSkip: 'とばす' },
  kanji: { toActive: 'バトル場に出す', toBench: 'ベンチに出す', swap: '交代', swapYes: '交代する', close: '閉じる', surrender: 'おてあげする（降参）', surrenderYes: 'おてあげする', name: 'テスター', rules: 'ルール説明', settings: '設定', yesSkip: '飛ばす' },
};

/** 新しく始めた人と同じセーブ（ことばだけ選ぶ）にして読み込み直す */
async function freshSave(lang) {
  await page.evaluate(async (lang) => {
    const cs = await import('/src/save/cookieStore.ts');
    const sd = await import('/src/save/saveData.ts');
    const storage = { jar: cs.browserCookieJar(), local: window.localStorage, secure: false };
    cs.wipe(storage);
    const data = sd.createDefaultSave();
    data.settings.lang = lang;
    data.loginBonus.claimedAt = Date.now(); // ログボの箱を出さない
    cs.persist(storage, data);
  }, lang);
  await page.goto(page.url().split('?')[0] + '?debug=1');
  await page.waitForTimeout(2500);
}

async function readSave() {
  return page.evaluate(async () => {
    const cs = await import('/src/save/cookieStore.ts');
    const d = cs.load({ jar: cs.browserCookieJar(), local: window.localStorage, secure: false });
    const cpu = Object.values(d.cpuStats ?? {}).reduce((a, s) => a + (s.wins ?? 0) + (s.losses ?? 0), 0);
    return { name: d.playerName, coins: d.coins, tutorial: d.tutorial, wins: d.stats.wins, losses: d.stats.losses, cpu, rate: d.rate };
  });
}

async function snap(name) {
  await page.waitForTimeout(250);
  await shot(page, `tutorial_${size.name}_${name}`);
}

const guide = page.getByTestId('tutorial-guide');
const card = (uid) => page.locator(`.battle-board [data-uid="${uid}"]`).first();

/** 案内の手順が出るのを待つ（前と違う手順） */
async function waitStep(prev) {
  await page.waitForFunction(
    (prev) => {
      const g = document.querySelector('[data-testid="tutorial-guide"]');
      return g && g.getAttribute('data-step') !== prev;
    },
    prev,
    { timeout: 60000 },
  );
  return guide.getAttribute('data-step');
}

/** 1つの手順を、ふつうの人と同じ操作で進める */
async function doStep(id, L, lang, shots) {
  const pic = async (n) => shots && (await snap(`${lang}_${n}_${id}`));
  switch (id) {
    case 'dice':
      await pic('a');
      await page.getByTestId('tutorial-dice').click();
      return;
    case 'hand': {
      await pic('a');
      const box = await card('p1-0').boundingBox();
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.waitForTimeout(900);
      await page.mouse.up();
      await page.getByRole('button', { name: L.close, exact: true }).click();
      return;
    }
    case 'active':
      await pic('a');
      // 使える相手のカードは光って動き続けるので force で押す（押した所が幕でふさがれていれば、次の手順へ進まずに分かる）
      await card('p1-0').click({ force: true });
      await page.getByRole('button', { name: L.toActive }).click();
      return;
    case 'bench':
    case 'bench2':
      await pic('a');
      await card(id === 'bench' ? 'p1-1' : 'p1-2').click();
      await page.getByRole('button', { name: L.toBench }).click();
      return;
    case 'firstEnd':
    case 'attack1':
    case 'attack2':
    case 'attack3':
    case 'swapEnd':
    case 'ko':
      await pic('a');
      await page.locator('.battle-end button').click();
      return;
    case 'yaiba':
    case 'kusuri':
      await pic('a');
      await card(id === 'yaiba' ? 'p1-3' : 'p1-4').click();
      if (process.env.DBG) {
        await page.waitForTimeout(600);
        console.log(await page.evaluate(() => {
          const c = document.querySelector('.battle-board [data-uid="p1-0"]').getBoundingClientRect();
          const hit = document.elementFromPoint(c.x + c.width / 2, c.y + c.height / 2);
          return { c: [c.x, c.y, c.width, c.height], hit: hit.className, clip: document.querySelector('.guide__catcher').style.clipPath.slice(0, 600) };
        }));
      }
      // 使える相手のカードは光って動き続けるので force で押す（押した所が幕でふさがれていれば、次の手順へ進まずに分かる）
      await card('p1-0').click({ force: true });
      return;
    case 'swap':
      await pic('a');
      await card('p1-2').click();
      await page.getByRole('button', { name: L.swap, exact: true }).click();
      await pic('b');
      await page.getByRole('button', { name: L.swapYes }).click();
      return;
    case 'promote':
      await pic('a');
      await page.locator('[data-zone="p1-bench-0"] [data-uid]').first().click();
      return;
    case 'oppTurn':
      await pic('a');
      return; // 見るだけ（相手が動き終わると次へ）
    default:
      // 1回目のタップで文字を全部出し、「タップで つぎへ」を押す
      await page.locator('.guide__balloon').click();
      await page.getByTestId('tutorial-next').waitFor();
      await pic('a');
      await page.getByTestId('tutorial-next').click();
  }
}

/** 案内を最初から最後まで進める（#15 の自由対戦の前まで） */
async function playGuide(L, lang, shots) {
  let prev = null;
  const seen = [];
  for (let i = 0; i < 40; i++) {
    const id = await waitStep(prev);
    seen.push(id);
    try {
      await doStep(id, L, lang, shots);
    } catch (e) {
      await snap(`${lang}_fail_${id}`);
      throw e;
    }
    if (id === 'free') break;
    prev = id;
  }
  return seen;
}

/** 自由対戦は「おてあげする（降参）」で終える */
async function surrender(L) {
  await guide.waitFor({ state: 'detached' });
  await page.locator('.battle-top__btn--gear').click();
  await page.getByRole('button', { name: L.surrender }).click();
  await page.getByRole('button', { name: L.surrenderYes, exact: true }).click();
  await page.getByTestId('tutorial-end').waitFor({ timeout: 30000 });
}

for (const lang of ['hira', 'kanji']) {
  const L = LABELS[lang];

  // ---------------- 新しいセーブ：タイトル → なまえ → チュートリアル → パックガチャの案内
  await freshSave(lang);
  const rate0 = JSON.stringify((await readSave()).rate);
  await snap(`${lang}_00_title`);
  await page.mouse.click(size.width / 2, size.height / 2);
  await page.getByTestId('name-scene').waitFor();
  await page.getByTestId('name-input').fill(L.name);
  await snap(`${lang}_01_name`);
  await page.getByTestId('name-ok').click();
  await page.getByTestId('tutorial-scene').waitFor();
  const seen = await playGuide(L, lang, true);
  const want = ['hello', 'dice', 'first', 'hand', 'active', 'bench', 'firstEnd', 'oppTurn', 'damaged', 'bench2', 'moves', 'attack1', 'six', 'yaiba', 'attack2', 'kusuri', 'attack3', 'swap', 'swapEnd', 'draw', 'ko', 'koDone', 'promote', 'free'];
  if (seen.join() !== want.join()) problems.push(`${lang} 手順の順番：${seen.join(',')}`);
  await page.waitForTimeout(800);
  await snap(`${lang}_90_free`);
  await surrender(L);
  await page.waitForTimeout(600);
  await snap(`${lang}_91_end_lost`);
  await page.getByTestId('tutorial-end').click(); // 文字を全部出す
  await page.getByTestId('tutorial-end').click(); // 次へ
  await page.getByTestId('tutorial-end').click(); // 文字を全部出す
  await page.getByTestId('tutorial-gacha').waitFor();
  await snap(`${lang}_92_invite`);
  let s = await readSave();
  if (!s.tutorial.done) problems.push(`${lang} 終えたのに done になっていない`);
  if (s.name !== L.name) problems.push(`${lang} 名前が保存されていない：${s.name}`);
  if (s.wins || s.losses || s.cpu) problems.push(`${lang} チュートリアルが勝敗に数えられた：${JSON.stringify(s)}`);
  if (s.coins !== 200) problems.push(`${lang} コインが変わった：${s.coins}`);
  if (JSON.stringify(s.rate) !== rate0) problems.push(`${lang} レートが変わった：${JSON.stringify(s.rate)}`);
  await page.getByTestId('tutorial-gacha').click();
  await page.getByTestId('gacha-scene').waitFor();
  await page.waitForTimeout(900);
  await snap(`${lang}_93_gacha_guide`);
  if (!(await page.locator('.gacha-guide').count())) problems.push(`${lang} ガチャの 15まい を囲んでいない`);
  s = await readSave();
  if (!s.tutorial.gachaInviteShown) problems.push(`${lang} ひいてみる！ のあと gachaInviteShown が立っていない`);

  // ---------------- 見返し：ルールせつめい の いちばん上から。最後は「おつかれさま！」でメニューへ
  await page.getByRole('button', { name: lang === 'kanji' ? '戻る' : 'もどる' }).click();
  await page.locator('.menu-scene').waitFor();
  await page.getByRole('button', { name: L.rules }).click();
  await snap(`${lang}_94_rules_again`);
  await page.getByTestId('tutorial-again').click();
  await page.getByTestId('tutorial-scene').waitFor();
  await playGuide(L, lang, false);
  await surrender(L);
  for (let i = 0; i < 3; i++) await page.getByTestId('tutorial-end').click();
  await page.getByTestId('tutorial-menu').waitFor();
  await snap(`${lang}_95_review_end`);
  if (await page.getByTestId('tutorial-gacha').count()) problems.push(`${lang} 見返しでガチャの案内が出た`);
  await page.getByTestId('tutorial-menu').click();
  await page.locator('.menu-scene').waitFor();

  // ---------------- せってい からも見返せる（すぐスキップ）
  await page.getByRole('button', { name: L.settings }).click();
  await snap(`${lang}_96_settings_again`);
  await page.getByTestId('tutorial-again').click();
  await guide.waitFor();
  await page.getByTestId('tutorial-skip').click();
  await page.getByRole('button', { name: L.yesSkip, exact: true }).click();
  await page.locator('.menu-scene').waitFor();

  // ---------------- スキップ：どの手順からでも とばせて、次から自動で始まらない。メニューのガチャに ふせん を1回だけ
  await freshSave(lang);
  await page.mouse.click(size.width / 2, size.height / 2);
  await page.getByTestId('name-ok').click();
  let prev = null;
  for (;;) {
    const id = await waitStep(prev);
    if (id === 'damaged') break;
    await doStep(id, L, lang, false);
    prev = id;
  }
  // 案内の途中では、ブラウザの「戻る」もスキップの確認になる（降参にしない。⚙ は暗い幕の下で押せない）
  await page.evaluate(() => history.back());
  await page.waitForTimeout(500);
  if (!(await page.getByRole('button', { name: L.yesSkip, exact: true }).count())) problems.push(`${lang} 案内中の おてあげする が スキップの確認にならない`);
  await page.getByRole('button', { name: lang === 'kanji' ? '続ける' : 'つづける', exact: true }).click();
  await page.getByTestId('tutorial-skip').click();
  await page.waitForTimeout(300);
  await snap(`${lang}_97_skip_confirm`);
  await page.getByRole('button', { name: L.yesSkip, exact: true }).click();
  await page.locator('.menu-scene').waitFor();
  await page.waitForTimeout(700);
  await snap(`${lang}_98_menu_invite`);
  if (!(await page.getByTestId('gacha-invite').count())) problems.push(`${lang} スキップのあと メニューに ふせん が無い`);
  s = await readSave();
  if (!s.tutorial.done || !s.tutorial.gachaInviteShown) problems.push(`${lang} スキップの印：${JSON.stringify(s.tutorial)}`);
  if (s.wins || s.losses || s.cpu) problems.push(`${lang} スキップした試合が勝敗に数えられた`);
  // 読み込み直すと、タイトルからそのままメニュー（チュートリアルは始まらない）。ふせんも もう無い
  await page.reload();
  await page.waitForTimeout(2500);
  await page.mouse.click(size.width / 2, size.height / 2);
  await page.locator('.menu-scene').waitFor();
  if (await page.getByTestId('gacha-invite').count()) problems.push(`${lang} ふせん が2回 出た`);

  // ---------------- 今までのプレイヤー：タイトル → メニュー（なまえ は出ない）→ おしらせ の「やる」でチュートリアル、「あとで」なら次から始まらない
  for (const answer of ['yes', 'later']) {
    await freshSave(lang);
    await page.evaluate(async () => {
      const cs = await import('/src/save/cookieStore.ts');
      const storage = { jar: cs.browserCookieJar(), local: window.localStorage, secure: false };
      const d = cs.load(storage);
      d.updateNoticeSeen = false; // 古いセーブから移行した人
      cs.persist(storage, d);
    });
    await page.reload();
    await page.waitForTimeout(2500);
    await page.mouse.click(size.width / 2, size.height / 2);
    await page.getByTestId('update-notice').waitFor();
    if (await page.getByTestId('name-scene').count()) problems.push(`${lang} 移行した人に なまえ が出た`);
    const label = answer === 'yes' ? 'やる' : lang === 'kanji' ? '後で' : 'あとで';
    await page.getByRole('button', { name: label, exact: true }).click();
    if (answer === 'yes') {
      await guide.waitFor();
      if ((await guide.getAttribute('data-step')) !== 'hello') problems.push(`${lang} おしらせ の やる で、はじめから始まらない`);
      await page.getByTestId('tutorial-skip').click();
      await page.getByRole('button', { name: L.yesSkip, exact: true }).click();
      await page.locator('.menu-scene').waitFor();
    } else {
      await page.waitForTimeout(300);
      s = await readSave();
      if (!s.tutorial.done) problems.push(`${lang} おしらせ の あとで で done が立たない`);
    }
  }
}

console.log(size.name, problems.length ? `\n${problems.join('\n')}` : '問題 なし');
console.log('errors:', errors.length ? errors : 'なし');
await browser.close();
