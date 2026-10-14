// レート対戦を2つのブラウザで何回もくり返し、始まらなかった回数と、止まった段階を数える（v2.7）。npm run dev（ポート 5175）のまま
//   node scripts/rate-repeat.mjs [回数=20] [ふつう|slow|relay]
// 受付係は手元の Worker（wrangler dev。?api=local）。部屋は本物の通信（Trystero：Nostr の中継網 ＋ WebRTC）。
// slow：回線を遅くする（Chrome の通信の遅さのまね。往復 400ms・下り上り 400kbps）。relay：TURN だけを使う（?ice=relay）
// 時刻は src/net/startTiming.ts の markStart（globalThis.__otecaStartLog）と、画面の見張り（対戦の盤面）
import { BASE, SIZES, launch, openPage, toMenu } from './pw.mjs';
import { startWorker } from './worker-dev.mjs';

const N = Number(process.argv[2] ?? 20);
const MODE = process.argv[3] ?? 'normal';
const NL = String.fromCharCode(10);
const Q = `?debug=1&api=local${MODE === 'relay' ? '&ice=relay' : ''}`;
/** 1回の上限（組んでから対戦の盤面が出るまで） */
const LIMIT_MS = 45000;
const STAGES = ['found', 'join', 'roomOpen', 'peerJoin', 'hello', 'match', 'deckGot', 'revealGot', 'seed', 'allowed', 'board'];
const LABEL = {
  none: '組み合わせが届かない',
  found: '組み合わせ（VS）',
  join: '2人だけの部屋に入る',
  roomOpen: '部屋を開く',
  peerJoin: 'WebRTC がつながる',
  hello: 'あいさつ',
  match: '対戦者を決める',
  deckGot: 'デッキ・コミット',
  revealGot: 'リビール',
  seed: '種が決まる',
  allowed: '停止の確認',
  board: '対戦が始まる',
};

const worker = await startWorker(8787);
const bA = await launch();
const bB = await launch();

async function player(browser, name) {
  const size = SIZES[1];
  const p = await openPage(browser, size, Q);
  if (MODE === 'slow') {
    const cdp = await p.page.context().newCDPSession(p.page);
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 400, downloadThroughput: 50000, uploadThroughput: 50000 });
  }
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
    d.settings.fxSpeed = 2;
    cs.persist(storage, d);
  }, name);
  await p.page.goto(BASE + Q);
  await p.page.waitForTimeout(1500);
  await toMenu(p.page, size);
  return p;
}

const A = await player(bA, 'えー');
const B = await player(bB, 'びー');
const go = (pg, r, payload) => pg.evaluate(([r, p]) => window.__otecaGo(r, p), [r, payload ?? null]);
const rows = [];
try {
  for (let i = 0; i < N; i++) {
    for (const p of [A, B]) {
      await go(p.page, 'menu');
      await p.page.locator('.stage .menu-scene').first().waitFor();
      await p.page.waitForTimeout(1500);
      await p.page.evaluate(() => {
        globalThis.__otecaStartLog = [];
        const tick = () => {
          // 組み合わせ（found）の後に出た盤面だけ（ページがめくれる演出の写しを数えない）
          const b = globalThis.__otecaStartLog.some((m) => m.name === 'found') && document.querySelector('.stage .battle-board[data-state]');
          if (b) globalThis.__otecaStartLog.push({ name: 'board', at: Date.now() });
          else requestAnimationFrame(tick);
        };
        tick();
      });
      await go(p.page, 'rate');
      await p.page.getByTestId('rate-search').waitFor();
    }
    await Promise.all([A, B].map((p) => p.page.getByTestId('rate-search').click()));
    const t0 = Date.now();
    await Promise.all([A, B].map((p) => p.page.waitForFunction(() => globalThis.__otecaStartLog?.some((m) => m.name === 'board'), null, { timeout: LIMIT_MS }).catch(() => {})));
    const logs = await Promise.all([A, B].map((p) => p.page.evaluate(() => globalThis.__otecaStartLog ?? [])));
    if (process.env.DUMP) for (const l of logs) { const f = l.find((m) => m.name === 'found')?.at ?? 0; console.log(l.map((m) => `${m.name}+${m.at - f}`).join(' ')); }
    const again = await Promise.all([A, B].map((p) => p.page.getByTestId('rate-searching').count()));
    const reached = (name) => logs.every((l) => l.some((m) => m.name === name));
    let last = 'none';
    for (const s of STAGES) if (reached(s)) last = s;
    const ok = last === 'board';
    const found = Math.max(...logs.map((l) => l.find((m) => m.name === 'found')?.at ?? NaN));
    const board = Math.max(...logs.map((l) => l.find((m) => m.name === 'board')?.at ?? NaN));
    const oneSide = logs.map((l) => STAGES.filter((s) => l.some((m) => m.name === s)).at(-1) ?? 'none');
    rows.push({ ok, last, oneSide, ms: ok ? board - found : NaN, retried: logs.some((l) => l.filter((m) => m.name === 'found').length > 1) });
    console.log(`${i + 1}回目：${ok ? `始まった（組んでから ${board - found}ms）` : `始まらない（止まった段階：${LABEL[last]}／A：${LABEL[oneSide[0]]}・B：${LABEL[oneSide[1]]}・さがし直し ${again}）`}${rows.at(-1).retried ? '（1回つながらず、さがし直して始まった）' : ''}`);
    void t0;
  }
} finally {
  await bA.close();
  await bB.close();
  worker.stop?.();
}
const fail = rows.filter((r) => !r.ok);
const by = {};
for (const r of fail) by[r.last] = (by[r.last] ?? 0) + 1;
const okMs = rows.filter((r) => r.ok).map((r) => r.ms).sort((a, b) => a - b);
console.log(`${NL}[${MODE}] ${N}回：始まった ${rows.length - fail.length}回・始まらなかった ${fail.length}回・さがし直して始まった ${rows.filter((r) => r.ok && r.retried).length}回`);
console.log(`組んでから始まるまで（中央値）：${okMs.length ? okMs[Math.floor(okMs.length / 2)] : '-'}ms`);
for (const [k, v] of Object.entries(by)) console.log(`- 止まった段階「${LABEL[k]}」の次で止まった：${v}回`);
process.exit(0);
