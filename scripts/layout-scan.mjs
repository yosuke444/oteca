// 画面のはみ出しを探して、スクリーンショットも撮る（手で動かす版。v2.3）。
// 使い方：npm run dev（ポート 5175）のまま node scripts/layout-scan.mjs [shots]
// 同じ確認は npm run test:slow（tests/layout.slow.test.ts）でも動く（そちらは自分で開発サーバーを立てる）
import { BASE, launch, shot } from './pw.mjs';
import { scanAll } from './layoutScan.mjs';

const withShots = process.argv.includes('shots');
const browser = await launch();
try {
  const found = await scanAll(browser, BASE, { onShot: withShots ? (page, name) => shot(page, `layout_${name}`) : undefined });
  console.log(found.length ? `はみ出し ${found.length}件：\n- ${found.join('\n- ')}` : 'はみ出し なし');
  process.exitCode = found.length ? 1 : 0;
} finally {
  await browser.close();
}
