// レート対戦とランキングを、公開した Worker（https://oteca-api.oteca-api.workers.dev）で確かめる（SPEC §16-2i I08）。
// 1. 4つのブラウザで「さがす」→ 受付係が2組つくる → 降参で決着 →「かり」のレートと、結果の報告（送れたらセーブから消える）
// 2.「つぎの しあいへ」→ 直前の相手とは組まれない
// 3. まとめ処理を管理キーで手動で動かす → ゲームを開き直すと正式なレート（「かり」が消える）→ ランキングに4人
// 4. 受付係を使わない（?lobby=off）2人 → 予備の小部屋で組める →（2人の報告がそろって）まとめ処理でランキングに出る
// 5. 後片づけ：テストで作ったプレイヤーをサーバーから消す
// 使い方：npm run dev（5175）のまま node scripts/online-ranking.mjs [0|1]（1280×720／844×390）
import { readFileSync } from 'node:fs';
import { SIZES, launch, openPage, shot } from './pw.mjs';

const API = 'https://oteca-api.oteca-api.workers.dev';
const KEY = readFileSync(new URL('../worker/.admin-key.txt', import.meta.url), 'utf8').trim();
const size = SIZES[Number(process.argv[2] ?? 0)];
const browser = await launch();
const problems = [];
const allIds = [];
const admin = async (path, body = {}) => (await fetch(`${API}${path}`, { method: 'POST', headers: { 'x-admin-key': KEY, 'content-type': 'application/json' }, body: JSON.stringify(body) })).json();
const L = { surrender: /おてあげする（こうさん）/, yes: 'おてあげする' };

async function save(p) {
  return p.page.evaluate(async () => {
    const cs = await import('/src/save/cookieStore.ts');
    const d = cs.load({ jar: cs.browserCookieJar(), local: window.localStorage, secure: false });
    return { rate: d.rate, stats: d.rateStats, id: d.userId, registered: d.userIdRegistered, ranking: d.ranking, last: d.lastRateOpponentId };
  });
}

async function player(name, query) {
  const p = await openPage(browser, size, `?debug=1&net=dev${query}`);
  await p.page.evaluate(async (name) => {
    const cs = await import('/src/save/cookieStore.ts');
    const sd = await import('/src/save/saveData.ts');
    const storage = { jar: cs.browserCookieJar(), local: window.localStorage, secure: false };
    cs.wipe(storage);
    localStorage.removeItem('oteca.rankingCache');
    const d = sd.createDefaultSave();
    d.playerName = name;
    d.tutorial = { done: true, gachaInviteShown: true, step: 0 };
    d.settings.fxSpeed = 2;
    d.loginBonus.claimedAt = Date.now();
    d.updateNoticeSeen = true;
    cs.persist(storage, d);
  }, name);
  await p.page.reload();
  await p.page.waitForTimeout(2000);
  await p.page.mouse.click(size.width / 2, size.height / 2);
  await p.page.getByTestId('menu-online').click();
  await p.page.getByTestId('online-rate').click();
  const s = await save(p);
  allIds.push(s.id);
  const rec = { name, query, ...p };
  (globalThis.__pages ??= []).push(rec);
  return rec;
}

async function surrender(p) {
  await p.page.locator('.battle-board').waitFor({ timeout: 90000 });
  await p.page.waitForTimeout(2500);
  await p.page.locator('.battle-top__btn--gear').click();
  await p.page.getByRole('button', { name: L.surrender }).click();
  await p.page.getByRole('button', { name: L.yes, exact: true }).click();
}
const vsOpp = async (p) => (await p.page.locator('.lobby-vs__side--opp .lobby-vs__name').textContent()).trim();
const snap = async (p, n) => {
  await p.page.waitForTimeout(400);
  await shot(p.page, `iranking_${size.name}_${n}_${p.name}`);
};
/** 公開した Worker のランキング（名前 → 試合数とレート） */
async function serverRanking() {
  const rk = await (await fetch(`${API}/ranking`, { headers: { Origin: 'http://localhost:5175' } })).json();
  return new Map(rk.top.map((r) => [r.name, { games: r.wins + r.losses, rate: r.rate }]));
}

