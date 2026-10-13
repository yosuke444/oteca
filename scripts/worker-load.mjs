// 負荷の見積もり（SPEC §16-2i I07。npm run worker:load）
// 手元の Worker（wrangler dev）で、1試合・ランキング表示・まとめ処理（参加者1,000人分）の
// Worker へのリクエスト数・Durable Object へのリクエスト数と読み書きした行数・D1 の読み書きした行数を測り、
// 無料枠で1日に何人まで耐えられるかを計算する。最後に、受付係に200人が同時に待つ場合を模擬する。
// 結果は worker/LOAD.md に書く。
import { writeFileSync } from 'node:fs';
import { LOCAL_ADMIN_KEY as ADMIN, api, connectLobby, pid, register, sleep, startWorker, until } from './worker-dev.mjs';

const PROTOCOL = 6;
const FREE = { workerReq: 100000, doReq: 100000, doRead: 5000000, doWrite: 100000, d1Read: 5000000, d1Write: 100000, doGbs: 13000 };
const admin = (B, path, body) => api(B, path, { method: 'POST', admin: ADMIN, origin: null, body });
const stats = async (B, reset = false) => (await admin(B, `/admin/stats${reset ? '?reset=1' : ''}`)).json.lobby;
const sum = (xs) => xs.reduce((a, b) => a + b, 0);
const out = [];
const log = (s = '') => {
  console.log(s);
  out.push(s);
};

