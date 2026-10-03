// チュートリアル（UPDATE_v2 §6T・UPDATE_v2_1 §6・SPEC §7 S13・S18）の確認：新しいセーブで
// タイトル → ことば → なまえ → 対戦 → パックガチャ15袋 → デッキに1枚入れる → メニュー まで最後まで進める（両方の言語）。
// 見返し（ガチャは見本・デッキは練習用の写しで、コインも所持数もデッキも変わらない）、途中で閉じた時の再開（#16・#20）、
// どの手順からでもスキップ（とばしたら次から自動で始まらない・ガチャのふせん）も確かめる。
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
    return { name: d.playerName, lang: d.settings.lang, coins: d.coins, tutorial: d.tutorial, wins: d.stats.wins, losses: d.stats.losses, cpu, rate: d.rate, collection: d.collection, decks: d.decks, selectedDeck: d.selectedDeck };
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

// ---------------------------------------------------------------- 延長（#16〜#25。UPDATE_v2_1 §6-2）

/** 延長の案内の次の手順を待つ（前と違う手順。案内が消えたら null） */
async function waitPost(prev) {
  const h = await page.waitForFunction(
    (prev) => {
      const g = document.querySelector('[data-testid="post-guide"]');
      if (!g) return 'gone';
      const id = g.getAttribute('data-step');
      return id !== prev ? id : null;
    },
    prev,
    { timeout: 60000 },
  );
  const id = await h.jsonValue();
  return id === 'gone' ? null : id;
}

async function deckLen() {
  return page.evaluate(async () => {
    const cs = await import('/src/save/cookieStore.ts');
    const d = cs.load({ jar: cs.browserCookieJar(), local: window.localStorage, secure: false });
    return d.decks[d.selectedDeck].cards.length;
  });
}

/** 延長の1つの手順を、ふつうの人と同じ操作で進める */
async function doPost(id, lang, shots) {
  const pic = async () => shots && (await snap(`${lang}_p_${id}`));
  await page.waitForTimeout(250);
  await pic();
  switch (id) {
    case 'coins':
      await page.getByTestId('menu-gacha').click();
      return;
    case 'buy':
      await page.getByTestId('gacha-buy-fifteen').click();
      return;
    case 'open': {
      await page.waitForTimeout(900);
      await page.getByTestId('gacha-bag-7').click({ force: true });
      for (let i = 0; i < 30 && !(await page.getByTestId('gacha-summary').count()); i++) {
        await page.getByTestId('gacha-next').waitFor({ timeout: 20000 });
        if (i === 1 && shots) await snap(`${lang}_p_open_next`);
        await page.getByTestId('gacha-next').click();
        await page.waitForTimeout(80);
      }
      return;
    }
    case 'toDeck':
      await page.getByTestId('gacha-tutorial-deck').click();
      return;
    case 'picker':
      await page.getByTestId('deck-pick').click();
      return;
    case 'first':
      await page.getByTestId('deck-slot-0').click();
      return;
    case 'list':
      await page.getByTestId('deck-filter-owned').click();
      return;
    case 'remove':
    case 'back15':
      await page.locator('.deck-panel__slots .card-mini').first().click();
      return;
    case 'add': {
      // 一覧のカードを、入るまで1枚ずつ押す（入れられないカードは押しても入らない）
      // 後ろ（ガチャで手に入れたカード）から押す（外したのと同じカードを入れ直さないように）
      const cards = page.locator('.list-panel__grid .card-mini');
      const n = await cards.count();
      for (let i = n - 1; i >= 0; i--) {
        await cards.nth(i).click();
        await page.waitForTimeout(150);
        // 見返しは練習用の写しなので、本物のセーブではなく案内が次へ進んだかで見る（花丸のあと少しして進む）
        const moved = await page
          .waitForFunction(() => document.querySelector('[data-testid="post-guide"]')?.getAttribute('data-step') !== 'add', null, { timeout: 1500 })
          .then(() => true)
          .catch(() => false);
        if (moved) return;
      }
      return;
    }
    default:
      // タップの手順：文字が出終わって「タップで つぎへ」が出たら押す（1回だけ）
      await page.getByTestId('tutorial-next').click();
  }
}

