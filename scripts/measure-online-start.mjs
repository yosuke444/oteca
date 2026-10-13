// オンライン対戦（フレンドの部屋）で、2人が部屋にそろってから対戦の最初の画面が出るまでを、段階ごとに測る（v2.7）。
// 本物の通信（Trystero：Nostr の中継網 ＋ WebRTC）で、2つのブラウザを使う。npm run dev（ポート 5175）のまま
//   node scripts/measure-online-start.mjs [回数=3] [?debug=1&api=off]
// 時刻は src/net/startTiming.ts の markStart（globalThis.__otecaStartLog がある時だけ書く）と、画面の見張り（対戦の盤面が出た・操作できる）
import { BASE, SIZES, launch, openPage, toMenu } from './pw.mjs';

const N = Number(process.argv[2] ?? 3);
const Q = process.argv[3] ?? '?debug=1&api=off';
const NL = String.fromCharCode(10);
const rows = [];

async function player(browser, name, size) {
  const p = await openPage(browser, size, Q);
  await p.page.waitForTimeout(1200);
  await p.page.evaluate(async (name) => {
    const cs = await import('/src/save/cookieStore.ts');
    const sd = await import('/src/save/saveData.ts');
    const storage = { jar: cs.browserCookieJar(), local: window.localStorage, secure: false };
    cs.wipe(storage);
    const d = sd.createDefaultSave();
    d.playerName = name;
    d.tutorial = { done: true, gachaInviteShown: true, step: 0 };
    d.loginBonus.claimedAt = Date.now();
    cs.persist(storage, d);
  }, name);
  await p.page.goto(BASE + Q);
  await p.page.waitForTimeout(1500);
  await toMenu(p.page, size);
  // 時刻の記録を始める（画面を読み込み直さない限り続く）と、盤面の見張り
  await p.page.evaluate(() => {
    globalThis.__otecaStartLog = [];
    const seen = new Set();
    const tick = () => {
      const b = document.querySelector('.stage .battle-board');
      if (b && !seen.has('board')) {
        seen.add('board');
        globalThis.__otecaStartLog.push({ name: 'board', at: Date.now() });
      }
      // 先攻決めなどの演出が終わって、誰かが操作できる（busy でなくなった）
      if (b && b.getAttribute('data-state') !== 'busy' && b.getAttribute('data-state') && !seen.has('ready')) {
        seen.add('ready');
        globalThis.__otecaStartLog.push({ name: 'ready', at: Date.now() });
      }
      if (!seen.has('ready')) requestAnimationFrame(tick);
    };
    tick();
  });
  return p;
}

const STAGES = [
  ['join', '部屋に入る（2人目）'],
  ['roomOpen', '前の部屋を出終わる・Trystero の部屋を開く'],
  ['peerJoin', 'つなぎ役（Nostr の中継）で相手を見つけ、WebRTC がつながる'],
  ['hello', '最初のあいさつ（hello）が届く'],
  ['match', '対戦者を決める（決め打ちの待ち）'],
  ['deckGot', 'デッキと種のコミットが届く'],
  ['revealGot', '種のリビールが届き、確かめる'],
  ['seed', '種が決まる（SHA-256）'],
  ['vsEnd', '「あいてが きた！」と VS の表示（決め打ち）'],
  ['allowed', '相手の停止の確認（サーバー）'],
  ['board', '対戦画面が出る'],
  ['ready', '先攻決めの演出が終わり、操作できる'],
];

for (let i = 0; i < N; i++) {
  const bA = await launch();
  const bB = await launch();
  try {
    const A = await player(bA, 'A', SIZES[0]);
    const B = await player(bB, 'B', SIZES[0]);
    const room = String(Date.now()).slice(-6);
    for (const p of [A, B]) {
      await p.page.getByTestId('menu-online').click();
      await p.page.getByTestId('online-friend').click();
      await p.page.getByTestId('room-input').waitFor();
      for (const d of room) await p.page.getByRole('button', { name: d, exact: true }).click();
    }
    // 2人とも「へやに はいる」をほぼ同時に押す
    await Promise.all([A, B].map((p) => p.page.getByRole('button', { name: 'へやに はいる' }).first().click()));
    await Promise.all([A, B].map((p) => p.page.waitForFunction(() => globalThis.__otecaStartLog?.some((m) => m.name === 'ready'), null, { timeout: 90000 })));
    const logs = await Promise.all([A, B].map((p) => p.page.evaluate(() => globalThis.__otecaStartLog)));
    if (process.env.DUMP) for (const l of logs) console.log(l.map((m) => `${m.name}+${m.at - logs[0][0].at}`).join(" "));
    // 各段階の時刻は「2人とも済んだ時刻」（遅い方）。起点は2人目が部屋に入った時刻
    const at = (name) => Math.max(...logs.map((l) => l.find((m) => m.name === name)?.at ?? NaN));
    const t0 = at('join');
    const row = {};
    let prev = t0;
    for (const [name] of STAGES.slice(1)) {
      const t = at(name);
      row[name] = Number.isFinite(t) ? Math.max(0, t - prev) : NaN;
      if (Number.isFinite(t)) prev = Math.max(prev, t);
    }
    row.total = prev - t0;
    rows.push(row);
    console.log(`試行 ${i + 1}：合計 ${row.total}ms`, JSON.stringify(row));
  } catch (e) {
    console.log(`試行 ${i + 1}：失敗 ${String(e).split(NL)[0]}`);
  } finally {
    await bA.close();
    await bB.close();
  }
}

const median = (xs) => {
  const v = xs.filter(Number.isFinite).sort((a, b) => a - b);
  return v.length ? v[Math.floor(v.length / 2)] : NaN;
};
console.log(`${NL}| 段階 | かかった時間（${rows.length}回の中央値） |${NL}|---|---|`);
for (const [name, label] of STAGES.slice(1)) console.log(`| ${label} | ${median(rows.map((r) => r[name]))}ms |`);
console.log(`| **合計** | **${median(rows.map((r) => r.total))}ms** |`);
