// 1つのページで続けて何試合も遊んでも落ちないか
import { SIZES, clickText, launch, openPage, setSpeed, toMenu } from './pw.mjs';
import { playToEnd } from './play-local.mjs';
const browser = await launch();
const size = SIZES[Number(process.argv[2] ?? 0)];
const { page, errors } = await openPage(browser, size);
page.on('crash', () => console.log('CRASH'));
await toMenu(page, size);
await setSpeed(page, 'さいそく');
await clickText(page, 'デバッグたいせん');
await clickText(page, 'ひとりで りょうほう');
for (let g = 1; g <= 3; g++) {
  const t0 = Date.now();
  await playToEnd(page, `_long`, { item: true });
  console.log('game', g, (Date.now() - t0) / 1000, 's');
  await clickText(page, 'もういっかい');
}
console.log('errors', errors);
await browser.close();
