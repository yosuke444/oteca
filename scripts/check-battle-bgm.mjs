// 戦闘曲の確認（SPEC §10-2）：曲の終わりまで早送りすると別の曲へ移る／曲と曲の間が1秒以内／
// 全曲を最初に読み込まない／読み込み直しても直前の曲から始めない／止めるとフェードアウトする／対戦画面でも同じ
// 使い方：npm run dev を動かしたまま node scripts/check-battle-bgm.mjs
import { SIZES, clickText, launch, openPage, toMenu } from './pw.mjs';

const size = SIZES[0];
const problems = [];
const check = (ok, msg) => {
  console.log(`${ok ? 'OK ' : 'NG '} ${msg}`);
  if (!ok) problems.push(msg);
};

/** 戦闘曲の howl（読み込み中のものも） */
const battleHowls = (page) =>
  page.evaluate(() =>
    (window.Howler?._howls ?? [])
      .filter((h) => String(h._src).includes('/bgm/battle/'))
      .map((h) => ({ file: String(h._src).split('/').pop(), state: h.state(), playing: h.playing() })),
  );

/** 20ms ごとに「いま鳴っている戦闘曲」を記録する（曲と曲の間の長さを測る） */
const startMonitor = (page) =>
  page.evaluate(() => {
    window.__bgmLog = [];
    window.setInterval(() => {
      const playing = (window.Howler?._howls ?? []).filter((h) => String(h._src).includes('/bgm/battle/') && h.playing());
      window.__bgmLog.push({ t: performance.now(), files: playing.map((h) => String(h._src).split('/').pop()) });
    }, 20);
  });

/** from の曲が止まってから次の曲が鳴り始めるまで（ms） */
const gapAfter = (page, from) =>
  page.evaluate((from) => {
    const log = window.__bgmLog;
    let lastFrom = -1;
    for (let i = 0; i < log.length; i++) if (log[i].files.includes(from)) lastFrom = i;
    const next = log.findIndex((e, i) => i > lastFrom && e.files.some((f) => f !== from));
    if (lastFrom < 0 || next < 0) return null;
    return Math.round(log[next].t - log[lastFrom].t);
  }, from);

const nowSong = async (page) => ((await page.getByTestId('bgm-now').textContent()) ?? '').replace('いま：', '');

async function waitSongChange(page, prev, timeout = 20000) {
  await page.waitForFunction(
    (prev) => {
      const t = document.querySelector('[data-testid="bgm-now"]')?.textContent ?? '';
      return t.includes('battle_') && !t.includes(prev);
    },
    prev,
    { timeout },
  );
  return nowSong(page);
}

async function openSoundTest(page) {
  await toMenu(page, size);
  await clickText(page, 'こうかおん テスト');
  await page.getByTestId('soundtest').waitFor();
}

