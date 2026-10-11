// 画面のはみ出し・ボタンの重なりを探して、スクリーンショットも撮る（手で動かす版。v2.3・v2.4）。
// 使い方：npm run dev（ポート 5175）のまま node scripts/layout-scan.mjs [shots] [画面の名前…]
//   例）node scripts/layout-scan.mjs shots deck lobby_wait   … デッキ編集とフレンドの待機画面だけ、スクリーンショットも
// 同じ確認は npm run test:slow（tests/layout.slow.test.ts）でも動く（そちらは自分で開発サーバーを立てる）
import { BASE, launch, shot } from './pw.mjs';
import { SCREENS, scanAll } from './layoutScan.mjs';

const args = process.argv.slice(2);
const withShots = args.includes('shots');
const names = args.filter((a) => a !== 'shots');
const screens = names.length ? SCREENS.filter(([n]) => names.includes(n)) : SCREENS;
const browser = await launch();
try {
  const found = await scanAll(browser, BASE, { screens, onShot: withShots ? (page, name) => shot(page, `layout_${name}`) : undefined });
  console.log(found.length ? `見つかったもの ${found.length}件：\n- ${found.join('\n- ')}` : 'はみ出し・重なり なし');
  process.exitCode = found.length ? 1 : 0;
} finally {
  await browser.close();
}
