// 引き継ぎコードの桁数を、本物のブラウザ（Chromium の CompressionStream）で測る（UPDATE_v2 §3-4 の3パターン）
// playerId はランダムなので、10回作って最小〜最大を出す。
// 使い方：npm run dev を動かしたまま node scripts/measure-code.mjs
import { SIZES, launch, openPage } from './pw.mjs';

const browser = await launch();
const { page } = await openPage(browser, SIZES[0]);
const rows = await page.evaluate(async () => {
  const tc = await import('/src/save/transferCode.ts');
  const h = await import('/tests/save.helpers.ts');
  const randomId = () => [...crypto.getRandomValues(new Uint8Array(8))].map((b) => b.toString(16).padStart(2, '0')).join('');
  const digits = (c) => c.replace(/-/g, '').length;
  const out = [];
  for (let p = 0; p < 3; p++) {
    const lens = [];
    for (let k = 0; k < 10; k++) {
      const [label, data] = h.codeLengthPatterns(randomId())[p];
      lens.push(digits(await tc.encodeTransferCode(data)));
      if (k === 0) out.push({ label, plain: digits(tc.encodeTransferBytes((await import('/src/save/binary.ts')).encodeSave(data), 0)), lens });
    }
  }
  return out;
});
for (const r of rows) console.log(`${r.label}：${Math.min(...r.lens)}〜${Math.max(...r.lens)}けた（あっしゅく なしなら ${r.plain}けた）`);
await browser.close();
