// Worker のテスト（npm run test:worker。SPEC §16-2i I06）
// 手元の Worker（wrangler dev。まっさらな保存領域）で、登録・受付係・報告・まとめ処理・ランキング・CORS・管理キーを確かめる。
// 受付係・結果・まとめ処理の細かい決まりは tests/ranking.logic.test.ts（npm test）で確かめている。
import { createHash } from 'node:crypto';
import { LOCAL_ADMIN_KEY as ADMIN, ORIGIN, api, connectLobby, pid, register, sleep, startWorker, until } from './worker-dev.mjs';

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok });
  console.log(`${ok ? '  ✓' : '  ✗'} ${name}${ok ? '' : `  ${detail}`}`);
}

/** §8-4 の式（src/online/rateMath.ts と同じ） */
function nextRate(me, opp, win) {
  const e = 1 / (1 + 10 ** ((opp - me) / 200));
  return Math.max(0, Math.round(me + 20 * ((win ? 1 : 0) - e)));
}

const PROTOCOL = 6;
const w = await startWorker(8788);
const B = w.base;
try {
  console.log('CORS・管理キー');
  check('ほかのサイトからは 403', (await api(B, '/ranking', { origin: 'https://evil.example' })).status === 403);
  check('Origin の無い呼び出しも 403（管理用の道を除く）', (await api(B, '/ranking', { origin: null })).status === 403);
  const pre = await fetch(`${B}/ranking`, { method: 'OPTIONS', headers: { Origin: 'http://127.0.0.1:4173', 'Access-Control-Request-Method': 'POST' } });
  check('localhost・127.0.0.1 からの事前確認は通る', pre.status === 204 && pre.headers.get('access-control-allow-origin') === 'http://127.0.0.1:4173');
  const pub = await api(B, '/ranking', { origin: 'https://yosuke444.github.io' });
  check('公開サイトからは通る', pub.status === 200 && pub.headers.get('access-control-allow-origin') === 'https://yosuke444.github.io');
  check('管理キーが違えば 401', (await api(B, '/admin/stats', { method: 'POST', admin: 'nope', origin: null })).status === 401);
  check('管理キーが無ければ 401', (await api(B, '/admin/stats', { method: 'POST', origin: null })).status === 401);

  console.log('登録と token');
  const P = ['a1', 'a2', 'a3', 'a4', 'a5'].map((s, i) => ({ id: pid(i + 1), name: ['あお', 'ばかくん', 'みどり', 'ひみつ', 'きいろ'][i] }));
  for (const p of P) {
    const r = await api(B, '/register', { method: 'POST', body: { playerId: p.id, name: p.name, optIn: p.name !== 'ひみつ' } });
    p.token = r.json?.token;
  }
  check('登録すると token（32桁）がもらえる', P.every((p) => /^[0-9a-f]{32}$/.test(p.token ?? '')));
  check('2回目の登録は 409（token は1回しか出さない）', (await api(B, '/register', { method: 'POST', body: { playerId: P[0].id } })).status === 409);
  check('playerId の形が変なら 400', (await api(B, '/register', { method: 'POST', body: { playerId: 'xyz' } })).status === 400);
  const me0 = await api(B, `/me?playerId=${P[0].id}&token=${P[0].token}`);
  check('/me で自分のデータ（レート 100）', me0.json?.me?.rate === 100 && me0.json?.nextAt > Date.now());
  const meBad = await api(B, `/me?playerId=${P[0].id}&token=${'0'.repeat(32)}`);
  check('token が違えば me は null', meBad.status === 200 && meBad.json?.me === null);

  console.log('受付係');
  const join = (c, p, extra = {}) => c.join({ playerId: p.id, protocol: PROTOCOL, lastOpponentId: '', name: p.name, rate: 100, ...extra });
  const bad = connectLobby(B, P[0], 'https://evil.example');
  await sleep(500);
  check('ほかのサイトからは受付係につながらない', !bad.opened);
  const noTok = connectLobby(B, { id: P[0].id, token: 'f'.repeat(32) });
  await sleep(500);
  check('token が違えば受付係につながらない（他人の playerId で並べない）', !noTok.opened);
  const other = connectLobby(B, P[2]);
  await other.waitOpen();
  join(other, P[0]);
  await until(() => other.closed);
  check('つないだ人と違う playerId の join は切られる', other.closed && other.msgs.some((m) => m.t === 'error' && m.body.reason === 'auth'));
  const c1 = connectLobby(B, P[0]);
  const c2 = connectLobby(B, P[1]);
  await c1.waitOpen();
  await c2.waitOpen();
  join(c1, P[0]);
  await until(() => c1.lastCount() === 1);
  check('待っている人数が届く（1にん）', c1.lastCount() === 1);
  join(c2, P[1]);
  await until(() => c1.paired() && c2.paired());
  const p1 = c1.paired();
  const p2 = c2.paired();
  check('2人が組まれ、同じ試合ID と部屋名が届く', p1 && p2 && p1.matchId === p2.matchId && p1.roomId === p2.roomId && /^[0-9a-f]{16}$/.test(p1.matchId));
  check('相手の playerId・名前・レートが届く', p1?.opponent.playerId === P[1].id && p2?.opponent.playerId === P[0].id && p1?.opponent.name === P[1].name);
  await until(() => c1.closed && c2.closed);
  check('組めたら受付係との接続が切れる', c1.closed && c2.closed);

  // 直前の相手とは組まない：A(前=B)・B(前=A) → 組まれない。C が来たら A と C
  const a = connectLobby(B, P[0]);
  const b = connectLobby(B, P[1]);
  const c = connectLobby(B, P[2]);
  await Promise.all([a.waitOpen(), b.waitOpen(), c.waitOpen()]);
  join(a, P[0], { lastOpponentId: P[1].id });
  await sleep(50);
  join(b, P[1], { lastOpponentId: P[0].id });
  await until(() => b.lastCount() === 2);
  await sleep(300);
  check('直前の相手どうしは組まれない（2にん まっている）', !a.paired() && !b.paired() && b.lastCount() === 2);
  join(c, P[2]);
  await until(() => a.paired() && c.paired());
  check('ほかの人が来たら、先に待っていた人と組む', a.paired()?.opponent.playerId === P[2].id && c.paired()?.opponent.playerId === P[0].id && !b.paired());
  await until(() => b.lastCount() === 1);
  check('人数が変わったら知らせる（1にんに もどる）', b.lastCount() === 1);

  // やめる：B は「やめる」。D が来ても B とは組まない
  b.leave();
  await until(() => b.closed);
  const d = connectLobby(B, P[3]);
  await d.waitOpen();
  join(d, P[3]);
  await sleep(500);
  check('「やめる」と待ち行列から外れる', !d.paired() && d.lastCount() === 1);

  // 通信が切れた：E が来て切れる。F が来ても E とは組まない
  const e = connectLobby(B, P[4]);
  await e.waitOpen();
  join(e, P[4]);
  await until(() => d.paired() && e.paired());
  check('（D と E が組まれる）', d.paired()?.opponent.playerId === P[4].id);
  const G = await register(B, pid(100), 'g');
  const H = await register(B, pid(101), 'h');
  const V = await register(B, pid(102), 'old');
  const g = connectLobby(B, G);
  const h = connectLobby(B, H);
  await Promise.all([g.waitOpen(), h.waitOpen()]);
  join(g, G);
  await until(() => g.lastCount() === 1);
  g.ws.close();
  await sleep(300);
  join(h, H);
  await sleep(500);
  check('タブを閉じた・切れた人は待ち行列から外れる', !h.paired() && h.lastCount() === 1);

  // プロトコル版数の違い
  const v5 = connectLobby(B, V);
  await v5.waitOpen();
  v5.join({ playerId: pid(102), protocol: 5, lastOpponentId: '', name: 'old', rate: 100 });
  await sleep(500);
  check('プロトコル版数の違う人とは組まない', !v5.paired() && !h.paired());
  check('人数は版数ごとに数える', v5.lastCount() === 1 && h.lastCount() === 1);
  // 同じ playerId の2つ目のタブ：前の接続は外れる
  const h2 = connectLobby(B, H);
  await h2.waitOpen();
  join(h2, H);
  await until(() => h.closed);
  check('同じセーブの2つ目のタブが来たら、前の接続は外れる（自分どうしでは組まない。前のタブには replaced（4000））', h.closed && h.code === 4000 && !h2.paired());
  const bad2 = connectLobby(B, H);
  await bad2.waitOpen();
  bad2.join({ playerId: 'xyz', protocol: PROTOCOL });
  await until(() => bad2.closed);
  check('形の変な join は切られる', bad2.closed && bad2.msgs.some((m) => m.t === 'error'));
  for (const x of [v5, h2]) x.ws.close();

  console.log('結果の報告');
  const report = (p, matchId, winner, token = p.token) => api(B, '/result', { method: 'POST', body: { matchId, playerId: p.id, token, winner } });
  check('token が違えば 401', (await report(P[0], p1.matchId, P[0].id, 'f'.repeat(32))).status === 401);
  check('試合の2人でない人の報告は 403', (await report(P[2], p1.matchId, P[2].id)).status === 403);
  const r1 = await report(P[0], p1.matchId, P[0].id);
  check('1人目の報告は待つ（wait）', r1.json?.state === 'wait');
  const r2 = await report(P[1], p1.matchId, P[0].id);
  check('2人の報告が一致したら記録（record）', r2.json?.state === 'record');
  check('記録した試合への報告は done', (await report(P[1], p1.matchId, P[1].id)).json?.state === 'done');
  // 食い違い：A-C の試合で、2人とも自分の勝ち
  const ac = a.paired().matchId;
  await report(P[0], ac, P[0].id);
  const r3 = await report(P[2], ac, P[2].id);
  check('食い違ったら記録しない（drop）', r3.json?.state === 'drop');
  // D-E：片方だけ（10分たつまでは記録しない）
  const de = d.paired().matchId;
  const r4 = await report(P[3], de, P[3].id);
  check('片方だけの報告は、すぐには記録しない', r4.json?.state === 'wait');
  // 同じ人の2回目は最初のものを残す
  await report(P[3], de, P[4].id);
  // 予備の待合所の試合（受付係の知らない試合ID）：2人そろえば記録
  const fb = 'fb00000000000001';
  await report(P[2], fb, P[4].id);
  const r5 = await report(P[4], fb, P[4].id);
  check('受付係の知らない試合も、2人の報告が一致したら記録', r5.json?.state === 'record');
  let stats = (await api(B, '/admin/stats', { method: 'POST', admin: ADMIN, origin: null })).json;
  check('受付係に記録した結果は2試合（A-B・予備）、報告を待っている試合は1つ（D-E）', stats.lobby.results === 2 && stats.lobby.open === 1, JSON.stringify(stats));

  console.log('まとめ処理とランキング');
  const batch = await api(B, '/admin/run-batch', { method: 'POST', admin: ADMIN, origin: null });
  check('まとめ処理が動く（2試合を数える）', batch.json?.ok && batch.json.counted === 2, JSON.stringify(batch.json));
  stats = (await api(B, '/admin/stats', { method: 'POST', admin: ADMIN, origin: null })).json;
  check('処理した結果は受付係から消える（片方だけの報告は10分まで残る）', stats.lobby.results === 0 && stats.lobby.open === 1, JSON.stringify(stats));
  const rk = await api(B, `/ranking?playerId=${P[0].id}&token=${P[0].token}`);
  const top = rk.json?.top ?? [];
  const aRate = nextRate(100, 100, true);
  const eRate = nextRate(100, 100, true);
  check('ランキングに4人（試合のあった人だけ）', top.length === 4, JSON.stringify(top));
  check('勝った人が上、§8-4 の式のレート', top[0].rate === aRate && top[0].rank === 1 && top.at(-1).rate === nextRate(100, 100, false));
  check('同じレートは同じ順位', top.filter((r) => r.rank === 1).length === 2 && eRate === aRate);
  const key = (id) => createHash('sha256').update(id).digest('hex').slice(0, 12);
  const row = (id) => top.find((r) => r.key === key(id));
  check('自分の行の印（playerId は出さない）', row(P[0].id) && !JSON.stringify(rk.json).includes(P[0].id));
  check('禁止語の名前は ""（画面で「ななし」）', row(P[1].id)?.name === '');
  check('ふつうの名前は載る', row(P[0].id)?.name === 'あお');
  check('自分の順位と正式なレート', rk.json.me?.rank === 1 && rk.json.me?.rate === aRate && rk.json.me?.visible === true);
  check('次の更新の時刻（日本時間 4:00 か 14:00）', [4, 14].includes(new Date(rk.json.nextAt + 9 * 3600e3).getUTCHours()) && new Date(rk.json.nextAt).getUTCMinutes() === 0 && rk.json.nextAt > Date.now() && rk.json.nextAt - Date.now() <= 14 * 3600e3 && rk.json.updatedAt > 0);
  const meU = await api(B, `/me?playerId=${P[0].id}&token=${P[0].token}`);
  check('/me の updatedAt は、本当に まとめ処理をした時刻（一覧と同じ）', meU.json?.updatedAt === rk.json.updatedAt && meU.json?.me?.rate === aRate);
  // 名前を載せない設定（/profile）
  check('/profile は token が要る', (await api(B, '/profile', { method: 'POST', body: { playerId: P[0].id, token: 'f'.repeat(32), name: 'x', optIn: false } })).status === 401);
  await api(B, '/profile', { method: 'POST', body: { playerId: P[0].id, token: P[0].token, name: 'あお', optIn: false } });
  await api(B, '/admin/run-batch', { method: 'POST', admin: ADMIN, origin: null });
  const rk2 = await api(B, '/ranking');
  check('名前を載せない設定にすると、次の更新から ""', rk2.json.top.find((r) => r.key === key(P[0].id))?.name === '');
  // 管理キーで名前を消す
  const hid = await api(B, '/admin/hide-name', { method: 'POST', admin: ADMIN, origin: null, body: { playerId: P[2].id } });
  const rk3 = await api(B, '/ranking');
  check('管理キーで名前を消すと、すぐ一覧でも ""', hid.json?.changed === 1 && rk3.json.top.find((r) => r.key === key(P[2].id))?.name === '');
  check('名前を消しても更新の時刻は変わらない', rk3.json.updatedAt === rk2.json.updatedAt);
  const lk = await api(B, '/admin/lookup', { method: 'POST', admin: ADMIN, origin: null, body: { name: 'みど' } });
  check('名前で playerId を探せる', lk.json?.players?.[0]?.id === P[2].id);

  // 7日の非表示・1日3試合：時刻を指定して結果を入れる
  const now = Date.now();
  const old = pid(200);
  const fresh = pid(201);
  await api(B, '/admin/seed', { method: 'POST', admin: ADMIN, origin: null, body: { players: [old, fresh], results: [{ a: old, b: fresh, winner: old, at: now - 1000 }] } });
  await api(B, '/admin/run-batch', { method: 'POST', admin: ADMIN, origin: null });
  check('（試合のあった人が一覧に出る）', (await api(B, '/ranking')).json.top.some((r) => r.key === key(old)));
  const S = [];
  for (let i = 0; i < 5; i++) S.push({ a: pid(300), b: pid(301), winner: pid(300), at: now + i });
  const sd = await api(B, '/admin/seed', { method: 'POST', admin: ADMIN, origin: null, body: { players: [pid(300), pid(301)], results: S } });
  const b5 = await api(B, '/admin/run-batch', { method: 'POST', admin: ADMIN, origin: null });
  check('同じ2人は1日3試合まで（5試合のうち3試合）', sd.json?.lobby?.inserted === 5 && b5.json.counted === 3 && b5.json.skipped === 2, JSON.stringify(b5.json));
  const m300 = (await api(B, '/ranking')).json.top.find((r) => r.key === key(pid(300)));
  check('（3勝が数えられた）', m300?.wins === 3);
  // 1日2回の更新をまたいでも、同じ2人は1日3試合まで（日本時間の同じ日の試合）
  const S2 = [0, 1].map((i) => ({ a: pid(310), b: pid(311), winner: pid(310), at: now + 100 + i }));
  await api(B, '/admin/seed', { method: 'POST', admin: ADMIN, origin: null, body: { players: [pid(310), pid(311)], results: S2 } });
  const am = await api(B, '/admin/run-batch', { method: 'POST', admin: ADMIN, origin: null });
  const S3 = [2, 3, 4].map((i) => ({ a: pid(311), b: pid(310), winner: pid(310), at: now + 100 + i }));
  await api(B, '/admin/seed', { method: 'POST', admin: ADMIN, origin: null, body: { results: S3 } });
  const pm = await api(B, '/admin/run-batch', { method: 'POST', admin: ADMIN, origin: null });
  check('1日2回の更新をまたいでも、同じ2人は1日3試合まで（2試合 ＋ 1試合）', am.json.counted === 2 && pm.json.counted === 1 && pm.json.skipped === 2, JSON.stringify([am.json, pm.json]));

  // 7日以上レートが変わっていない人は表示から外す（データは残す）。次に遊べば戻る
  const later = now + 8 * 24 * 3600e3;
  await api(B, '/admin/run-batch', { method: 'POST', admin: ADMIN, origin: null, body: { now: later } });
  const hidden = await api(B, `/ranking?playerId=${P[0].id}&token=${P[0].token}`);
  const hk = hidden.json.top.map((r) => r.key);
  check('7日以上たつと、一覧から外れる', hidden.json.me?.rank === null && ![P[0], P[1], P[2]].some((p) => hk.includes(key(p.id))));
  // D-E は D だけが報告していた：10分たったので D の申告どおり（D の勝ち）に記録され、一覧に出る
  const dRow = hidden.json.top.find((r) => r.key === key(P[3].id));
  check('片方だけの報告は、10分たつと まとめ処理で その人の申告どおりに記録', hidden.json.top.length === 2 && dRow?.wins === 1 && dRow?.rank === 1, JSON.stringify(hidden.json.top));
  check('データは残る（レート・勝敗）', hidden.json.me?.rate === aRate && hidden.json.me?.wins === 1);
  await api(B, '/admin/seed', { method: 'POST', admin: ADMIN, origin: null, body: { results: [{ a: P[0].id, b: old, winner: P[0].id, at: later - 1000 }] } });
  await api(B, '/admin/run-batch', { method: 'POST', admin: ADMIN, origin: null, body: { now: later } });
  const back = await api(B, `/ranking?playerId=${P[0].id}&token=${P[0].token}`);
  check('次に遊べば一覧に戻る', back.json.top.length === 4 && back.json.top.some((r) => r.key === key(P[0].id)) && back.json.me?.wins === 2, JSON.stringify(back.json.top));

  // まとめ処理が遅れている（最後の写しが前の 4:00 より古い）：一覧は5分後に聞き直してもらう
  await api(B, '/admin/run-batch', { method: 'POST', admin: ADMIN, origin: null, body: { now: Date.now() - 2 * 24 * 3600e3 } });
  const late = await api(B, '/ranking');
  check('まとめ処理が遅れている時は、次の更新の時刻を5分後にする（古い一覧を1日 覚えさせない）', late.json.nextAt - Date.now() <= 5 * 60e3 + 5000 && late.json.nextAt > Date.now(), JSON.stringify({ nextAt: late.json.nextAt }));
  const ok2 = await api(B, '/admin/run-batch', { method: 'POST', admin: ADMIN, origin: null });
  const busy = await Promise.all([api(B, '/admin/run-batch', { method: 'POST', admin: ADMIN, origin: null }), api(B, '/admin/run-batch', { method: 'POST', admin: ADMIN, origin: null })]);
  check('まとめ処理は同時に1つだけ（重なったら busy）', ok2.json?.ok && busy.some((x) => x.json?.ok), JSON.stringify(busy.map((x) => x.json)));
} catch (e) {
  check('とちゅうでエラー', false, e?.stack ?? String(e));
} finally {
  w.stop();
}
const failed = results.filter((r) => !r.ok);
console.log(`\nWorker のテスト：${results.length - failed.length}/${results.length} 通過`);
process.exit(failed.length ? 1 : 0);
