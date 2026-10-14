// Worker のテスト（npm run test:worker。SPEC §16-2i I06）
// 手元の Worker（wrangler dev。まっさらな保存領域）で、登録・受付係・報告・まとめ処理・ランキング・CORS・管理キーを確かめる。
// 受付係・結果・まとめ処理の細かい決まりは tests/ranking.logic.test.ts（npm test）で確かめている。
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { LOCAL_ADMIN_KEY as ADMIN, ORIGIN, api, connectLobby, newToken, pid, register, sleep, startWorker, until } from './worker-dev.mjs';

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

// 今のプロトコル版数（v2.7：受付係は、これより古い版の申し込みを断る）
const PROTOCOL = Number(/PROTOCOL_VERSION = ([0-9]+);/.exec(readFileSync(new URL('../src/config/version.ts', import.meta.url), 'utf8'))[1]);
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

  console.log('ユーザーID の登録（v2.0-J）');
  const P = [];
  for (const [i, name] of ['あお', 'ばかくん', 'みどり', 'ひみつ', 'きいろ'].entries()) P.push(await register(B, pid(i + 1), name, name !== 'ひみつ'));
  check('ユーザーID と端末が作った token で登録できる', P.every((p) => p.status === 200 && /^[0-9a-f]{32}$/.test(p.token ?? '')));
  const again = await api(B, '/register', { method: 'POST', body: { userId: P[0].id, token: P[0].token, name: 'あお' } });
  check('同じユーザーID と同じ token の送り直しは、登録できたことになる', again.status === 200 && again.json?.again === true);
  check('ほかの token で同じユーザーID は 409（ほかの人のユーザーID。端末は作り直す）', (await api(B, '/register', { method: 'POST', body: { userId: P[0].id, token: newToken() } })).status === 409);
  check('ユーザーID の形が変なら 400（先頭0・16進数・桁数）', (
    await Promise.all(['012345678901234', 'abcdefabcdefabcd', '12345'].map((u) => api(B, '/register', { method: 'POST', body: { userId: u, token: newToken() } })))
  ).every((r) => r.status === 400));
  // 今までの人（v2.0-I で playerId と token を持っている人）：その行をユーザーID に付け替え、レート・勝敗を引き継ぐ
  const legacyId = 'abcdefabcdef0123';
  const legacyTok = newToken();
  await api(B, '/admin/seed', { method: 'POST', admin: ADMIN, origin: null, body: { legacy: [{ playerId: legacyId, token: legacyTok, rate: 157, wins: 6, losses: 2, best: 160 }, { playerId: 'abcdefabcdef0999', token: newToken(), rate: 140, name: 'のこる' }] } });
  const L = { id: pid(90), token: legacyTok };
  const mig = await api(B, '/register', { method: 'POST', body: { userId: L.id, token: legacyTok, legacyPlayerId: legacyId, name: 'むかし' } });
  const lme = await api(B, `/me?userId=${L.id}&token=${legacyTok}`);
  check('J02 今までの playerId の行を、ユーザーID に付け替えてレート・勝敗を引き継ぐ', mig.json?.migrated === true && lme.json?.me?.rate === 157 && lme.json?.me?.wins === 6 && lme.json?.me?.best === 160, JSON.stringify([mig.json, lme.json]));
  const t91 = newToken();
  const wrongTok = await api(B, '/register', { method: 'POST', body: { userId: pid(91), token: t91, legacyPlayerId: 'abcdefabcdef0999' } });
  const wme = await api(B, `/me?userId=${pid(91)}&token=${t91}`);
  const left = await api(B, '/admin/lookup', { method: 'POST', admin: ADMIN, origin: null, body: { name: 'のこる' } });
  check('token の合わない playerId は付け替えない（新しい人はレート100、前の行は残る）', wrongTok.json?.ok === true && !wrongTok.json?.migrated && wme.json?.me?.rate === 100 && left.json?.players?.[0]?.id === 'abcdefabcdef0999', JSON.stringify([wrongTok.json, wme.json, left.json]));
  check('古い版の端末（playerId で報告）には 426（token を消させない）', (await api(B, '/result', { method: 'POST', body: { matchId: 'ab'.repeat(8), playerId: legacyId, token: legacyTok, winner: 'void' } })).status === 426);
  const me0 = await api(B, `/me?userId=${P[0].id}&token=${P[0].token}`);
  check('/me で自分のデータ（レート 100）', me0.json?.me?.rate === 100 && me0.json?.nextAt > Date.now());
  const meBad = await api(B, `/me?userId=${P[0].id}&token=${'0'.repeat(32)}`);
  check('token が違えば me は null', meBad.status === 200 && meBad.json?.me === null);

  console.log('受付係');
  const join = (c, p, extra = {}) => c.join({ userId: p.id, protocol: PROTOCOL, lastOpponentId: '', name: p.name, rate: 100, ...extra });
  const bad = connectLobby(B, P[0], 'https://evil.example');
  await sleep(500);
  check('ほかのサイトからは受付係につながらない', !bad.opened);
  const noTok = connectLobby(B, { id: P[0].id, token: 'f'.repeat(32) });
  await sleep(500);
  check('token が違えば受付係につながらない（他人のユーザーID で並べない）', !noTok.opened);
  const other = connectLobby(B, P[2]);
  await other.waitOpen();
  join(other, P[0]);
  await until(() => other.closed);
  check('つないだ人と違うユーザーID の join は切られる', other.closed && other.msgs.some((m) => m.t === 'error' && m.body.reason === 'auth'));
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
  check('相手のユーザーID・名前・レートが届く', p1?.opponent.userId === P[1].id && p2?.opponent.userId === P[0].id && p1?.opponent.name === P[1].name);
  check('K09 両者の正式なレートとトロフィあげの数が届く（端末が送ったレートではなく D1 の値）', p1?.me?.rate === 100 && p1?.me?.trophies === 0 && p1?.opponent.rate === 100 && p1?.opponent.trophies === 0 && p2?.me?.rate === 100, JSON.stringify(p1));
  await until(() => c1.closed && c2.closed);
  check('組めたら受付係との接続が切れる', c1.closed && c2.closed);

  // ⑤ 待っているのが2人だけなら、直前の相手どうしでも組む（v2.7）：A(前=B)・B(前=A) → 組まれる
  //    （3人以上いる時に直前の相手を避けることは、tests/ranking.logic.test.ts ⑥ で確かめる）
  const a = connectLobby(B, P[0]);
  const b = connectLobby(B, P[1]);
  const c = connectLobby(B, P[2]);
  await Promise.all([a.waitOpen(), b.waitOpen(), c.waitOpen()]);
  join(a, P[0], { lastOpponentId: P[1].id });
  await sleep(50);
  join(b, P[1], { lastOpponentId: P[0].id });
  await until(() => a.paired() && b.paired());
  check('⑤ 待っているのが2人だけなら、直前の相手どうしでも組む', a.paired()?.opponent.userId === P[1].id && b.paired()?.opponent.userId === P[0].id && a.paired()?.matchId === b.paired()?.matchId);
  join(c, P[2]);
  await until(() => c.lastCount() === 1);
  check('人数が届く（C だけが待っている：1にん）', c.lastCount() === 1 && !c.paired());

  // やめる：C は「やめる」。D が来ても C とは組まない
  c.leave();
  await until(() => c.closed);
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
  check('（D と E が組まれる）', d.paired()?.opponent.userId === P[4].id);
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

  // プロトコル版数の違い（新しい版の人：受け付けるが、今の版の人とは組まない）
  const v5 = connectLobby(B, V);
  await v5.waitOpen();
  v5.join({ userId: pid(102), protocol: PROTOCOL + 1, lastOpponentId: '', name: 'new', rate: 100 });
  await sleep(500);
  check('⑥ プロトコル版数の違う人とは組まない', !v5.paired() && !h.paired());
  check('人数は版数ごとに数える', v5.lastCount() === 1 && h.lastCount() === 1);
  // 今の版より古い人の申し込みは断る（v2.7。error version・4002 で切る。待っている人数にも数えない）
  {
    const Old = await register(B, pid(104), 'ふるい');
    const o = connectLobby(B, Old);
    await o.waitOpen();
    o.join({ userId: Old.id, protocol: PROTOCOL - 1, lastOpponentId: '', name: 'old', rate: 100 });
    await until(() => o.closed);
    await sleep(200);
    check('⑥ 今の版より古い人の申し込みは断る（version・4002）。組まれない・人数に数えない', o.closed && o.code === 4002 && o.msgs.some((m) => m.t === 'error' && m.body.reason === 'version') && !o.paired() && h.lastCount() === 1, JSON.stringify([o.code, o.msgs]));
  }
  // 同じユーザーID の2つ目の接続（v2.2）：受け付けない（待っている人数にも数えない）
  const h2 = connectLobby(B, H);
  await h2.waitOpen();
  join(h2, H);
  await until(() => h2.closed);
  await sleep(200);
  check('K05 同じユーザーID の2つ目の接続は受け付けない（same-user・4001）。前の接続は待ったまま、人数は1のまま', h2.closed && h2.code === 4001 && h2.msgs.some((m) => m.t === 'error' && m.body.reason === 'same-user') && !h.closed && h.lastCount() === 1 && !h2.paired(), JSON.stringify([h2.code, h2.msgs, h.closed, h.lastCount()]));
  const bad2 = connectLobby(B, H);
  await bad2.waitOpen();
  bad2.join({ userId: 'xyz', protocol: PROTOCOL });
  await until(() => bad2.closed);
  check('形の変な join は切られる', bad2.closed && bad2.msgs.some((m) => m.t === 'error'));
  for (const x of [v5, h2, h]) x.ws.close();

  // 同じタブの入り直し（前の接続が残っていた）：前の接続を外して、新しい接続で待つ（v2.2。tab が同じ時だけ）
  {
    const R = await register(B, pid(103), 'たぶ');
    const tab = 'ab'.repeat(8);
    const t1 = connectLobby(B, R);
    await t1.waitOpen();
    join(t1, R, { tab });
    await until(() => t1.lastCount() >= 1);
    const t2 = connectLobby(B, R);
    await t2.waitOpen();
    join(t2, R, { tab });
    await until(() => t1.closed);
    await sleep(200);
    check('K05 同じタブの入り直しは、前の接続を外して待つ（replaced・4000）', t1.closed && t1.code === 4000 && !t2.closed, JSON.stringify([t1.code, t2.closed, t2.msgs]));
    t2.ws.close();
  }
  // ③ 組んでから始まらなかった2人（v2.7）：「つながらなかった」を記録し、もう一度さがす時は列の先頭に入る。レートは変わらない
  {
    const [Q1, Q2, Q3] = [await register(B, pid(110), 'いち'), await register(B, pid(111), 'に'), await register(B, pid(112), 'さん')];
    const q1 = connectLobby(B, Q1);
    const q2 = connectLobby(B, Q2);
    await Promise.all([q1.waitOpen(), q2.waitOpen()]);
    join(q1, Q1);
    await sleep(50);
    join(q2, Q2);
    await until(() => q1.paired() && q2.paired());
    const mid = q1.paired().matchId;
    const st = (p2, state, m = mid) => api(B, '/match-state', { method: 'POST', body: { matchId: m, userId: p2.id, token: p2.token, state } });
    const f1 = await st(Q1, 'failed');
    check('③ 「つながらなかった」を記録できる（試合の2人だけ。ほかの人・token 違いは断る）', f1.status === 200 && (await st(Q3, 'failed')).status === 400 && (await api(B, '/match-state', { method: 'POST', body: { matchId: mid, userId: Q1.id, token: 'f'.repeat(32), state: 'failed' } })).status === 401);
    // 端末と同じ順：「つながらなかった」→ 無効の報告（2人とも。試合の行は消える）→ もう一度さがす
    await api(B, '/result', { method: 'POST', body: { matchId: mid, userId: Q1.id, token: Q1.token, winner: 'void' } });
    await api(B, '/result', { method: 'POST', body: { matchId: mid, userId: Q2.id, token: Q2.token, winner: 'void' } });
    check('③ 試合の行が消えた後に届いた2人目の「つながらなかった」も受け付ける', (await st(Q2, 'failed')).status === 200);
    // もう一度さがす（retryOf 付き。列の先頭に入る順番は tests/ratestart.v27.test.ts で確かめる）：待っていた Q3 とすぐ組まれる
    const q3 = connectLobby(B, Q3);
    await q3.waitOpen();
    join(q3, Q3);
    await until(() => q3.lastCount() === 1);
    const r1 = connectLobby(B, Q1);
    await r1.waitOpen();
    join(r1, Q1, { retryOf: mid });
    await until(() => r1.paired() && q3.paired());
    check('③ つながらなかった人は、もう一度さがすと すぐ組まれる', r1.paired()?.opponent.userId === Q3.id, JSON.stringify(r1.paired()));
    const mid2 = r1.paired().matchId;
    await st(Q1, 'started', mid2);
    const s1 = (await api(B, '/admin/stats', { method: 'POST', admin: ADMIN, origin: null })).json?.lobby?.starts;
    check('③ 管理画面で「始まった」「つながらなかった」の件数が見られる', s1?.failed24h >= 1 && s1?.started24h >= 1, JSON.stringify(s1));
    // TURN の接続先（v2.7）：登録した人だけ。手元の Worker には TURN キーが無いので空
    const t0 = await api(B, '/turn');
    const t1 = await api(B, `/turn?userId=${Q1.id}&token=${Q1.token}`);
    check('TURN の接続先は登録した人だけ（キーが無ければ空）。保存させない', t0.status === 401 && t1.status === 200 && Array.isArray(t1.json?.iceServers) && t1.json.iceServers.length === 0 && t1.headers.get('cache-control') === 'no-store', JSON.stringify([t0.status, t1.json]));
    // 後片づけ：Q1-Q3 の試合も無効に（ほかの確かめの数に入れない）
    await api(B, '/result', { method: 'POST', body: { matchId: mid2, userId: Q1.id, token: Q1.token, winner: 'void' } });
    await api(B, '/result', { method: 'POST', body: { matchId: mid2, userId: Q3.id, token: Q3.token, winner: 'void' } });
  }
  console.log('実際の対戦のデータ（v2.7・カードの せいせき）');
  {
    const log = { mode: 'rate', build: 'abc123', protocol: PROTOCOL, deckA: [[1, 3], [2, 12]], deckB: [[2, 15]], winner: 0, turns: 9, reason: 'ko', name: 'あお', userId: P[0].id, room: '1234' };
    const ok = await api(B, '/match-log', { method: 'POST', body: log });
    check('試合のデータを受け取る（1試合1回）', ok.status === 200 && ok.json?.ok === true, JSON.stringify(ok.json));
    check('15枚でないデッキ・知らない終わり方は断る', (await api(B, '/match-log', { method: 'POST', body: { ...log, deckA: [[1, 3]] } })).status === 400 && (await api(B, '/match-log', { method: 'POST', body: { ...log, reason: 'x' } })).status === 400);
    await api(B, '/match-log', { method: 'POST', body: { ...log, winner: 1 } });
    const cs = (await api(B, '/admin/card-stats', { method: 'POST', admin: ADMIN, origin: null, body: { range: 'today' } })).json;
    const c1 = cs?.cards?.find((c) => c.no === 1);
    const c2 = cs?.cards?.find((c) => c.no === 2);
    // カード1は2試合とも p1 のデッキ（1勝1敗）。カード2は両方のデッキ（4デッキ・2勝2敗）
    check('管理画面で、カードごとの使われた回数と勝ちが見られる', cs?.games === 2 && c1?.decks === 2 && c1.wins === 1 && c1.decided === 2 && c2?.decks === 4 && c2.wins === 2, JSON.stringify(cs));
    check('管理キーが無ければ カードの せいせき は 401', (await api(B, '/admin/card-stats', { method: 'POST', origin: null, body: { range: 'all' } })).status === 401);
  }
  console.log('結果の報告');
  const report = (p, matchId, winner, token = p.token) => api(B, '/result', { method: 'POST', body: { matchId, userId: p.id, token, winner } });
  check('token が違えば 401', (await report(P[0], p1.matchId, P[0].id, 'f'.repeat(32))).status === 401);
  check('試合の2人でない人の報告は 403', (await report(P[2], p1.matchId, P[2].id)).status === 403);
  const r1 = await report(P[0], p1.matchId, P[0].id);
  check('1人目の報告は待つ（wait）', r1.json?.state === 'wait');
  const r2 = await report(P[1], p1.matchId, P[0].id);
  check('2人の報告が一致したら記録（record）', r2.json?.state === 'record');
  check('記録した試合への報告は done', (await report(P[1], p1.matchId, P[1].id)).json?.state === 'done');
  // 食い違い：2試合目の A-B（直前の相手どうし）で、2人とも自分の勝ち
  const ac = a.paired().matchId;
  await report(P[0], ac, P[0].id);
  const r3 = await report(P[1], ac, P[1].id);
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
  const rk = await api(B, `/ranking?userId=${P[0].id}&token=${P[0].token}`);
  const top = rk.json?.top ?? [];
  const aRate = nextRate(100, 100, true);
  const eRate = nextRate(100, 100, true);
  check('ランキングに4人（試合のあった人だけ）', top.length === 4, JSON.stringify(top));
  check('勝った人が上、§8-4 の式のレート', top[0].rate === aRate && top[0].rank === 1 && top.at(-1).rate === nextRate(100, 100, false));
  check('同じレートは同じ順位', top.filter((r) => r.rank === 1).length === 2 && eRate === aRate);
  const key = (id) => createHash('sha256').update(id).digest('hex').slice(0, 12);
  const row = (id) => top.find((r) => r.key === key(id));
  check('自分の行の印（ユーザーID は出さない）', row(P[0].id) && !JSON.stringify(rk.json).includes(P[0].id));
  check('禁止語の名前は ""（画面で「ななし」）', row(P[1].id)?.name === '');
  check('ふつうの名前は載る', row(P[0].id)?.name === 'あお');
  check('自分の順位と正式なレート', rk.json.me?.rank === 1 && rk.json.me?.rate === aRate && rk.json.me?.visible === true);
  check('K07 次の更新の時刻（日本時間 4:00 か 16:00）', [4, 16].includes(new Date(rk.json.nextAt + 9 * 3600e3).getUTCHours()) && new Date(rk.json.nextAt).getUTCMinutes() === 0 && rk.json.nextAt > Date.now() && rk.json.nextAt - Date.now() <= 12 * 3600e3 && rk.json.updatedAt > 0);
  const meU = await api(B, `/me?userId=${P[0].id}&token=${P[0].token}`);
  check('/me の updatedAt は、本当に まとめ処理をした時刻（一覧と同じ）', meU.json?.updatedAt === rk.json.updatedAt && meU.json?.me?.rate === aRate);
  check('/me は最後に数えた試合の試合ID を返す（端末が自分の試合が数えられたか比べる）', meU.json?.me?.lastMatch === p1.matchId, JSON.stringify(meU.json?.me));
  // 名前を載せない設定（/profile）
  check('/profile は token が要る', (await api(B, '/profile', { method: 'POST', body: { userId: P[0].id, token: 'f'.repeat(32), name: 'x', optIn: false } })).status === 401);
  await api(B, '/profile', { method: 'POST', body: { userId: P[0].id, token: P[0].token, name: 'あお', optIn: false } });
  await api(B, '/admin/run-batch', { method: 'POST', admin: ADMIN, origin: null });
  const rk2 = await api(B, '/ranking');
  check('K06 「ランキングに のる」をオフにすると、一覧に載らない（v2.2。「ななし」でも出さない）', !rk2.json.top.some((r) => r.key === key(P[0].id)) && rk2.json.top.length > 0);
  // オンに戻す（このあとのテストのため）。次の更新から載る
  await api(B, '/profile', { method: 'POST', body: { userId: P[0].id, token: P[0].token, name: 'あお', optIn: true } });
  await api(B, '/admin/run-batch', { method: 'POST', admin: ADMIN, origin: null });
  check('K06 オンに戻すと次の更新で載る', (await api(B, '/ranking')).json.top.some((r) => r.key === key(P[0].id)));
  // 管理キーで名前を消す
  const rkBefore = await api(B, '/ranking');
  const hid = await api(B, '/admin/hide-name', { method: 'POST', admin: ADMIN, origin: null, body: { userId: P[2].id } });
  const rk3 = await api(B, '/ranking');
  check('管理キーで名前を消すと、すぐ一覧でも ""', hid.json?.changed === 1 && rk3.json.top.find((r) => r.key === key(P[2].id))?.name === '');
  check('名前を消しても更新の時刻は変わらない', rk3.json.updatedAt === rkBefore.json.updatedAt);
  const lk = await api(B, '/admin/lookup', { method: 'POST', admin: ADMIN, origin: null, body: { name: 'みど' } });
  check('名前でユーザーID を探せる', lk.json?.players?.[0]?.id === P[2].id);

  // 7日の非表示・同じ2人もすべて数える（v2.7）：時刻を指定して結果を入れる
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
  check('⑦ 同じ2人の試合は、5試合とも すべて数える（v2.7）', sd.json?.lobby?.inserted === 5 && b5.json.counted === 5 && b5.json.skipped === 0, JSON.stringify(b5.json));
  const m300 = (await api(B, '/ranking')).json.top.find((r) => r.key === key(pid(300)));
  check('（5勝が数えられた）', m300?.wins === 5);
  // 1日2回の更新をまたいでも、同じ2人の試合はすべて数える（日本時間の同じ日の試合）
  const S2 = [0, 1].map((i) => ({ a: pid(310), b: pid(311), winner: pid(310), at: now + 100 + i }));
  await api(B, '/admin/seed', { method: 'POST', admin: ADMIN, origin: null, body: { players: [pid(310), pid(311)], results: S2 } });
  const am = await api(B, '/admin/run-batch', { method: 'POST', admin: ADMIN, origin: null });
  const S3 = [2, 3, 4].map((i) => ({ a: pid(311), b: pid(310), winner: pid(310), at: now + 100 + i }));
  await api(B, '/admin/seed', { method: 'POST', admin: ADMIN, origin: null, body: { results: S3 } });
  const pm = await api(B, '/admin/run-batch', { method: 'POST', admin: ADMIN, origin: null });
  check('⑦ 1日2回の更新をまたいでも、同じ2人の試合はすべて数える（2試合 ＋ 3試合）', am.json.counted === 2 && pm.json.counted === 3 && pm.json.skipped === 0, JSON.stringify([am.json, pm.json]));

  // 7日以上レートが変わっていない人は表示から外す（データは残す）。次に遊べば戻る
  const later = now + 8 * 24 * 3600e3;
  await api(B, '/admin/run-batch', { method: 'POST', admin: ADMIN, origin: null, body: { now: later } });
  const hidden = await api(B, `/ranking?userId=${P[0].id}&token=${P[0].token}`);
  const hk = hidden.json.top.map((r) => r.key);
  check('7日以上たつと、一覧から外れる', hidden.json.me?.rank === null && ![P[0], P[1], P[2]].some((p) => hk.includes(key(p.id))));
  // D-E は D だけが報告していた：10分たったので D の申告どおり（D の勝ち）に記録される。
  // D（ひみつ）は「ランキングに のる」がオフなので一覧には出ない（v2.2）。E（きいろ）だけが出る
  const dMe = (await api(B, `/me?userId=${P[3].id}&token=${P[3].token}`)).json?.me;
  const eRow = hidden.json.top.find((r) => r.key === key(P[4].id));
  check('片方だけの報告は、10分たつと まとめ処理で その人の申告どおりに記録（オフの人は一覧に出ない）', hidden.json.top.length === 1 && dMe?.wins === 1 && dMe?.rank === null && eRow?.losses === 1 && !hidden.json.top.some((r) => r.key === key(P[3].id)), JSON.stringify([hidden.json.top, dMe]));
  check('データは残る（レート・勝敗）', hidden.json.me?.rate === aRate && hidden.json.me?.wins === 1);
  await api(B, '/admin/seed', { method: 'POST', admin: ADMIN, origin: null, body: { results: [{ a: P[0].id, b: old, winner: P[0].id, at: later - 1000 }] } });
  await api(B, '/admin/run-batch', { method: 'POST', admin: ADMIN, origin: null, body: { now: later } });
  const back = await api(B, `/ranking?userId=${P[0].id}&token=${P[0].token}`);
  check('次に遊べば一覧に戻る', back.json.top.length === 3 && back.json.top.some((r) => r.key === key(P[0].id)) && back.json.me?.wins === 2, JSON.stringify(back.json.top));

  // まとめ処理が遅れている（最後の写しが前の 4:00 より古い）：時間を延ばさず「こうしん ちゅう」（v2.7。前は5分後に聞き直してもらっていた）
  await api(B, '/admin/run-batch', { method: 'POST', admin: ADMIN, origin: null, body: { now: Date.now() - 2 * 24 * 3600e3 } });
  const late = await api(B, '/ranking');
  check('① まとめ処理が遅れている時は、時間を延ばさず「こうしん ちゅう」（updating・予定の時刻のまま）。保存させない（no-store）', late.json.updating === true && late.json.nextAt <= Date.now() && late.json.nextAt > Date.now() - 12 * 3600e3 && Math.abs(late.json.serverNow - Date.now()) < 60e3 && late.headers.get('cache-control') === 'no-store', JSON.stringify({ nextAt: late.json.nextAt, updating: late.json.updating }));
  // ② 予定の更新（Cron。wrangler dev --test-scheduled の /__scheduled で手で動かす）：遅れていれば更新し、2回目は何もしない（結果が同じ）
  {
    const cron = async () => (await fetch(`${B}/__scheduled?cron=${encodeURIComponent('0 7 * * *')}`)).status;
    const s1 = await cron();
    await sleep(1500);
    const r1 = await api(B, '/ranking');
    const s2 = await cron();
    await sleep(1500);
    const r2 = await api(B, '/ranking');
    check('② 予定の更新（Cron）を手で動かすと更新され、遅れが消える', s1 === 200 && r1.json.updating === false && r1.json.updatedAt > late.json.updatedAt && r1.json.nextAt > Date.now(), JSON.stringify([s1, r1.json.updatedAt, r1.json.updating]));
    check('② もう一度 動かしても何もしない（一覧・更新の時刻が同じ）', s2 === 200 && r2.json.updatedAt === r1.json.updatedAt && JSON.stringify(r2.json.top) === JSON.stringify(r1.json.top), JSON.stringify([r1.json.updatedAt, r2.json.updatedAt]));
  }
  const ok2 = await api(B, '/admin/run-batch', { method: 'POST', admin: ADMIN, origin: null });
  const busy = await Promise.all([api(B, '/admin/run-batch', { method: 'POST', admin: ADMIN, origin: null }), api(B, '/admin/run-batch', { method: 'POST', admin: ADMIN, origin: null })]);
  check('まとめ処理は同時に1つだけ（重なったら busy）', ok2.json?.ok && busy.some((x) => x.json?.ok), JSON.stringify(busy.map((x) => x.json)));
  console.log('管理者メニュー（v2.0-J）');
  {
    const ip = (n) => ({ 'CF-Connecting-IP': `10.0.0.${n}` });
    const login = (pw, n) => api(B, '/admin-login', { method: 'POST', body: { password: pw }, headers: ip(n) });
    // パスワード（管理キー）でログイン → 管理の合言葉で管理の道が使える
    const ok = await login(ADMIN, 1);
    const session = ok.json?.session;
    check('J04 パスワード（管理キー）が合えば、管理の合言葉（12時間）がもらえる', ok.status === 200 && /^[0-9a-f]{64}$/.test(session ?? '') && ok.json.expires - Date.now() > 11 * 3600e3);
    const sess = (path, body = {}, n = 1) => api(B, path, { method: 'POST', body, headers: { ...ip(n), 'x-admin-session': session } });
    check('管理の合言葉で管理の道が使える。違う合言葉は 401', (await sess('/admin/log')).status === 200 && (await api(B, '/admin/log', { method: 'POST', headers: { ...ip(1), 'x-admin-session': 'ab'.repeat(32) } })).status === 401);
    // 5回まちがえたら1時間入れない（正しいパスワードでも）
    const fails = [];
    for (let i = 0; i < 5; i++) fails.push(await login('wrong-password', 2));
    check('J04 4回までは「あと○回」、5回目で入れなくなる（423）', fails.slice(0, 4).map((r) => r.json?.left).join(',') === '4,3,2,1' && fails[4].status === 423 && fails[4].json?.until > Date.now() + 59 * 60e3, JSON.stringify(fails.map((r) => [r.status, r.json])));
    check('入れない間は、正しいパスワードでも 423（ほかの接続元は入れる）', (await login(ADMIN, 2)).status === 423 && (await login(ADMIN, 3)).status === 200);
    check('管理キー（curl）のまちがいも数える', (await api(B, '/admin/stats', { method: 'POST', admin: 'nope', origin: null, headers: ip(2) })).status === 423);
    // 同時にまちがえても数えもらさない（1つの SQL で数える）
    const burst = await Promise.all(Array.from({ length: 8 }, () => login('wrong-password', 5)));
    check('同時に8回まちがえても、5回目からは入れない（数えもらさない）', burst.filter((r) => r.status === 401).length <= 4 && burst.some((r) => r.status === 423) && (await login(ADMIN, 5)).status === 423, JSON.stringify(burst.map((r) => r.status)));
    // IPv6 は /64 で数える（アドレスを変えながら試せない）
    for (let i = 0; i < 5; i++) await api(B, '/admin-login', { method: 'POST', body: { password: 'x' }, headers: { 'CF-Connecting-IP': `2001:db8:5:6::${i + 1}` } });
    check('IPv6 は /64 ごとに数える', (await api(B, '/admin-login', { method: 'POST', body: { password: ADMIN }, headers: { 'CF-Connecting-IP': '2001:db8:5:6:ffff::9' } })).status === 423);
    // 管理の合言葉で使えるのは管理者メニューの道だけ（前からある強い道は管理キーだけ）。
    // v2.7：管理画面の「ランキングを いま こうしん」・始まった件数のため、まとめ処理と数の確かめは合言葉でも使える
    check('管理の合言葉では、プレイヤーを消す などは使えない（401）。まとめ処理・数の確かめは使える（v2.7）', (await sess('/admin/delete-players', { userIds: [] })).status === 401 && (await sess('/admin/seed', {})).status === 401 && (await sess('/admin/run-batch')).status === 200 && (await sess('/admin/stats')).status === 200);
    // メニューから出たら、サーバーの合言葉も消える
    const tmp = (await login(ADMIN, 6)).json?.session;
    const asTmp = (path, body = {}) => api(B, path, { method: 'POST', body, headers: { ...ip(6), 'x-admin-session': tmp } });
    const before = (await asTmp('/admin/log')).status;
    await asTmp('/admin/logout', { session: tmp });
    check('でる（ログアウト）で合言葉がサーバーからも消える', before === 200 && (await asTmp('/admin/log')).status === 401);

    // トロフィー
    const T = await register(B, pid(500), 'もらう');
    const tr1 = await sess('/admin/trophy', { userId: T.id, number: 77 });
    check('J05 トロフィーを送れる（郵便受けに預ける）', tr1.status === 200);
    check('J05 同じ番号は 409（その ばんごうは もう つかわれているよ）', (await sess('/admin/trophy', { userId: P[0].id, number: 77 })).status === 409);
    check('番号の範囲外・登録の無いユーザーID は送れない', (await sess('/admin/trophy', { userId: T.id, number: 10000 })).status === 400 && (await sess('/admin/trophy', { userId: pid(999999), number: 78 })).status === 404);
    const mb = await api(B, `/mailbox?userId=${T.id}&token=${T.token}`);
    check('相手の郵便受けに届いている', mb.json?.trophies?.length === 1 && mb.json.trophies[0].number === 77, JSON.stringify(mb.json));
    check('郵便受けは token が要る', (await api(B, `/mailbox?userId=${T.id}&token=${'0'.repeat(32)}`)).status === 401);
    await api(B, '/mailbox/ack', { method: 'POST', body: { userId: T.id, token: T.token, numbers: [77] } });
    check('受け取ったら郵便受けから出る', (await api(B, `/mailbox?userId=${T.id}&token=${T.token}`)).json?.trophies?.length === 0);
    // K09：受付係は、配ったトロフィあげの数を相手に送る
    {
      await sess('/admin/trophy', { userId: T.id, number: 78 });
      const U = await register(B, pid(502), 'あいて');
      const ct = connectLobby(B, T);
      const cu = connectLobby(B, U);
      await Promise.all([ct.waitOpen(), cu.waitOpen()]);
      join(ct, T);
      await sleep(50);
      join(cu, U);
      await until(() => ct.paired() && cu.paired());
      check('K09 配ったトロフィあげの数が両者に届く', cu.paired()?.opponent.trophies === 2 && ct.paired()?.me.trophies === 2 && ct.paired()?.opponent.trophies === 0, JSON.stringify([ct.paired(), cu.paired()]));
    }
    const user = await sess('/admin/user', { userId: T.id });
    check('確認に出す相手の名前とレート', user.json?.user?.name === 'もらう' && user.json?.user?.rate === 100);

    // 停止
    const S = await register(B, pid(501), 'ていし');
    const s1 = await sess('/admin/suspend', { userId: S.id, days: 7, reason: 'テスト' });
    check('J06 停止できる（1週間）', s1.status === 200 && Math.abs(s1.json.until - (Date.now() + 7 * 864e5)) < 60e3);
    check('期間は決まったものだけ', (await sess('/admin/suspend', { userId: S.id, days: 8 })).status === 400);
    const st = await api(B, `/status?ids=${S.id},${T.id}`);
    check('J06 停止中か確かめられる（停止していない人は出ない）', st.json?.suspended?.[S.id] === s1.json.until && !(T.id in (st.json?.suspended ?? {})));
    const sl = connectLobby(B, S);
    await sleep(800);
    check('J06 停止中は待合所につながらない', !sl.opened);
    check('J06 停止中は結果の報告を受け付けない', (await api(B, '/result', { method: 'POST', body: { matchId: 'cd'.repeat(8), userId: S.id, token: S.token, winner: 'void' } })).status === 403);
    // 停止中の人の試合は数えない・ランキングに載らない
    await api(B, '/admin/seed', { method: 'POST', admin: ADMIN, origin: null, headers: ip(4), body: { results: [{ a: S.id, b: T.id, winner: S.id, at: Date.now() }] } });
    const bs = await api(B, '/admin/run-batch', { method: 'POST', admin: ADMIN, origin: null, headers: ip(4) });
    const rkS = await api(B, '/ranking');
    check('J06 停止中の人の試合は数えず、ランキングに載らない', bs.json?.counted === 0 && bs.json?.skipped >= 1 && !rkS.json.top.some((r) => r.key === key(S.id)), JSON.stringify(bs.json));
    // ランキングに載っている人を止めたら、まとめ処理を待たずに公開の一覧から消える（解除したら次の更新で戻る）
    const top0 = (await api(B, '/ranking')).json.top;
    const ranked = P.find((x) => top0.some((r) => r.key === key(x.id)));
    if (ranked) {
      await sess('/admin/suspend', { userId: ranked.id, days: 7, reason: '' });
      const rkNow = (await api(B, '/ranking')).json.top;
      check('J06 停止したら、すぐ公開のランキングから消える', !rkNow.some((r) => r.key === key(ranked.id)) && rkNow.length === top0.length - 1);
      await sess('/admin/unsuspend', { userId: ranked.id });
      await api(B, '/admin/run-batch', { method: 'POST', admin: ADMIN, origin: null, headers: ip(4) });
      check('停止解除の後、次の更新でランキングに戻る', (await api(B, '/ranking')).json.top.some((r) => r.key === key(ranked.id)));
      // K06：「ランキングに のる」をオフにすると、すぐ一覧から外れ、まとめ処理でも順位が付かない（レートは計算する）。オンに戻すと次の更新から載る
      const prof = (optIn) => api(B, '/profile', { method: 'POST', body: { userId: ranked.id, token: ranked.token, name: ranked.name, optIn } });
      await prof(false);
      const offNow = (await api(B, '/ranking')).json.top;
      await api(B, '/admin/run-batch', { method: 'POST', admin: ADMIN, origin: null, headers: ip(4) });
      const offMe = (await api(B, `/me?userId=${ranked.id}&token=${ranked.token}`)).json?.me;
      check('K06 オフにしたら、すぐ一覧から外れ、まとめ処理でも順位が付かない（レートは残る）', !offNow.some((r) => r.key === key(ranked.id)) && !(await api(B, '/ranking')).json.top.some((r) => r.key === key(ranked.id)) && offMe?.rank === null && offMe?.rate > 0, JSON.stringify(offMe));
      await prof(true);
      await api(B, '/admin/run-batch', { method: 'POST', admin: ADMIN, origin: null, headers: ip(4) });
      check('K06 オンに戻すと、次の更新で載る', (await api(B, '/ranking')).json.top.some((r) => r.key === key(ranked.id)));
    } else check('（ランキングに載っている人がいる）', false);
    const forever = await sess('/admin/suspend', { userId: T.id, days: 0, reason: '' });
    check('ずっと の停止（終わりは 0）', forever.json?.until === 0 && (await api(B, `/status?ids=${T.id}`)).json?.suspended?.[T.id] === 0);
    const un = await sess('/admin/unsuspend', { userId: S.id });
    check('J06 停止解除で戻る（待合所につながる）', un.status === 200 && !(S.id in ((await api(B, `/status?ids=${S.id}`)).json?.suspended ?? {})));
    const sl2 = connectLobby(B, S);
    await sl2.waitOpen();
    check('（停止解除の後は待合所につながる）', sl2.opened);
    sl2.ws.close();

    // 検索
    const find = (q) => sess('/admin/search', q).then((r) => r.json);
    const byName = await find({ name: 'ていし' });
    check('J07 名前の部分一致', byName.rows.length === 1 && byName.rows[0].id === S.id, JSON.stringify(byName));
    const byId = await find({ id: S.id.slice(3, 10) });
    check('J07 ユーザーID の部分一致', byId.rows.some((r) => r.id === S.id));
    check('J07 トロフィーの有無', (await find({ trophy: 'yes' })).rows.map((r) => r.id).join() === T.id && (await find({ trophy: 'no' })).rows.every((r) => r.id !== T.id));
    check('J07 停止中かどうか', (await find({ suspended: 'yes' })).rows.map((r) => r.id).join() === T.id && (await find({ suspended: 'no' })).rows.every((r) => r.id !== T.id));
    const rated = await find({ rateMin: 109, rateMax: 111 });
    check('J07 レートの範囲', rated.rows.length >= 1 && rated.rows.every((r) => r.rate >= 109 && r.rate <= 111));
    const seen = await find({ seenFrom: Date.now() - 3600e3 });
    check('J07 最後に遊んだ日の範囲（登録した日・郵便受けを見た日）', seen.rows.some((r) => r.id === T.id) && (await find({ seenTo: Date.now() - 864e5 })).rows.every((r) => r.id !== T.id));
    const many = [];
    for (let i = 0; i < 55; i++) many.push(register(B, pid(600 + i), `たくさん${i}`));
    await Promise.all(many);
    const p0 = await find({ name: 'たくさん' });
    const p1 = await find({ name: 'たくさん', page: 1 });
    check('J07 1ページ50件', p0.rows.length === 50 && p0.hasNext === true && p1.rows.length === 5 && p1.hasNext === false);
    check('今までの playerId のままの行は出さない', (await find({})).rows.every((r) => /^[1-9][0-9]{14}$/.test(r.id)));

    // かんりログ
    const log = await sess('/admin/log');
    const actions = log.json.rows.map((r) => r.action);
    check('かんりログ：新しい順に、いつ・何を・誰に', actions[0] === 'search' && ['login', 'trophy', 'suspend', 'unsuspend', 'lock'].every((a) => actions.includes(a)) && log.json.rows[0].id > log.json.rows[1].id, JSON.stringify(actions.slice(0, 12)));
    check('ログインの記録に接続元。検索のページ送りは記録しない', log.json.rows.find((r) => r.action === 'login')?.target?.startsWith('10.0.0.') && log.json.rows.filter((r) => r.action === 'search' && JSON.parse(r.detail).page === 1).length === 0);
    const tLog = log.json.rows.find((r) => r.action === 'trophy' && JSON.parse(r.detail).number === 77);
    check('トロフィーの記録に、相手と番号', tLog?.target === T.id && JSON.parse(tLog.detail).number === 77);
  }
} catch (e) {
  check('とちゅうでエラー', false, e?.stack ?? String(e));
} finally {
  w.stop();
}
const failed = results.filter((r) => !r.ok);
console.log(`\nWorker のテスト：${results.length - failed.length}/${results.length} 通過`);
process.exit(failed.length ? 1 : 0);