const w = await startWorker(8789);
const B = w.base;
const measured = {};
try {
  // ---------------------------------------------------------------- 1試合
  const P = [1, 2].map((n) => ({ id: pid(n, 'b') }));
  for (const p of P) p.token = (await register(B, p.id, `p${p.id.slice(-2)}`)).token;
  await stats(B, true);
  const cs = P.map((p) => connectLobby(B, p));
  await Promise.all(cs.map((c) => c.waitOpen()));
  cs.forEach((c, i) => c.join({ userId: P[i].id, protocol: PROTOCOL, lastOpponentId: '', name: 'p', rate: 100 }));
  await until(() => cs.every((c) => c.paired()));
  const matchId = cs[0].paired().matchId;
  const lobbySt = (await stats(B, true)).totals;
  const reps = [];
  for (const p of P) reps.push(await api(B, '/result', { method: 'POST', body: { matchId, userId: p.id, token: p.token, winner: P[0].id } }));
  const repSt = (await stats(B, true)).totals;
  // まとめ処理のうち、この1試合の分（受付係から読む・消す。D1 は人数で決まるので別に測る）
  const one = await admin(B, '/admin/run-batch');
  measured.match = {
    workerReq: 2 /* 受付係への WebSocket の接続 ×2 */ + reps.length,
    doReq: 2 + lobbySt.wsMessages / 20 + sum(reps.map((r) => r.count.doRequests)),
    wsMessages: lobbySt.wsMessages,
    doRead: lobbySt.rowsRead + repSt.rowsRead,
    doWrite: lobbySt.rowsWritten + repSt.rowsWritten,
    // 受付係につなぐ時の token の確かめ（1人1行）も足す
    d1Read: sum(reps.map((r) => r.count.d1Read)) + 2,
    d1Write: sum(reps.map((r) => r.count.d1Written)),
    batchDoRead: one.count.doRead,
    batchDoWrite: one.count.doWritten,
  };
  log('## 1試合（2人。さがす → 組む → 2人が結果を報告）');
  log('');
  log(`- Worker へのリクエスト：${measured.match.workerReq}回（受付係への接続 2・結果の報告 2）`);
  log(`- Durable Object へのリクエスト：${measured.match.doReq.toFixed(2)}回（接続 2・WebSocket で受け取ったメッセージ ${lobbySt.wsMessages}通 ÷ 20・報告 2）`);
  log(`- Durable Object の行：読み ${measured.match.doRead}・書き ${measured.match.doWrite}（組む・報告）＋ まとめ処理で 読み ${measured.match.batchDoRead}・書き ${measured.match.batchDoWrite}（このうち数行は まとめ処理1回ごとの印と「その日に数えた数」。試合の多い日は1試合あたり 書き約1）`);
  log(`- D1 の行：読み ${measured.match.d1Read}・書き ${measured.match.d1Write}（受付係への接続と報告の token の確かめ）`);
  log('');

  // ---------------------------------------------------------------- ランキング表示・起動
  const rk = await api(B, `/ranking?userId=${P[0].id}&token=${P[0].token}`);
  const me = await api(B, `/me?userId=${P[0].id}&token=${P[0].token}`);
  measured.view = { workerReq: 1, d1Read: rk.count.d1Read, d1Write: rk.count.d1Written };
  measured.me = { workerReq: 1, d1Read: me.count.d1Read, d1Write: me.count.d1Written };
  log('## ランキング表示（GET /ranking。次の更新までは端末に保存した一覧を使うので、1人 更新1回につき1回まで＝1日2回まで）');
  log('');
  log(`- Worker へのリクエスト：1回、Durable Object：0回`);
  log(`- D1 の行：読み ${measured.view.d1Read}・書き ${measured.view.d1Write}`);
  log('');
  log('## 起動した時の正式なレートの受け取り（GET /me。起動するたび）');
  log('');
  log(`- Worker へのリクエスト：1回、D1 の行：読み ${measured.me.d1Read}・書き ${measured.me.d1Write}`);
  log('');

  // ---------------------------------------------------------------- まとめ処理（1,000人）
  const N = 1000;
  const ids = Array.from({ length: N }, (_, i) => pid(10000 + i, 'c'));
  const DAY = 24 * 60 * 60 * 1000;
  /** 「その日」の試合の時刻（日ごとにずらす。予備の試合の1日10試合は日本時間の日付で数えるので） */
  const dayAt = (d) => Date.now() - (20 - d) * DAY;
  /** 1人あたり k 試合（相手はずらして選ぶ） */
  const seedResults = (k, at) => {
    const rs = [];
    for (let j = 0; j < k / 2; j++)
      for (let i = 0; i < N; i++) {
        const opp = (i + 1 + j) % N;
        rs.push({ a: ids[i], b: ids[opp], winner: (i + j) % 3 ? ids[i] : ids[opp], at: at + rs.length });
      }
    return rs;
  };
  await admin(B, '/admin/seed', { players: ids });
  const batches = [];
  // 1日1回（前の作り）と1日2回（v2.0-J）：同じ試合の数を、1回でまとめて／午前と午後の2回に分けて計算する
  const total = (xs, key) => xs.reduce((a, x) => a + x[key], 0);
  const scenarios = [
    ['1日目（1,000人が はじめて のる。1人3試合）', 3, 1],
    ['2日目（同じ1,000人。1人3試合）', 3, 1],
    ['3日目（同じ1,000人。1人10試合）', 10, 1],
    ['4日目（同じ1,000人。1人30試合）', 30, 1],
    ['5日目（1人3試合。1日2回）', 3, 2],
    ['6日目（1人10試合。1日2回）', 10, 2],
    ['7日目（1人30試合。1日2回）', 30, 2],
  ];
  for (let d = 0; d < scenarios.length; d++) {
    const [label, k, times] = scenarios[d];
    const rs = seedResults(k, times === 2 ? Date.now() - 2 * 60 * 60 * 1000 + d * 60 * 1000 : dayAt(d));
    const parts = times === 1 ? [rs] : [rs.slice(0, Math.ceil(rs.length / 2)), rs.slice(Math.ceil(rs.length / 2))];
    const runs = [];
    let ms = 0;
    for (const part of parts) {
      for (let i = 0; i < part.length; i += 2000) await admin(B, '/admin/seed', { results: part.slice(i, i + 2000) });
      const t0 = Date.now();
      const b = await admin(B, '/admin/run-batch');
      ms += Date.now() - t0;
      runs.push({ ...b.count, counted: b.json.counted });
    }
    batches.push({
      label,
      k,
      times,
      results: rs.length,
      ms,
      doRequests: total(runs, 'doRequests'),
      doRead: total(runs, 'doRead'),
      doWritten: total(runs, 'doWritten'),
      d1Read: total(runs, 'd1Read'),
      d1Written: total(runs, 'd1Written'),
      json: { counted: total(runs, 'counted') },
    });
  }
  log(`## まとめ処理（参加者 ${N.toLocaleString()}人）`);
  log('');
  log('| 日 | 試合 | 数えた | Worker（まとめ処理の回数） |  DO へのリクエスト | DO の行（読み／書き） | D1 の行（読み／書き） | かかった時間（手元） |');
  log('|---|---|---|---|---|---|---|---|');
  for (const b of batches)
    log(`| ${b.label} | ${b.results.toLocaleString()} | ${b.json.counted.toLocaleString()} | ${b.times} | ${b.doRequests} | ${b.doRead.toLocaleString()}／${b.doWritten.toLocaleString()} | ${b.d1Read.toLocaleString()}／${b.d1Written.toLocaleString()} | ${b.ms}ms |`);
  log('');
  measured.batch = batches;

} catch (e) {
  console.error(e);
  process.exitCode = 1;
} finally {
  w.stop();
}