/** 報告が送れるまで待つ（セーブの unsent が空になる） */
async function waitSent(p, ms = 30000) {
  const end = Date.now() + ms;
  for (;;) {
    const s = await save(p);
    if (s.registered && s.ranking.token && s.ranking.unsent.length === 0) return s;
    if (Date.now() > end) {
      problems.push(`${p.name} の報告が送れていない：${JSON.stringify(s.ranking)}`);
      return s;
    }
    await p.page.waitForTimeout(500);
  }
}

/** 1回の対戦：全員が さがす → 組まれる → 名前の早い方が降参 → 結果 */
async function round(ps, label, names) {
  for (const p of ps) {
    await p.page.getByTestId(label === 1 ? 'rate-search' : 'rate-next').click();
    await p.page.waitForTimeout(300);
  }
  await snap(ps[0], `r${label}_searching`);
  try {
    await Promise.all(ps.map((p) => p.page.getByTestId('vs').waitFor({ timeout: 180000 })));
  } catch (e) {
    for (const p of ps) {
      await shot(p.page, `iranking_fail_${label}_${p.name}`);
      console.log(p.name, JSON.stringify(await save(p)), p.errors.slice(-5));
    }
    throw e;
  }
  const opp = {};
  for (const p of ps) opp[p.name] = await vsOpp(p);
  await snap(ps[0], `r${label}_vs`);
  for (const p of ps) if (opp[opp[p.name]] !== p.name) problems.push(`${label}回目の組み合わせが合わない：${JSON.stringify(opp)}`);
  await Promise.all(ps.map((p) => p.page.locator('.battle-board').waitFor({ timeout: 90000 })));
  const losers = ps.filter((p) => names.indexOf(p.name) < names.indexOf(opp[p.name]));
  for (const p of losers) await surrender(p);
  await Promise.all(ps.map((p) => p.page.getByTestId('rate-change').waitFor({ timeout: 60000 })));
  await snap(ps[0], `r${label}_result`);
  for (const p of ps) if (!(await p.page.getByTestId('rate-kari').first().isVisible())) problems.push(`${p.name} のリザルトに「かり」が無い`);
  for (const p of ps) {
    const s = await waitSent(p);
    if (!s.ranking.provisional) problems.push(`${p.name} のレートが「かり」になっていない`);
  }
  return opp;
}

