// 5-3 の確認：BGM ファイルを置くと再生される（§15）。
// bgm_title.mp3 が無い時だけ、無音の mp3 を一時的に置いて確かめ、最後に消す（届いた本物の曲は上書きも削除もしない）
import { existsSync, writeFileSync, rmSync } from 'node:fs';
import { SIZES, clickText, launch, openPage, toMenu } from './pw.mjs';

const path = 'public/audio/bgm/bgm_title.mp3';
const temporary = !existsSync(path);
// MPEG-1 Layer III 128kbps 44.1kHz のフレーム（中身0＝無音）を200個（約5秒）
const frame = Buffer.alloc(417);
frame.set([0xff, 0xfb, 0x90, 0x64]);
if (temporary) writeFileSync(path, Buffer.concat(Array.from({ length: 200 }, () => frame)));
const browser = await launch();
try {
  const { page, errors } = await openPage(browser, SIZES[0]);
  await toMenu(page, SIZES[0]);
  await page.waitForTimeout(2500);
  const state = await page.evaluate(() => (window.Howler?._howls ?? []).map((h) => ({ src: h._src, state: h.state(), playing: h.playing() })));
  console.log('メニューの BGM:', JSON.stringify(state));
  // デッキへんしゅう → bgm_deck に切りかわる（ファイルが無ければ止まる）。エラーにならない
  await clickText(page, 'デッキへんしゅう');
  await page.waitForTimeout(1500);
  const after = await page.evaluate(() => (window.Howler?._howls ?? []).map((h) => ({ src: h._src, playing: h.playing() })));
  console.log('デッキへんしゅう:', JSON.stringify(after));
  console.log('errors', errors.length ? errors : 'なし');
  if (!state.some((s) => s.playing)) throw new Error('BGM が再生されていない');
} finally {
  await browser.close();
  if (temporary) rmSync(path);
}