// 受付係に200人：まっさらな Worker で（前の測定の行が残らないように）
{
  const w2 = await startWorker(8791);
  const B = w2.base;
  try {
    // ---------------------------------------------------------------- 200人が同時に待つ
    log('## 受付係に200人が同時に待つ模擬');
    log('');
    const M = 200;
    const people = Array.from({ length: M }, (_, i) => ({ id: pid(50000 + i, 'd') }));
    // 半分の人は、直前の相手が「となりの人」（その2人は組まれてはいけない）
    for (let i = 0; i < M; i += 4) {
      people[i].last = people[i + 1].id;
      people[i + 1].last = people[i].id;
    }
    // 1人は古い版数（だれとも組まれない）
    people[M - 1].protocol = PROTOCOL - 1;
    for (const x of people) x.token = (await register(B, x.id)).token;
    const conns = people.map((x) => connectLobby(B, x));
    const sentAt = [];
    const gotAt = new Array(M).fill(0);
    conns.forEach((c, i) => {
      const prev = c.ws.onmessage;
      c.ws.onmessage = (ev) => {
        prev(ev);
        if (JSON.parse(String(ev.data)).t === 'paired') gotAt[i] = Date.now();
      };
    });
    await Promise.all(conns.map((c) => c.waitOpen()));
    const t0 = Date.now();
    // ほぼ同時に入る（少しずつずらす）
    for (let i = 0; i < M; i++) {
      sentAt[i] = Date.now();
      conns[i].join({ userId: people[i].id, protocol: people[i].protocol ?? PROTOCOL, lastOpponentId: people[i].last ?? '', name: `n${i}`, rate: 100 + i });
      if (i % 20 === 19) await sleep(5);
    }
    await until(() => conns.filter((c) => c.paired()).length >= M - 2, 20000);
    await sleep(500);
    const elapsed = Math.max(...gotAt) - t0;
    const lat = gotAt.map((g, i) => (g ? g - sentAt[i] : null)).filter((x) => x !== null).sort((x, y) => x - y);
    const pct = (q) => lat[Math.min(lat.length - 1, Math.floor(lat.length * q))];
    const pairedBy = new Map();
    let bad = 0;
    conns.forEach((c, i) => {
      const p = c.paired();
      if (!p) return;
      const list = pairedBy.get(p.matchId) ?? [];
      list.push(i);
      pairedBy.set(p.matchId, list);
      const opp = people.findIndex((x) => x.id === p.opponent.userId);
      if (opp < 0 || conns[opp].paired()?.matchId !== p.matchId) bad++;
      if (people[i].last && people[i].last === p.opponent.userId) bad++;
      if ((people[i].protocol ?? PROTOCOL) !== (people[opp]?.protocol ?? PROTOCOL)) bad++;
    });
    const pairedCount = conns.filter((c) => c.paired()).length;
    const pairsOk = [...pairedBy.values()].every((l) => l.length === 2);
    const unpaired = conns.map((c, i) => (c.paired() ? null : i)).filter((x) => x !== null);
    const sim = { M, pairedCount, pairs: pairedBy.size, bad, pairsOk, unpaired, elapsed, latency: { p50: pct(0.5), p90: pct(0.9), max: lat.at(-1) } };
    log(`- ${M}人が ほぼ同時に入った。組まれた人 ${pairedCount}人（${pairedBy.size}組）。組まれなかった人：${unpaired.map((i) => `${i}番${people[i].protocol ? '（古い版数）' : ''}`).join('・')}`);
    log(`- どの組も2人だけ・同じ試合ID：${pairsOk ? 'はい' : 'いいえ'}。直前の相手・版数の違う人・食い違いの組：${bad}組`);
    log(`- 最後の組ができるまで ${elapsed}ms（手元の wrangler dev）。1人ごとの「入ってから組まれるまで」：半分の人が ${sim.latency.p50}ms 以内、9割が ${sim.latency.p90}ms 以内、いちばん遅い人 ${sim.latency.max}ms`);
    log(`- 受付係が受け取ったメッセージ ${M}通（join）。書いた行は1組1行（${pairedBy.size}行）`);
    log('');
    measured.sim = sim;
    for (const c of conns) c.ws.close();
    // 200本の接続が閉じ終わるのを待つ（手元の wrangler dev が詰まらないように）
    await sleep(3000);

  } catch (e) {
    console.error(e);
    process.exitCode = 1;
  } finally {
    w2.stop();
  }
}

