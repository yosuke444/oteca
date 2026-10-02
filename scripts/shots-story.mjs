// ストーリー（UPDATE_v2 §7・SPEC §7 S08）の確認：両方の言語で撮る。
// ステージ選択（最初・途中・全体をスワイプ）→ 確認カード → ボスのカットイン → 対戦（ボスルールの表示）→ 負け（もういちど）、
// 勝ち（リザルトの報酬・限定カードの演出）→ ステージ選びへ戻ると線が描かれて次が開く、保存されていること。
// 使い方：npm run dev を動かしたまま node scripts/shots-story.mjs 0（1280×720）／1（844×390）
import { SIZES, launch, openPage, shot } from './pw.mjs';

const size = SIZES[Number(process.argv[2] ?? 0)];
const browser = await launch();
const { page, errors } = await openPage(browser, size);
const problems = [];

async function setSave(lang, cleared) {
  await page.evaluate(
    async ({ lang, cleared }) => {
      const cs = await import('/src/save/cookieStore.ts');
      const sd = await import('/src/save/saveData.ts');
      const storage = { jar: cs.browserCookieJar(), local: window.localStorage, secure: false };
      cs.wipe(storage);
      const data = sd.createDefaultSave();
      data.tutorial = { done: true, gachaInviteShown: true };
      data.settings.lang = lang;
      data.loginBonus.lastDate = 99999999;
      data.story.stages = cleared.map((no) => ({ no, cleared: true, firstClear: true }));
      cs.persist(storage, data);
    },
    { lang, cleared },
  );
  await page.goto(page.url().split('?')[0] + '?debug=1');
  await page.waitForTimeout(2500);
  await page.mouse.click(size.width / 2, size.height / 2);
  await page.locator('.menu-scene').waitFor();
}

async function readSave() {
  return page.evaluate(async () => {
    const cs = await import('/src/save/cookieStore.ts');
    const d = cs.load({ jar: cs.browserCookieJar(), local: window.localStorage, secure: false });
    return { coins: d.coins, story: d.story.stages, collection: d.collection, cpu: d.cpuStats };
  });
}

async function snap(lang, name) {
  await page.waitForTimeout(300);
  await shot(page, `story_${size.name}_${lang}_${name}`);
}

const toStory = async (lang) => {
  await page.getByRole('button', { name: lang === 'kanji' ? 'ストーリー' : 'ストーリー', exact: true }).click();
  await page.getByTestId('story-scene').waitFor();
  await page.waitForTimeout(800);
};

