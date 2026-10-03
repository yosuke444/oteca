// ストーリー（UPDATE_v2 §7・SPEC §7 S08）の確認：両方の言語で撮る。
// ステージ選択（最初・途中・上下左右のドラッグと拡大縮小・全体図。v2.1-N）→ 確認カード → ボスのカットイン → 対戦（ボスルールの表示）→ 負け（もういちど）、
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
      data.tutorial = { done: true, gachaInviteShown: true, step: 0 };
      data.settings.lang = lang;
      data.loginBonus.claimedAt = Date.now();
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
  // 4 をクリアすると 7 と 8（合流）が開く（v2.1-N）
  for (const n of [7, 8]) {
    const cls = await page.getByTestId(`story-stage-${n}`).getAttribute('class');
    if (!cls.includes('is-open')) problems.push(`${lang} ステージ4のあと ${n} が開いていない：${cls}`);
  }

  // ---------------- 上下左右のドラッグ・拡大縮小で、マップ全体を見られる（UPDATE_v2_1 §4-7）
  await setSave(lang, [1, 2, 3, 4, 5, 6, 8, 9]);
  await toStory(lang);
  await snap(lang, '15_map_mid');
  // 開いた時は「行ける」ステージの中でいちばん新しいもの（12・13 のうち 13）が真ん中あたり
  if (!(await inView(13))) problems.push(`${lang} 開いた時に 13 が見えない`);
  const map = page.getByTestId('story-map');
  const box = await map.boundingBox();
  /** ドラッグ：画面の (dx, dy) だけ動かす（何回か） */
  const dragBy = async (dx, dy, times = 4) => {
    for (let i = 0; i < times; i++) {
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width / 2 + dx, box.y + box.height / 2 + dy, { steps: 8 });
      await page.mouse.up();
    }
    await page.waitForTimeout(200);
  };
  /** その向きに少しずつドラッグして、ステージが見えるまで（見えたら true） */
  const dragUntil = async (no, dx, dy, max = 12) => {
    for (let i = 0; i < max; i++) {
      if (await inView(no)) return true;
      await dragBy(dx, dy, 1);
    }
    return inView(no);
  };
  // 右へ（左の端のウサギ 11 が見える）
  if (!(await dragUntil(11, box.width * 0.25, 0))) problems.push(`${lang} 右へドラッグしても 11（ウサギ）が見えない`);
  await snap(lang, '16_map_left');
  // 左へ（右の端のザムライ 14）
  if (!(await dragUntil(14, -box.width * 0.25, 0))) problems.push(`${lang} 左へドラッグしても 14（ザムライ）が見えない`);
  await snap(lang, '17_map_right');
  // 右へ（真ん中の 12）→ 下へ（一番上のドラゴン 15）→ 上へ（スタートの 1）
  if (!(await dragUntil(12, box.width * 0.25, 0))) problems.push(`${lang} 右へドラッグしても 12 が見えない`);
  if (!(await dragUntil(15, 0, box.height * 0.25))) problems.push(`${lang} 下へドラッグしても 15（ドラゴン）が見えない`);
  await snap(lang, '17b_map_top');
  if (!(await dragUntil(1, 0, -box.height * 0.25, 20))) problems.push(`${lang} 上へドラッグしても 1 が見えない`);
  await snap(lang, '18_map_start_again');
  // ホイールで縮小（0.6倍まで）・拡大（1.5倍まで）
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  for (let i = 0; i < 12; i++) await page.mouse.wheel(0, 300);
  await page.waitForTimeout(300);
  const zMin = Number(await map.getAttribute('data-zoom'));
  if (Math.abs(zMin - 0.6) > 0.001) problems.push(`${lang} ホイールで縮小しても 0.6 にならない：${zMin}`);
  await snap(lang, '19_map_zoom_min');
  for (let i = 0; i < 20; i++) await page.mouse.wheel(0, -300);
  await page.waitForTimeout(300);
  const zMax = Number(await map.getAttribute('data-zoom'));
  if (Math.abs(zMax - 1.5) > 0.001) problems.push(`${lang} ホイールで拡大しても 1.5 にならない：${zMax}`);
  await snap(lang, '20_map_zoom_max');
  // 「－」ボタンで縮小
  for (let i = 0; i < 5; i++) await page.getByTestId('story-zoom-out').click();
  if (Number(await map.getAttribute('data-zoom')) >= zMax) problems.push(`${lang} 「－」で縮小しない`);
  // 全体図を押すと、そこへ動く（右上を押すとザムライ 14 のあたり）
  const mini = await page.getByTestId('story-minimap').boundingBox();
  await page.mouse.click(mini.x + mini.width * 0.95, mini.y + mini.height * 0.2);
  await page.waitForTimeout(300);
  if (!(await inView(14))) problems.push(`${lang} 全体図の右上を押しても 14 が見えない`);
  await snap(lang, '21_minimap_jump');
  // ドラッグの後でも、ステージを押せる（動かさずに押した時だけ開く）
  await page.getByTestId('story-stage-13').click().catch(() => {});
  if (!(await page.getByTestId('stage-confirm').count())) {
    // 13 が見えていなければ全体図で動かしてから押す
    await page.mouse.click(mini.x + mini.width * 0.75, mini.y + mini.height * 0.3);
    await page.waitForTimeout(300);
    await page.getByTestId('story-stage-13').click();
  }
  if (!(await page.getByTestId('stage-confirm').count())) problems.push(`${lang} ドラッグの後にステージを押しても確認カードが開かない`);
}

/** ステージの枠が地図の窓の中に見えているか */
async function inView(no) {
  const m = await page.getByTestId('story-map').boundingBox();
  const b = await page.getByTestId(`story-stage-${no}`).boundingBox();
  if (!m || !b) return false;
  const cx = b.x + b.width / 2;
  const cy = b.y + b.height / 2;
  return cx > m.x && cx < m.x + m.width && cy > m.y && cy < m.y + m.height;
}

console.log(size.name, problems.length ? `\n${problems.join('\n')}` : '問題 なし');
console.log('errors:', errors.length ? errors : 'なし');
await browser.close();
