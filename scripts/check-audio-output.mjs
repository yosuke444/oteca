// 音が「実際の出力」に出ているかの確認（効果音が鳴らない・音量が効かない不具合の再発防止）
// - 自動再生の制限を本物と同じにする。--autoplay-policy=user-gesture-required は、試験用の Chromium では
//   AudioContext（Web Audio）に効かず、タップ前から running になってしまう。本物の Chrome の既定と同じ
//   document-user-activation-required にすると、タップまで suspended になる（Web Audio も制限される）
// - AudioContext を 48000Hz で作らせる（ふつうの PC・iPhone と同じ。44100Hz だと起きない不具合があった）
// - スピーカーへの出口（destination）に入る音を AnalyserNode で横取りして大きさを測る
// 使い方：npm run dev（または npm run preview）を動かしたまま node scripts/check-audio-output.mjs
//         公開用ビルドは OTECA_URL=http://localhost:4173/oteca/ node scripts/check-audio-output.mjs
import { chromium } from '@playwright/test';
import { BASE, SIZES } from './pw.mjs';

const size = SIZES[0];
const problems = [];
const check = (ok, msg) => {
  console.log(`${ok ? 'OK ' : 'NG '} ${msg}`);
  if (!ok) problems.push(msg);
};

/** ページより先に動かす：AudioContext を 48000Hz にして、出口に入る音を横取りする */
function tapOutput() {
  const Orig = window.AudioContext;
  const taps = [];
  window.__taps = taps;
  class Ctx extends Orig {
    constructor(opts) {
      super(opts ?? { sampleRate: 48000 });
      const an = super.createAnalyser();
      an.fftSize = 2048;
      this.__tap = an;
      taps.push({ ctx: this, an });
    }
  }
  window.AudioContext = Ctx;
  window.webkitAudioContext = Ctx;
  const connect = AudioNode.prototype.connect;
  AudioNode.prototype.connect = function (dest, ...rest) {
    if (dest instanceof AudioDestinationNode && this.context.__tap && this !== this.context.__tap) connect.call(this, this.context.__tap);
    return connect.call(this, dest, ...rest);
  };
  const buf = new Float32Array(2048);
  window.__out = () =>
    taps.map((t) => {
      t.an.getFloatTimeDomainData(buf);
      let s = 0;
      for (const v of buf) s += v * v;
      return { state: t.ctx.state, rate: t.ctx.sampleRate, rms: Math.sqrt(s / buf.length) };
    });
}

/** ms のあいだ出力を測って、動いている AudioContext の出力のいちばん大きい所（rms）を返す */
async function measure(page, ms) {
  let max = 0;
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const out = await page.evaluate(() => window.__out());
    for (const o of out) if (o.state === 'running') max = Math.max(max, o.rms);
    await page.waitForTimeout(40);
  }
  return max;
}
const contexts = (page) => page.evaluate(() => window.__out().map((o) => `${o.state}/${o.rate}Hz`));
const db = (v) => (v > 0 ? `${(20 * Math.log10(v)).toFixed(1)}dB` : '-∞');

async function button(page, name, exact = false) {
  await page.getByRole('button', { name, exact }).first().click();
}
/** 設定で音量を決める（0〜10） */
async function setVolume(page, row, v) {
  await button(page, 'せってい');
  await page.getByRole('heading').first().waitFor();
  const cells = page.locator('.volume').nth(row === 'bgm' ? 0 : 1).locator('.volume__cell');
  const now = await cells.evaluateAll((els) => els.filter((e) => e.classList.contains('is-on')).length);
  if (v === 0) {
    if (now > 0) {
      await cells.nth(now - 1).click();
      for (let i = now - 1; i > 0; i--) await page.locator('.volume').nth(row === 'bgm' ? 0 : 1).getByRole('button', { name: 'へらす' }).click();
    }
  } else if (now !== v) await cells.nth(v - 1).click();
  const after = await page.locator('.volume').nth(row === 'bgm' ? 0 : 1).locator('.volume__value').textContent();
  await button(page, 'もどる');
  await page.getByRole('button', { name: 'デッキへんしゅう' }).waitFor();
  return Number(after);
}
/** こうかおん テストで「おおきい ダメージ」を鳴らして、出力を測る（BGM は止まっている画面） */
async function seLevel(page) {
  await button(page, 'こうかおん テスト');
  await page.getByTestId('soundtest').waitFor();
  await page.waitForTimeout(1200); // BGM がフェードアウトしきるまで
  const quiet = await measure(page, 300);
  await page.locator('[data-se="se_hit_big"]').click();
  const loud = await measure(page, 900);
  await button(page, 'もどる');
  await button(page, 'もどる').catch(() => {});
  await page.getByRole('button', { name: 'デッキへんしゅう' }).waitFor();
  return { quiet, loud };
}
/** メニューで BGM（bgm_title）の出力を測る */
async function bgmLevel(page) {
  await page.waitForTimeout(1500);
  return measure(page, 1200);
}