/** 延長を最後まで進める。見た手順の id を返す */
async function playPost(lang, shots) {
  const seen = [];
  let prev = null;
  for (let i = 0; i < 40; i++) {
    const id = await waitPost(prev);
    if (!id) break;
    seen.push(id);
    try {
      await doPost(id, lang, shots);
    } catch (e) {
      await snap(`${lang}_fail_post_${id}`);
      throw e;
    }
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

  // ---------------- 新しいセーブ：タイトル → ことば → なまえ → 対戦 → ガチャ15袋 → デッキに1枚 → メニュー
  await freshSave(lang === 'kanji' ? 'hira' : 'kanji'); // 選ぶ前は もう一方の言語（選んだ言語に変わることを確かめる）
  const rate0 = JSON.stringify((await readSave()).rate);
  await snap(`${lang}_00_title`);
  await page.mouse.click(size.width / 2, size.height / 2);
  await page.getByTestId('lang-scene').waitFor();
  await snap(`${lang}_00b_lang`);
  await page.getByTestId(`lang-${lang}`).click();
  await page.getByTestId('name-scene').waitFor();
  if ((await readSave()).lang !== lang) problems.push(`${lang} 選んだ ことば が保存されていない`);
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
  let s = await readSave();
  if (s.tutorial.done) problems.push(`${lang} 対戦だけで done が立った（延長が残っている）`);
  if (s.wins || s.losses || s.cpu) problems.push(`${lang} チュートリアルが勝敗に数えられた：${JSON.stringify(s)}`);
  const before = s;
  // 文字が出終わったら「タップで つぎへ」（延長の #16 へ）
  await page.getByTestId('tutorial-end-next').click();
  const post = await playPost(lang, true);
  const wantPost = ['coins', 'packs', 'buy', 'open', 'summary', 'toDeck', 'picker', 'first', 'list', 'remove', 'add', 'rules', 'menu', 'tourOnline', 'tourCpu', 'tourGacha', 'tourDaily', 'end'];
  if (post.join() !== wantPost.join()) problems.push(`${lang} 延長の手順：${post.join(',')}`);
  await page.locator('.menu-scene').waitFor();
  await snap(`${lang}_92_menu_after`);
  s = await readSave();
  if (!s.tutorial.done || s.tutorial.step !== 0 || !s.tutorial.gachaInviteShown) problems.push(`${lang} 終えた後の印：${JSON.stringify(s.tutorial)}`);
  if (s.name !== L.name) problems.push(`${lang} 名前が保存されていない：${s.name}`);
  if (s.coins !== before.coins - 200) problems.push(`${lang} ガチャ（本物）のコイン：${before.coins} → ${s.coins}`);
  const total = (c) => Object.values(c).reduce((x, y) => x + y, 0);
  if (total(s.collection) < total(before.collection) + 15) problems.push(`${lang} ガチャ（本物）で所持数が増えていない`);
  if (s.decks[0].cards.length !== 15 || JSON.stringify(s.decks[0].cards) === JSON.stringify(before.decks[0].cards)) problems.push(`${lang} デッキに1枚入れ替わっていない：${s.decks[0].cards.length}`);
  if (JSON.stringify(s.rate) !== rate0) problems.push(`${lang} レートが変わった：${JSON.stringify(s.rate)}`);
  if (await page.getByTestId('gacha-invite').count()) problems.push(`${lang} 終えたのに ガチャの ふせん が出た`);

  // ---------------- 見返し：ルールせつめい の いちばん上から。ガチャは見本、デッキは練習用の写し（コインも所持数もデッキも変わらない）
  await page.getByRole('button', { name: L.rules }).click();
  await snap(`${lang}_94_rules_again`);
  const r0 = await readSave();
  await page.getByTestId('tutorial-again').click();
  await page.getByTestId('tutorial-scene').waitFor();
  await playGuide(L, lang, false);
  await surrender(L);
  await page.getByTestId('tutorial-end-next').click();
  const postR = await playPost(`${lang}_review`, true);
  if (postR.join() !== wantPost.join()) problems.push(`${lang} 見返しの延長の手順：${postR.join(',')}`);
  await page.locator('.menu-scene').waitFor();
  const r1 = await readSave();
  if (r1.coins !== r0.coins) problems.push(`${lang} 見返しでコインが変わった：${r0.coins} → ${r1.coins}`);
  if (JSON.stringify(r1.collection) !== JSON.stringify(r0.collection)) problems.push(`${lang} 見返しで所持数が変わった`);
  if (JSON.stringify(r1.decks) !== JSON.stringify(r0.decks)) problems.push(`${lang} 見返しでデッキが変わった`);
  if (JSON.stringify(r1.tutorial) !== JSON.stringify(r0.tutorial)) problems.push(`${lang} 見返しで tutorial が変わった：${JSON.stringify(r1.tutorial)}`);
  await snap(`${lang}_95_review_end`);

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
  await page.getByTestId(`lang-${lang}`).click();
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

  // ---------------- 延長の途中で閉じた人：次にタイトルを押すと #16（ガチャ）から。ガチャの前でとばすと ふせん が出る
  await freshSave(lang);
  await page.evaluate(async () => {
    const cs = await import('/src/save/cookieStore.ts');
    const storage = { jar: cs.browserCookieJar(), local: window.localStorage, secure: false };
    const d = cs.load(storage);
    d.tutorial.step = 16;
    cs.persist(storage, d);
  });
  await page.reload();
  await page.waitForTimeout(2500);
  await page.mouse.click(size.width / 2, size.height / 2);
  if ((await waitPost(null)) !== 'coins') problems.push(`${lang} step 16 から再開しない`);
  await page.getByTestId('menu-gacha').click();
  if ((await waitPost('coins')) !== 'packs') problems.push(`${lang} 再開のあと packs に進まない`);
  await page.getByTestId('post-skip').click();
  await snap(`${lang}_97b_post_skip`);
  await page.getByTestId('post-skip-yes').click();
  await page.locator('.menu-scene').waitFor();
  await page.waitForTimeout(600);
  if (!(await page.getByTestId('gacha-invite').count())) problems.push(`${lang} 延長をガチャの前でとばしたのに ふせん が無い`);
  s = await readSave();
  if (!s.tutorial.done || s.tutorial.step !== 0) problems.push(`${lang} 延長をとばした印：${JSON.stringify(s.tutorial)}`);
  // 20（デッキ編集）からの再開
  await freshSave(lang);
  await page.evaluate(async () => {
    const cs = await import('/src/save/cookieStore.ts');
    const storage = { jar: cs.browserCookieJar(), local: window.localStorage, secure: false };
    const d = cs.load(storage);
    d.tutorial.step = 20;
    cs.persist(storage, d);
  });
  await page.reload();
  await page.waitForTimeout(2500);
  await page.mouse.click(size.width / 2, size.height / 2);
  if ((await waitPost(null)) !== 'picker') problems.push(`${lang} step 20 から再開しない`);
  await page.locator('.deck-scene').waitFor();
  await snap(`${lang}_97c_resume_deck`);
  await page.getByTestId('post-skip').click();
  await page.getByTestId('post-skip-yes').click();
  await page.locator('.menu-scene').waitFor();

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
    if (await page.getByTestId('lang-scene').count()) problems.push(`${lang} 移行した人に ことば が出た`);
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

// ---------------- アップデートの おしらせ で「やる」＋ コインが足りない人（にほんご だけ）：
// 途中で閉じても ことば・なまえ を出さずにチュートリアルから。延長は見本で進み、終えたら本物に done が立つ（コインは変わらない）
{
  const lang = 'hira';
  const L = LABELS[lang];
  await freshSave(lang);
  await page.evaluate(async () => {
    const cs = await import('/src/save/cookieStore.ts');
    const storage = { jar: cs.browserCookieJar(), local: window.localStorage, secure: false };
    const d = cs.load(storage);
    d.updateNoticeSeen = false;
    d.coins = 50;
    cs.persist(storage, d);
  });
  await page.reload();
  await page.waitForTimeout(2500);
  await page.mouse.click(size.width / 2, size.height / 2);
  await page.getByTestId('update-notice').waitFor();
  await page.getByRole('button', { name: 'やる', exact: true }).click();
  await guide.waitFor();
  // 対戦の途中で閉じる → タイトル → ことば・なまえ を出さずにチュートリアル
  await page.reload();
  await page.waitForTimeout(2500);
  await page.mouse.click(size.width / 2, size.height / 2);
  await page.getByTestId('tutorial-scene').waitFor({ timeout: 10000 }).catch(() => problems.push('おしらせ から始めた人が、閉じたあと チュートリアルに戻らない'));
  if (await page.getByTestId('lang-scene').count()) problems.push('おしらせ から始めた人に ことば が出た');
  await playGuide(L, lang, false);
  await surrender(L);
  await page.getByTestId('tutorial-end-next').click();
  const pz = await playPost('hira_notice', false);
  if (!(await page.getByTestId('post-sample').count()) && pz.length === 0) problems.push('コインが足りない人の延長が始まらない');
  await page.locator('.menu-scene').waitFor();
  const z = await readSave();
  if (!z.tutorial.done) problems.push();
  if (z.coins !== 50) problems.push();
}

console.log(size.name, problems.length ? `\n${problems.join('\n')}` : '問題 なし');
console.log('errors:', errors.length ? errors : 'なし');
await browser.close();