for (const lang of ['hira', 'kanji']) {
  const L = lang === 'kanji' ? { go: '挑戦！', back: '戻る', surrender: 'おてあげする（降参）', yes: 'おてあげする' } : { go: 'ちょうせん！', back: 'もどる', surrender: 'おてあげする（こうさん）', yes: 'おてあげする' };

  // ---------------- 最初：1だけ行ける
  await setSave(lang, []);
  await toStory(lang);
  await snap(lang, '01_map_start');
  for (const [n, want] of [[1, 'is-open'], [2, 'is-locked'], [4, 'is-locked']]) {
    const cls = await page.getByTestId(`story-stage-${n}`).getAttribute('class');
    if (!cls.includes(want)) problems.push(`${lang} ステージ${n} が ${want} でない：${cls}`);
  }
  // 行けないステージは押しても開かない
  await page.getByTestId('story-stage-2').click();
  if (await page.getByTestId('stage-confirm').count()) problems.push(`${lang} 行けないステージの確認カードが開いた`);
  // 確認カード
  await page.getByTestId('story-stage-1').click();
  await page.getByTestId('stage-confirm').waitFor();
  await snap(lang, '02_confirm_normal');
  await page.getByTestId('stage-change-deck').click();
  await snap(lang, '03_confirm_deck');
  await page.locator('[data-testid="deck-slot-0"]').click();
  await page.getByTestId('stage-go').click();
  await page.locator('.battle-board').waitFor();
  await page.waitForTimeout(1500);
  await snap(lang, '04_battle_normal');
  // 降参 → 負け：もういちど ちょうせん・ステージ えらびへ
  await page.locator('.battle-top__btn--gear').click();
  await page.getByRole('button', { name: L.surrender }).click();
  await page.getByRole('button', { name: L.yes, exact: true }).click();
  await page.getByTestId('story-retry').waitFor({ timeout: 20000 });
  await page.waitForTimeout(1500);
  await snap(lang, '05_result_lose');
  let s = await readSave();
  if (s.story.length) problems.push(`${lang} 負けたのにクリアになった`);
  if (s.cpu.some((r) => r.wins || r.losses)) problems.push(`${lang} ストーリーが CPU対戦の勝敗に数えられた`);
  await page.getByTestId('story-stages').click();
  await page.getByTestId('story-scene').waitFor();

  // ---------------- ボス（ステージ3）：カットイン → ボスルールの表示
  await setSave(lang, [1, 2]);
  await toStory(lang);
  await page.getByTestId('story-stage-3').click();
  await snap(lang, '06_confirm_boss');
  await page.getByTestId('stage-go').click();
  await page.getByTestId('boss-cutin').waitFor();
  await page.waitForTimeout(700);
  await snap(lang, '07_cutin_a');
  await page.waitForTimeout(1300);
  await snap(lang, '08_cutin_b');
  await page.locator('.battle-board').waitFor({ timeout: 20000 });
  await page.waitForTimeout(1500);
  await snap(lang, '09_battle_boss');
  if (!(await page.getByTestId('boss-rule').count())) problems.push(`${lang} ボスルールが対戦画面に出ていない`);
  // ボスの初手7枚（相手の手札の数）
  const oppHand = await page.locator('.battle-top__item').nth(1).textContent();
  if (!oppHand.includes('7') && !oppHand.includes('6')) problems.push(`${lang} ボスの手札が7枚でない：${oppHand}`);

  // ---------------- 勝った時（リザルトを直接開く）：初クリア 200コイン ＋ 限定カード
  const c0 = (await readSave()).coins;
  await page.evaluate(() => {
    window.__otecaGo('result', {
      setup: { mode: 'cpu', cpuLevel: 'strong', decks: { p1: [1], p2: [43] }, names: { p1: 'プレイヤー', p2: 'おてあげニンゲン' }, seed: 'x', me: 'p1', record: false, story: { stage: 3 } },
      winner: 'p1',
      reason: 'ko',
      stats: { turns: 14, turnCounts: { p1: 7, p2: 7 }, sides: { p1: { damage: 300, kos: 3, mvpNo: 1, mvpDamage: 150 }, p2: { damage: 120, kos: 1, mvpNo: 43, mvpDamage: 120 } } },
      log: [],
      finalHash: '00000000',
    });
  });
  await page.locator('.result').waitFor();
  await page.waitForTimeout(1500);
  await snap(lang, '10_result_win');
  await page.getByTestId('limited-fx').waitFor({ timeout: 15000 });
  await page.waitForTimeout(1200);
  await snap(lang, '11_limited_a');
  await page.waitForTimeout(1600);
  await snap(lang, '12_limited_b');
  await page.getByTestId('limited-fx').waitFor({ state: 'detached', timeout: 15000 });
  s = await readSave();
  if (s.coins !== c0 + 200) problems.push(`${lang} ボスの初クリアのコイン：${c0} → ${s.coins}`);
  if (s.collection[43] !== 1) problems.push(`${lang} 限定カードが入っていない`);
  if (!s.story.some((x) => x.no === 3 && x.cleared && x.firstClear)) problems.push(`${lang} ステージ3のクリアが保存されていない`);
  // 読み込み直しても残る
  await page.reload();
  await page.waitForTimeout(2500);
  s = await readSave();
  if (!s.story.some((x) => x.no === 3)) problems.push(`${lang} 読み込み直すとクリアが消えた`);
  await page.evaluate(() =>
    window.__otecaGo('result', {
      setup: { mode: 'cpu', cpuLevel: 'strong', decks: { p1: [1], p2: [43] }, names: { p1: 'プレイヤー', p2: 'おてあげニンゲン' }, seed: 'x', me: 'p1', record: false, story: { stage: 4 } },
      winner: 'p1',
      reason: 'ko',
      stats: { turns: 10, turnCounts: { p1: 5, p2: 5 }, sides: { p1: { damage: 300, kos: 3, mvpNo: 1, mvpDamage: 150 }, p2: { damage: 60, kos: 0, mvpNo: null, mvpDamage: 0 } } },
      log: [],
      finalHash: '00000000',
    }),
  );
  await page.getByTestId('story-stages').waitFor();
  await page.waitForTimeout(800);
  await page.getByTestId('story-stages').click();
  await page.getByTestId('story-scene').waitFor();
  await page.waitForTimeout(400);
  await snap(lang, '13_map_drawing');
  await page.waitForTimeout(2200);
  await snap(lang, '14_map_opened');
  const cls5 = await page.getByTestId('story-stage-5').getAttribute('class');
  if (!cls5.includes('is-open')) problems.push(`${lang} ステージ4のあと 5 が開いていない`);

  // ---------------- 全体をスワイプで見られる（いちばん下まで）
  await setSave(lang, [1, 2, 3, 4, 5, 6, 7, 8, 9, 12]);
  await toStory(lang);
  await snap(lang, '15_map_mid');
  const map = page.getByTestId('story-map');
  const box = await map.boundingBox();
  // 上へドラッグをくり返す（小さい画面ほど回数が要る）
  for (let i = 0; i < 6; i++) {
    await page.mouse.move(box.x + box.width / 2, box.y + box.height - 20);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2, box.y + 10, { steps: 8 });
    await page.mouse.up();
  }
  await page.waitForTimeout(300);
  await snap(lang, '16_map_bottom');
  const bottom = await map.evaluate((el) => el.scrollTop + el.clientHeight >= el.scrollHeight - 4);
  if (!bottom) problems.push(`${lang} ドラッグで いちばん下まで動かせない`);
  const v15 = await page.getByTestId('story-stage-15').isVisible();
  if (!v15) problems.push(`${lang} ステージ15が見えない`);
}

console.log(size.name, problems.length ? `\n${problems.join('\n')}` : '問題 なし');
console.log('errors:', errors.length ? errors : 'なし');
await browser.close();