const browser = await chromium.launch({
  args: ['--autoplay-policy=document-user-activation-required', '--disable-features=AutoplayIgnoreWebAudio'],
});
try {
  const ctx = await browser.newContext({ viewport: { width: size.width, height: size.height } });
  await ctx.addInitScript(tapOutput);
  const page = await ctx.newPage();
  page.setDefaultTimeout(20000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto(BASE + '?debug=1');
  await page.waitForTimeout(1500);
  console.log('タップ前の AudioContext:', (await contexts(page)).join(', ') || 'まだ無い');
  const before = await contexts(page);
  check(before.every((c) => !c.startsWith('running')) && (await measure(page, 300)) < 1e-4, `タップ前は音が出ていない（自動再生の制限。${before.join(', ') || 'AudioContext なし'}）`);

  // タイトルをタップ → メニュー
  await page.mouse.click(size.width / 2, size.height / 2);
  await page.getByRole('button', { name: 'デッキへんしゅう' }).waitFor();
  const bgm7 = await bgmLevel(page);
  const ctxs = await contexts(page);
  console.log('タップ後の AudioContext:', ctxs.join(', '));
  check(ctxs.filter((c) => c.startsWith('running')).length === 1 && ctxs.every((c) => c.startsWith('running')), 'タップ後、AudioContext が1つだけで running（作り直されて閉じたものが無い）');
  check(bgm7 > 0.01, `BGM が出力に出ている（${db(bgm7)}）`);

  const se7 = await seLevel(page);
  check(se7.quiet < 1e-3 && se7.loud > 0.02, `効果音が出力に出ている（鳴らす前 ${db(se7.quiet)} → ${db(se7.loud)}）`);

  // BGM の音量：7 → 2 → 0（効果音は変わらない）
  await setVolume(page, 'bgm', 2);
  const bgm2 = await bgmLevel(page);
  check(bgm2 < bgm7 * 0.6 && bgm2 > 0.001, `BGM 2 で BGM が小さくなる（${db(bgm7)} → ${db(bgm2)}）`);
  await setVolume(page, 'bgm', 0);
  const bgm0 = await bgmLevel(page);
  check(bgm0 < 1e-5, `BGM 0 で BGM が完全に無音（${db(bgm0)}）`);
  const seWithBgm0 = await seLevel(page);
  check(Math.abs(20 * Math.log10(seWithBgm0.loud / se7.loud)) < 3, `BGM 0 でも効果音の大きさは変わらない（${db(se7.loud)} → ${db(seWithBgm0.loud)}）`);

  // 効果音の音量：7 → 2 → 0（BGM は変わらない）
  await setVolume(page, 'bgm', 7);
  await setVolume(page, 'se', 2);
  const se2 = await seLevel(page);
  check(se2.loud < se7.loud * 0.6 && se2.loud > 0.002, `効果音 2 で効果音が小さくなる（${db(se7.loud)} → ${db(se2.loud)}）`);
  const bgmWithSe2 = await bgmLevel(page);
  check(Math.abs(20 * Math.log10(bgmWithSe2 / bgm7)) < 3, `効果音を変えても BGM の大きさは変わらない（${db(bgm7)} → ${db(bgmWithSe2)}）`);
  await setVolume(page, 'se', 0);
  const se0 = await seLevel(page);
  check(se0.loud < 1e-5, `効果音 0 で効果音が完全に無音（${db(se0.loud)}）`);

  // 読み込み直し：設定が残る（BGM 0 にして確かめる）
  await setVolume(page, 'bgm', 0);
  await page.reload();
  await page.waitForTimeout(1200);
  await page.mouse.click(size.width / 2, size.height / 2);
  await page.getByRole('button', { name: 'デッキへんしゅう' }).waitFor();
  const bgmReload = await bgmLevel(page);
  const seReload = await seLevel(page);
  await button(page, 'せってい');
  const vals = await page.locator('.volume__value').allTextContents();
  await button(page, 'もどる');
  check(vals[0] === '0' && vals[1] === '0' && bgmReload < 1e-5 && seReload.loud < 1e-5, `読み込み直しても設定が残る（BGM ${vals[0]}・効果音 ${vals[1]}、出力 ${db(Math.max(bgmReload, seReload.loud))}）`);

  // アプリを切り替えて戻った時（iPhone では AudioContext が止まる）→ 画面に触ると また鳴る
  await setVolume(page, 'bgm', 7);
  await setVolume(page, 'se', 7);
  await page.evaluate(() => Promise.all(window.__taps.map((t) => (t.ctx.state === 'running' ? t.ctx.suspend() : null))));
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  console.log('止めた後:', (await contexts(page)).join(', '));
  await page.mouse.click(5, 5); // 画面のすみに触る
  const back = await seLevel(page);
  check((await contexts(page)).every((c) => c.startsWith('running')) && back.loud > 0.02, `アプリを切り替えて戻った後も鳴る（${db(back.loud)}）`);

  check(errors.length === 0, `ページのエラー：${errors.length ? errors.join(' / ') : 'なし'}`);
} finally {
  await browser.close();
}
console.log(problems.length ? `\n問題 ${problems.length} 件` : '\nすべて OK');
process.exit(problems.length ? 1 : 0);