try {
  // ---------------- 1〜3：受付係
  const NAMES = ['てすとA', 'てすとB', 'てすとC', 'てすとD'];
  const ps = [];
  for (const n of NAMES) ps.push(await player(n, ''));
  const first = await round(ps, 1, NAMES);
  for (const p of ps) if (await p.page.getByTestId('rate-fallback').isVisible().catch(() => false)) problems.push(`${p.name} が予備の待合所になった`);
  // 1回目の まとめ処理（4:00 の分のつもり）：1回目の2試合だけがランキングに出る
  const b0 = await admin('/admin/run-batch');
  console.log('まとめ処理 1回目:', JSON.stringify(b0));
  if (!b0.ok || b0.counted !== 2) problems.push(`1回目の まとめ処理（2試合）：${JSON.stringify(b0)}`);
  const rk0 = await serverRanking();
  for (const n of NAMES) if (rk0.get(n)?.games !== 1) problems.push(`1回目の更新の後、${n} の試合数：${JSON.stringify(rk0.get(n))}`);
  const second = await round(ps, 2, NAMES);
  for (const p of ps) if (second[p.name] === first[p.name]) problems.push(`${p.name} が直前の相手と また組まれた：${JSON.stringify({ first, second })}`);
  const local = {};
  for (const p of ps) local[p.name] = await save(p);

  // 2回目の まとめ処理（16:00 の分のつもり）：前回より後の2試合を足す。
  // 更新の11分前より後に終わった試合は端末が上書きしないので、まとめ処理の時刻を12分後にして動かす
  const b1 = await admin('/admin/run-batch', { now: Date.now() + 12 * 60 * 1000 });
  if (!b1.ok || b1.counted !== 2) problems.push(`2回目の まとめ処理（2試合）：${JSON.stringify(b1)}`);
  console.log('まとめ処理 2回目:', JSON.stringify(b1));
  const rk1 = await serverRanking();
  for (const p of ps) {
    const x = rk1.get(p.name);
    if (x?.games !== 2 || x.rate !== local[p.name].rate) problems.push(`2回目の更新の後、${p.name}：${JSON.stringify(x)}（端末は ${local[p.name].rate}）`);
  }
  // 開き直す → 正式なレートで上書き（「かり」が消える）
  for (const p of ps) {
    await p.page.goto(`http://localhost:5175/?debug=1&net=dev`);
    // 起動して1.5秒後に、送れなかった報告を送り、正式なレートを聞く（最大15秒待つ）
    let s = await save(p);
    for (let i = 0; i < 30 && s.ranking.provisional; i++) {
      await p.page.waitForTimeout(500);
      s = await save(p);
    }
    if (s.ranking.provisional) problems.push(`${p.name}：開き直しても「かり」のまま`);
    if (s.rate !== local[p.name].rate) problems.push(`${p.name}：正式なレート ${s.rate} が端末のかりのレート ${local[p.name].rate} と違う`);
  }
  const p0 = ps[0];
  await p0.page.mouse.click(size.width / 2, size.height / 2);
  await p0.page.getByTestId('menu-online').waitFor();
  await p0.page.evaluate(() => window.__otecaGo('ranking'));
  await p0.page.getByTestId('ranking-row-mine').waitFor({ timeout: 20000 });
  await snap(p0, 'ranking');
  const names = await p0.page.locator('.ranking-table__name').allTextContents();
  for (const n of NAMES) if (!names.includes(n)) problems.push(`ランキングに ${n} がいない：${names.join(',')}`);

  // ---------------- 4：予備の小部屋（受付係を使わない）
  const FB = ['よびE', 'よびF'];
  const qs = [];
  for (const n of FB) qs.push(await player(n, '&lobby=off'));
  for (const q of qs) {
    await q.page.getByTestId('rate-search').click();
    await q.page.getByTestId('rate-fallback').waitFor({ timeout: 10000 });
  }
  await snap(qs[0], 'fallback_searching');
  const t0 = Date.now();
  await Promise.all(qs.map((q) => q.page.getByTestId('vs').waitFor({ timeout: 300000 })));
  console.log(`予備の小部屋で組めるまで ${Math.round((Date.now() - t0) / 1000)}秒`);
  if ((await vsOpp(qs[0])) !== FB[1]) problems.push('予備の小部屋の組み合わせが合わない');
  await Promise.all(qs.map((q) => q.page.locator('.battle-board').waitFor({ timeout: 90000 })));
  await surrender(qs[0]);
  await Promise.all(qs.map((q) => q.page.getByTestId('rate-change').waitFor({ timeout: 60000 })));
  for (const q of qs) await waitSent(q);
  const b2 = await admin('/admin/run-batch');
  console.log('まとめ処理 3回目:', JSON.stringify(b2));
  if (!b2.ok || b2.counted !== 1) problems.push(`まとめ処理（予備の1試合）：${JSON.stringify(b2)}`);
  const rk = await (await fetch(`${API}/ranking`, { headers: { Origin: 'http://localhost:5175' } })).json();
  const rkNames = rk.top.map((r) => r.name);
  for (const n of [...NAMES, ...FB]) if (!rkNames.includes(n)) problems.push(`ランキング（サーバー）に ${n} がいない`);

  const errors = [...ps, ...qs].flatMap((p) => p.errors.filter((e) => !/AudioContext|WebSocket|Failed to load resource/.test(e)).map((e) => `${p.name}: ${e}`));
  if (errors.length) problems.push(...errors);
} catch (e) {
  problems.push(String(e?.stack ?? e));
} finally {
  // ---------------- 5：後片づけ
  // 途中で作り直された ID もふくめて、今のセーブの ID も足す
  for (const p of [...(globalThis.__pages ?? [])]) allIds.push(await save(p).then((x) => x.id).catch(() => ''));
  const ids = [...new Set(allIds)].filter((x) => /^[1-9][0-9]{14}$/.test(x));
  if (ids.length) console.log('テストのプレイヤーを消す:', JSON.stringify(await admin('/admin/delete-players', { userIds: ids })));
  // 報告待ちの試合が残っていると、次の まとめ処理でテストの人がまた出てくるので、受付係の試合も消す
  if (ids.length) console.log('テストの人の試合を消す:', JSON.stringify(await admin('/admin/clear-games', { userIds: ids })));
  console.log('受付係:', JSON.stringify(await admin('/admin/stats')));
  await browser.close();
}
console.log(size.name, problems.length ? `\n${problems.join('\n')}` : '問題 なし');