// ---------------------------------------------------------------- 無料枠で耐えられる人数
if (measured.match && measured.batch) {
  const m = measured.match;
  const once = measured.batch.filter((x) => x.times === 1);
  const twice = measured.batch.filter((x) => x.times === 2);
  const b1 = once[1]; // 2日目（ふつうの日）
  // まとめ処理の受付係の書き込み・読み込みは、試合の多い日の値を試合数で割る（1回ごとの決まった分を1試合に乗せない）
  const perMatch = { doWrite: m.doWrite + b1.doWritten / b1.results, doRead: m.doRead + b1.doRead / b1.results };
  /** 1人あたりの まとめ処理の D1（2日目の値 ÷ 1,000人） */
  // 書き込みは、いちばん多かった日（はじめて のる日・順位が大きく動く日）で見積もる
  const rows = [];
  for (const [times, list, opens] of [[1, once, 1], [2, twice, 1], [2, twice, 2]])
  for (const k of [3, 10, 30]) {
    const same = list.filter((x) => x.k === k);
    const d1WritePerPlayer = Math.max(...(same.length ? same : list).map((x) => x.d1Written)) / 1000;
    const d1ReadPerPlayer = (same[same.length - 1] ?? list[0]).d1Read / 1000;
    // 1人1日：起動 1回（/me）・ランキング 1回・k 試合（試合は2人なので1人あたり半分）
    const per = {
      workerReq: opens * (measured.me.workerReq + measured.view.workerReq) + (k * m.workerReq) / 2,
      doReq: (k * m.doReq) / 2,
      doWrite: (k * perMatch.doWrite) / 2,
      doRead: (k * perMatch.doRead) / 2,
      d1Read: opens * (measured.me.d1Read + measured.view.d1Read) + (k * m.d1Read) / 2 + d1ReadPerPlayer,
      d1Write: d1WritePerPlayer,
    };
    const lim = {
      workerReq: FREE.workerReq / per.workerReq,
      doReq: FREE.doReq / per.doReq,
      doWrite: FREE.doWrite / per.doWrite,
      doRead: FREE.doRead / per.doRead,
      d1Read: FREE.d1Read / per.d1Read,
      d1Write: FREE.d1Write / per.d1Write,
    };
    const minKey = Object.keys(lim).reduce((a, b) => (lim[a] <= lim[b] ? a : b));
    // §10 の元の作り：報告は開始と終了を2人とも（1試合 Worker 4回）。報告のたびに D1 で計算・書き込み（1試合 約10行。
    // 表の見出しの索引も書くので、実際は その倍ほど）。ランキングは1分ごとに上位100件を D1 から読み直す
    const orig = {
      workerReq: 1 + 1 + (k * 4) / 2,
      d1Write: (k * 10) / 2,
      d1Write2: (k * 20) / 2,
    };
    const origLim = { workerReq: FREE.workerReq / orig.workerReq, d1Write: FREE.d1Write / orig.d1Write, d1Write2: FREE.d1Write / orig.d1Write2 };
    rows.push({ times, opens, k, per, lim, minKey, origLim });
  }
  const label = { workerReq: 'Worker のリクエスト', doReq: 'DO のリクエスト', doWrite: 'DO の書き込み行', doRead: 'DO の読み込み行', d1Read: 'D1 の読み込み行', d1Write: 'D1 の書き込み行' };
  const f = (n) => Math.floor(n).toLocaleString();
  log('## 無料枠で、毎日 何人まで耐えられるか');
  log('');
  log('1人が1日に「起動 n回・ランキング表示 n回・k 試合」する場合（n＝表の「開く」）。いちばん先に尽きる枠で決まる（DO＝Durable Object）。');
  log('');
  log('| 更新 | 開く | 1人の試合数 | Worker のリクエスト | DO のリクエスト | DO の書き込み行 | D1 の書き込み行 | D1 の読み込み行 | **耐えられる人数** | 先に尽きる枠 | §10 の元の作り（見積もり） |');
  log('|---|---|---|---|---|---|---|---|---|---|---|');
  for (const r of rows)
    log(
      `| 1日${r.times}回 | ${r.opens}回 | ${r.k}試合 | ${f(r.lim.workerReq)} | ${f(r.lim.doReq)} | ${f(r.lim.doWrite)} | ${f(r.lim.d1Write)} | ${f(r.lim.d1Read)} | **${f(r.lim[r.minKey])}人** | ${label[r.minKey]} | ${f(Math.min(r.origLim.d1Write2, r.origLim.workerReq))}〜${f(Math.min(r.origLim.d1Write, r.origLim.workerReq))}人（D1 の書き込み行） |`,
    );
  log('');
  log('- 表の数は、それぞれの枠だけで考えた時の人数。DO の読み込み行（1試合 約9行・500万行）はどの場合も大きく余るので省いた。');
  log('- 元の作り：報告のたびに D1 でレートを計算して書く（1試合 約10行、索引をふくめると約20行）。待合所はサーバーを使わない P2P（中継網が混むと組めない）。');
  log('- 新しい作り：D1 に書くのは まとめ処理だけ（1人1行 ＋ 順位の変わった人）。1日に何試合しても D1 の書き込みは増えない。');
  log('- 1日2回（v2.0-J）：午前と午後の両方に遊んだ人は、1日に2回 D1 の行を書く。全員の順位の計算（D1 の読み込み）も2回になる。Worker・DO のリクエストは まとめ処理の分（1日2回）しか増えないので、1日1回開く人なら耐えられる人数は変わらない。ただし、更新ごとに開いてランキングも見る人（1日2回）は Worker のリクエストが1人2回ふえ、人数は少し減る（表の「開く 2回」）。');
  log('- まとめ処理は受付係（Durable Object）の中で動かす。Worker の CPU 時間は1回10ミリ秒まで（Cron も同じ）だが、Durable Object は1回30秒まで（無料プランも同じ）。計算の部分を手元の Node で測ると、1,000人・1,500試合で約5ミリ秒、1,000人・15,000試合で約17ミリ秒、1万人・15,000試合で約32ミリ秒（Worker の中では10ミリ秒を超えて止まるおそれがあった）。');
  log(`- Durable Object の時間：受付係は1つだけ。1日中ずっと起きていても 128MB × 86,400秒 ＝ 10,800 GB秒 で、無料枠（13,000 GB秒）に収まる。待っている人がいない時は休止して数えない。`);
  log('');
  measured.capacity = rows;
}
writeFileSync(new URL('../worker/LOAD.md', import.meta.url), `# 負荷の見積もり（npm run worker:load で作り直す）\n\n測った日：${new Date().toISOString().slice(0, 10)}（手元の wrangler dev）\n\n${out.join('\n')}\n`);
writeFileSync(new URL('../worker/.wrangler/load.json', import.meta.url), JSON.stringify(measured, null, 2));
console.log('worker/LOAD.md に書きました');