const browser = await launch();
try {
  const { page, errors } = await openPage(browser, size);
  await openSoundTest(page);
  await startMonitor(page);
  await clickText(page, 'せんとう');
  const first = await waitSongChange(page, '---');
  await page.waitForTimeout(1500);
  const loaded = await battleHowls(page);
  console.log('はじめの曲:', first, JSON.stringify(loaded));
  check(loaded.length === 1, `全曲を最初に読み込まない（読み込んだ戦闘曲 ${loaded.length} 曲）`);

  // 曲の終わりまで早送り → 別の曲へ（5回）
  const played = [first];
  for (let i = 0; i < 5; i++) {
    const prev = played[played.length - 1];
    await clickText(page, 'きょくの おわりへ');
    await page.waitForTimeout(1500);
    const pre = await battleHowls(page);
    check(pre.length === 2, `残り5秒で次の曲を先読みしている（${pre.map((h) => `${h.file}:${h.state}`).join(', ')}）`);
    const next = await waitSongChange(page, prev);
    await page.waitForTimeout(300);
    const gap = await gapAfter(page, `${prev}.mp3`);
    played.push(next);
    check(next !== prev, `${prev} → ${next}（間 ${gap}ms）`);
    check(gap !== null && gap < 1000, `曲と曲の間が1秒以内（${gap}ms）`);
    const after = await battleHowls(page);
    check(after.length === 1 && after[0].playing, `前の曲を片付けた（戦闘曲 ${after.length} 曲）`);
  }
  check(new Set(played).size === played.length, `一巡の途中で同じ曲が出ない（${played.join(' → ')}）`);
  const stored = await page.evaluate(() => localStorage.getItem('oteca.lastBattleBgm'));
  check(stored === played[played.length - 1], `直前の曲を localStorage に保存（${stored}）`);

  // 止める → 0.8秒でフェードアウト
  const vol = () =>
    page.evaluate(() => {
      const h = (window.Howler?._howls ?? []).find((h) => String(h._src).includes('/bgm/battle/'));
      return h ? +(h.volume(h._sounds[0]?._id) ?? 0).toFixed(2) : null;
    });
  const v0 = await vol();
  await clickText(page, 'とめる');
  await page.waitForTimeout(400);
  const v1 = await vol();
  await page.waitForTimeout(800);
  const v2 = await vol();
  check(v0 > 0 && v1 !== null && v1 < v0 && v1 > 0 && v2 === null, `とめると フェードアウト（${v0} → ${v1} → ${v2 === null ? 'かたづけ' : v2}）`);

  // 読み込み直し → 直前の曲とは違う曲から始まる（3回）
  let last = stored;
  for (let i = 0; i < 3; i++) {
    await page.reload();
    await page.waitForTimeout(300);
    await openSoundTest(page);
    await clickText(page, 'せんとう');
    const s = await waitSongChange(page, '---');
    check(s !== last, `読み込み直し ${i + 1}回目：前回 ${last} → ${s}`);
    last = s;
  }
  console.log('errors', errors.length ? errors : 'なし');
  if (errors.length) problems.push('ページのエラー');
  await page.context().close();

  // 対戦画面：戦闘曲が流れ、終わりまで早送りすると別の曲へ移る
  const b = await openPage(browser, size);
  await b.page.mouse.click(size.width / 2, size.height / 2);
  await b.page.waitForTimeout(400);
  await clickText(b.page, 'デバッグ たいせん');
  await clickText(b.page, 'ひとりで りょうほう');
  await b.page.waitForFunction(() => (window.Howler?._howls ?? []).some((h) => String(h._src).includes('/bgm/battle/') && h.playing()), null, { timeout: 20000 });
  await startMonitor(b.page);
  // 前の画面の曲が 0.8秒のクロスフェードで消えきるのを待つ
  await b.page.waitForTimeout(1200);
  const bs1 = (await battleHowls(b.page)).find((h) => h.playing).file;
  const others = (await b.page.evaluate(() => (window.Howler?._howls ?? []).filter((h) => h.playing()).map((h) => String(h._src).split('/').pop()))).filter((f) => f !== bs1);
  check(others.length === 0, `対戦画面では戦闘曲だけ流れる（${bs1}${others.length ? '、ほか ' + others.join(',') : ''}）`);
  await b.page.evaluate(() => {
    const h = window.Howler._howls.find((h) => String(h._src).includes('/bgm/battle/') && h.playing());
    h.seek(h.duration() - 3);
  });
  await b.page.waitForFunction(
    (bs1) => (window.Howler?._howls ?? []).some((h) => String(h._src).includes('/bgm/battle/') && h.playing() && !String(h._src).endsWith(bs1)),
    bs1,
    { timeout: 20000 },
  );
  await b.page.waitForTimeout(300);
  const bs2 = (await battleHowls(b.page)).find((h) => h.playing).file;
  const bgap = await gapAfter(b.page, bs1);
  check(bs2 !== bs1 && bgap !== null && bgap < 1000, `対戦画面：${bs1} → ${bs2}（間 ${bgap}ms）`);
  console.log('errors', b.errors.length ? b.errors : 'なし');
  if (b.errors.length) problems.push('対戦画面のエラー');
  await b.ctx.close();

  // localStorage が使えない環境（プライベートモードなど）でも止まらない
  const c = await openPage(browser, size);
  await c.ctx.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', {
      get() {
        throw new Error('localStorage は つかえない');
      },
    });
  });
  await c.page.reload();
  await c.page.waitForTimeout(300);
  await openSoundTest(c.page);
  await clickText(c.page, 'せんとう');
  const ns1 = await waitSongChange(c.page, '---');
  // 読み込みが終わって鳴り始めてから早送りする
  await c.page.waitForFunction(() => (window.Howler?._howls ?? []).some((h) => String(h._src).includes('/bgm/battle/') && h.playing()), null, { timeout: 20000 });
  await clickText(c.page, 'きょくの おわりへ');
  const ns2 = await waitSongChange(c.page, ns1);
  check(ns1 !== ns2, `localStorage が使えなくても流れて切りかわる（${ns1} → ${ns2}）`);
} finally {
  await browser.close();
}
console.log(problems.length ? `\n問題 ${problems.length} 件` : '\nすべて OK');
process.exit(problems.length ? 1 : 0);
