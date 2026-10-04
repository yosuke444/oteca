import { describe, expect, it } from 'vitest';
import { canPair, cleanJoin, pickPairs, waitingCounts, type Waiter } from '../worker/src/logic/queue';
import { acceptReport, cleanReport, decide, MATCH_EXPIRE_MS, SINGLE_REPORT_MS, type MatchInfo, type Report } from '../worker/src/logic/results';
import { HIDE_AFTER_MS, isVisible, jstDay, lastBatchAt, nextBatchAt, pairKey, PAIR_DAILY_LIMIT, runBatch, type Player } from '../worker/src/logic/batch';
import { nextRate } from '../src/online/rateMath';
import { RATING } from '../src/config/rating';

/** 16桁の16進数の playerId を作る */
/** ユーザーID（15桁。v2.0-J） */
const pid = (n: number) => String(100000000000000 + n);
/** 試合ID（16桁の16進数） */
const mid = (n: number) => n.toString(16).padStart(16, '0');

function waiter(n: number, over: Partial<Waiter> = {}): Waiter {
  return { id: `w${n}`, playerId: pid(n), protocol: 6, lastOpponentId: '', name: '', rate: 100, joinedAt: n * 10, seq: n, ...over };
}

describe('I01 受付係の待ち行列', () => {
  it('待ち始めた順に2人ずつ組む（先に待っていた方が a）', () => {
    const ws = [waiter(3), waiter(1), waiter(4), waiter(2)];
    const pairs = pickPairs(ws).map((p) => [p.a.id, p.b.id]);
    expect(pairs).toEqual([
      ['w1', 'w2'],
      ['w3', 'w4'],
    ]);
  });

  it('同じ時刻なら seq の順', () => {
    const ws = [waiter(1, { joinedAt: 0, seq: 2 }), waiter(2, { joinedAt: 0, seq: 1 }), waiter(3, { joinedAt: 0, seq: 3 })];
    expect(pickPairs(ws).map((p) => [p.a.id, p.b.id])).toEqual([['w2', 'w1']]);
  });

  it('直前の相手とは組まない（どちらかが覚えていれば）。ほかの人と組む', () => {
    const a = waiter(1, { lastOpponentId: pid(2) });
    const b = waiter(2);
    const c = waiter(3);
    expect(canPair(a, b)).toBe(false);
    expect(canPair(b, a)).toBe(false);
    expect(pickPairs([a, b, c]).map((p) => [p.a.id, p.b.id])).toEqual([['w1', 'w3']]);
    // b だけが覚えている場合も同じ
    expect(canPair(waiter(1), waiter(2, { lastOpponentId: pid(1) }))).toBe(false);
  });

  it('待っているのが直前の相手だけなら、組まずに待つ', () => {
    expect(pickPairs([waiter(1, { lastOpponentId: pid(2) }), waiter(2, { lastOpponentId: pid(1) })])).toEqual([]);
  });

  it('同じ playerId（同じセーブの別のタブ）とは組まない', () => {
    expect(pickPairs([waiter(1), waiter(2, { playerId: pid(1) })])).toEqual([]);
  });

  it('プロトコル版数の違う人とは組まない。人数は版数ごとに数える', () => {
    const ws = [waiter(1, { protocol: 5 }), waiter(2, { protocol: 6 }), waiter(3, { protocol: 6 })];
    expect(pickPairs(ws).map((p) => [p.a.id, p.b.id])).toEqual([['w2', 'w3']]);
    expect(pickPairs([waiter(1, { protocol: 5 }), waiter(2, { protocol: 6 })])).toEqual([]);
    const counts = waitingCounts(ws);
    expect(counts.get(5)).toBe(1);
    expect(counts.get(6)).toBe(2);
  });

  it('やめた・切断した人（一覧から外れた人）は組まれない', () => {
    const ws = [waiter(1), waiter(2), waiter(3)];
    const left = ws.filter((w) => w.id !== 'w1');
    expect(pickPairs(left).map((p) => [p.a.id, p.b.id])).toEqual([['w2', 'w3']]);
  });

  it('200人：全員が1回ずつ、直前の相手と組まれない', () => {
    const ws: Waiter[] = [];
    for (let i = 1; i <= 200; i++) ws.push(waiter(i, { lastOpponentId: pid(i % 2 === 1 ? i + 1 : i - 1) }));
    const pairs = pickPairs(ws);
    expect(pairs.length).toBe(100);
    const seen = new Set<string>();
    for (const { a, b } of pairs) {
      expect(canPair(a, b)).toBe(true);
      expect(seen.has(a.id) || seen.has(b.id)).toBe(false);
      seen.add(a.id);
      seen.add(b.id);
    }
  });

  it('join の中身を確かめる', () => {
    expect(cleanJoin({ userId: pid(1), protocol: 6, lastOpponentId: pid(2), name: ' あいうえおかきくけこ ', rate: 123.6 })).toEqual({
      playerId: pid(1),
      protocol: 6,
      lastOpponentId: pid(2),
      name: 'あいうえおかきく',
      rate: 124,
    });
    expect(cleanJoin({ userId: 'xyz', protocol: 6 })).toBeNull();
    expect(cleanJoin({ userId: pid(1), protocol: 0 })).toBeNull();
    expect(cleanJoin({ userId: pid(1), protocol: 1.5 })).toBeNull();
    expect(cleanJoin(null)).toBeNull();
    expect(cleanJoin({ userId: pid(1), protocol: 6, lastOpponentId: 'bad' })?.lastOpponentId).toBe('');
  });
});

describe('I02 結果の突き合わせ', () => {
  const A = pid(1);
  const B = pid(2);
  const M = mid(100);
  const match: MatchInfo = { matchId: M, a: A, b: B, created: 1000 };
  const rep = (playerId: string, winner: string, at = 2000): Report => ({ matchId: M, playerId, winner, at });

  it('2人の報告が一致したら1行で記録する', () => {
    const d = decide(match, [rep(A, A, 2000), rep(B, A, 2500)], 3000);
    expect(d).toEqual({ kind: 'record', row: { matchId: M, a: A, b: B, winner: A, at: 2500 } });
  });

  it('食い違い・無効の一致は記録しない', () => {
    expect(decide(match, [rep(A, A), rep(B, B)], 3000)).toEqual({ kind: 'drop' });
    expect(decide(match, [rep(A, 'void'), rep(B, 'void')], 3000)).toEqual({ kind: 'drop' });
    expect(decide(match, [rep(A, 'void'), rep(B, A)], 3000)).toEqual({ kind: 'drop' });
  });

  it('片方だけの報告は、10分たったら申告どおりに記録する（無効なら記録しない）', () => {
    expect(decide(match, [rep(A, A, 2000)], 2000 + SINGLE_REPORT_MS - 1)).toEqual({ kind: 'wait' });
    expect(decide(match, [rep(A, A, 2000)], 2000 + SINGLE_REPORT_MS)).toEqual({
      kind: 'record',
      row: { matchId: M, a: A, b: B, winner: A, at: 2000 },
    });
    expect(decide(match, [rep(A, 'void', 2000)], 2000 + SINGLE_REPORT_MS)).toEqual({ kind: 'drop' });
  });

  it('報告の来ない試合は1日たったら捨てる', () => {
    expect(decide(match, [], 1000 + MATCH_EXPIRE_MS - 1)).toEqual({ kind: 'wait' });
    expect(decide(match, [], 1000 + MATCH_EXPIRE_MS)).toEqual({ kind: 'drop' });
  });

  it('受付係の知らない試合（予備の小部屋）は、2人そろった時だけ記録する', () => {
    expect(decide(null, [rep(B, B, 2000)], 2000 + SINGLE_REPORT_MS * 10)).toEqual({ kind: 'wait' });
    expect(decide(null, [rep(B, B, 2000)], 2000 + MATCH_EXPIRE_MS)).toEqual({ kind: 'drop' });
    const d = decide(null, [rep(B, B, 2000), rep(A, B, 2100)], 3000);
    expect(d).toEqual({ kind: 'record', row: { matchId: M, a: A, b: B, winner: B, at: 2100 } });
    // 勝った人が2人のどちらでもない
    const C = pid(3);
    expect(decide(null, [rep(A, C), rep(B, C)], 3000)).toEqual({ kind: 'drop' });
  });

  it('試合の2人でない人・2人でない勝者は受け付けない', () => {
    expect(acceptReport(match, rep(A, A))).toBe(true);
    expect(acceptReport(match, rep(B, 'void'))).toBe(true);
    expect(acceptReport(match, rep(pid(3), A))).toBe(false);
    expect(acceptReport(match, rep(A, pid(3)))).toBe(false);
    expect(acceptReport(null, rep(pid(3), pid(3)))).toBe(true);
    expect(acceptReport(null, rep(A, 'nope'))).toBe(false);
  });

  it('報告の中身を確かめる（時刻はサーバーの時刻）', () => {
    expect(cleanReport({ matchId: M, playerId: A, winner: A, at: 1 }, 5000)).toEqual({ matchId: M, playerId: A, winner: A, at: 5000 });
    expect(cleanReport({ matchId: M, playerId: A, winner: 'void' }, 5000)?.winner).toBe('void');
    expect(cleanReport({ matchId: 'x', playerId: A, winner: A }, 5000)).toBeNull();
    expect(cleanReport({ matchId: M, playerId: A, winner: 'b' }, 5000)).toBeNull();
  });
});

describe('I03 まとめ処理', () => {
  const A = pid(1);
  const B = pid(2);
  const C = pid(3);
  /** 2026-10-04 12:00 JST */
  const DAY = Date.UTC(2026, 9, 4, 3, 0, 0);
  const NOW = Date.UTC(2026, 9, 4, 19, 0, 0); // 10-05 4:00 JST
  let seq = 0;
  const res = (a: string, b: string, winner: string, at: number) => ({ id: ++seq, matchId: mid(1000 + seq), a, b, winner, at });

  it('次のまとめ処理は日本時間 4:00 と 14:00 の近い方', () => {
    // 2026-10-04 3:59 JST → 同じ日の 4:00
    expect(nextBatchAt(Date.UTC(2026, 9, 3, 18, 59))).toBe(Date.UTC(2026, 9, 3, 19, 0));
    // ちょうど 4:00 → 同じ日の 14:00（UTC 5:00）
    expect(nextBatchAt(Date.UTC(2026, 9, 3, 19, 0))).toBe(Date.UTC(2026, 9, 4, 5, 0));
    // 13:59 → 14:00、14:00 → 次の日の 4:00
    expect(nextBatchAt(Date.UTC(2026, 9, 4, 4, 59))).toBe(Date.UTC(2026, 9, 4, 5, 0));
    expect(nextBatchAt(Date.UTC(2026, 9, 4, 5, 0))).toBe(Date.UTC(2026, 9, 4, 19, 0));
    // 12:00 JST の前の更新は 4:00、20:00 JST の前は 14:00、3:00 JST の前は前の日の 14:00
    expect(lastBatchAt(Date.UTC(2026, 9, 4, 3, 0))).toBe(Date.UTC(2026, 9, 3, 19, 0));
    expect(lastBatchAt(Date.UTC(2026, 9, 4, 11, 0))).toBe(Date.UTC(2026, 9, 4, 5, 0));
    expect(lastBatchAt(Date.UTC(2026, 9, 4, 18, 0))).toBe(Date.UTC(2026, 9, 4, 5, 0));
    expect(jstDay(Date.UTC(2026, 9, 3, 15, 0))).toBe(20261004);
    expect(jstDay(Date.UTC(2026, 9, 3, 14, 59))).toBe(20261003);
  });

  it('時刻順に、試合の前のレートで2人とも計算する（並びが逆でも同じ）', () => {
    const r1 = res(A, B, A, DAY + 2000);
    const r2 = res(A, C, C, DAY + 1000);
    const players = new Map<string, Player>([[A, { id: A, rate: 150, wins: 0, losses: 0, best: 150, lastPlayed: 0 }]]);
    const out = runBatch(players, [r1, r2], NOW);
    // 先に r2（A が C に負け）、次に r1（A が B に勝ち）
    const a1 = nextRate(150, RATING.initial, false);
    const c1 = nextRate(RATING.initial, 150, true);
    const a2 = nextRate(a1, RATING.initial, true);
    const b2 = nextRate(RATING.initial, a1, false);
    const by = new Map(out.changed.map((p) => [p.id, p]));
    expect(by.get(A)).toMatchObject({ rate: a2, wins: 1, losses: 1, best: Math.max(150, a2), lastPlayed: NOW });
    expect(by.get(B)).toMatchObject({ rate: b2, wins: 0, losses: 1 });
    expect(by.get(C)).toMatchObject({ rate: c1, wins: 1, losses: 0, best: Math.max(RATING.initial, c1) });
    expect(out.counted).toBe(2);
    expect(runBatch(players, [r2, r1], NOW).changed).toEqual(out.changed);
    // 元のデータは書き換えない
    expect(players.get(A)!.rate).toBe(150);
  });

  it('同じ2人は日本時間の1日に3試合まで（日が変われば また数える）', () => {
    const rs = [];
    for (let i = 0; i < 5; i++) rs.push(res(i % 2 ? B : A, i % 2 ? A : B, A, DAY + i));
    rs.push(res(A, B, A, DAY + 24 * 60 * 60 * 1000)); // 次の日
    rs.push(res(A, C, A, DAY + 10)); // ほかの人とは別に数える
    const out = runBatch(new Map(), rs, NOW + 24 * 60 * 60 * 1000);
    expect(PAIR_DAILY_LIMIT).toBe(3);
    expect(out.counted).toBe(5);
    expect(out.skipped).toBe(2);
    const a = out.changed.find((p) => p.id === A)!;
    expect(a.wins).toBe(5);
  });

  it('7日以上遊んでいない人は表示から外す。次に遊べば戻る', () => {
    const old: Player = { id: A, rate: 300, wins: 3, losses: 0, best: 300, lastPlayed: NOW - HIDE_AFTER_MS };
    expect(isVisible(old, NOW)).toBe(false);
    expect(isVisible({ lastPlayed: NOW - HIDE_AFTER_MS + 1 }, NOW)).toBe(true);
    expect(isVisible({ lastPlayed: 0 }, NOW)).toBe(false);
    const out = runBatch(new Map([[A, old]]), [res(A, B, A, DAY)], NOW);
    const a = out.changed.find((p) => p.id === A)!;
    expect(a.wins).toBe(4);
    expect(isVisible(a, NOW)).toBe(true);
  });

  it('レートは0より下がらない', () => {
    const players = new Map<string, Player>([[A, { id: A, rate: 0, wins: 0, losses: 0, best: 100, lastPlayed: 0 }]]);
    const out = runBatch(players, [res(A, B, B, DAY)], NOW);
    expect(out.changed.find((p) => p.id === A)!.rate).toBe(0);
  });
});

describe('I03 まとめ処理が途中で止まっても、二重に数えない', () => {
  type Stmt = { q: string; binds: unknown[] };
  /** D1 の代わり：プレイヤー表の更新（JSON）と「どの まとめ処理まで書いたか」だけを覚える */
  function fakeDb() {
    const players = new Map<string, { wins: number; losses: number; rate?: number; best?: number }>();
    let batchMark = '';
    let failNext = false;
    const db = {
      read: 0,
      written: 0,
      failNext: () => void (failNext = true),
      players,
      async all<T>(q: string): Promise<T[]> {
        if (q.includes("key = 'batch'")) return (batchMark ? [{ value: batchMark }] : []) as T[];
        if (q.includes('FROM players WHERE id IN')) return [...players].map(([id, p]) => ({ id, rate: p.rate ?? 100, wins: p.wins, losses: p.losses, best: p.best ?? 100, last_played: 0 })) as T[];
        return [] as T[];
      },
      async run() {
        return { meta: { changes: 1 } };
      },
      async batch(stmts: Stmt[]) {
        if (failNext) {
          failNext = false;
          throw new Error('D1 が失敗した');
        }
        for (const s of stmts) {
          if (s.q.startsWith('INSERT INTO players'))
            for (const [id, rate, wins, losses, best] of JSON.parse(String(s.binds[1])) as [string, number, number, number, number][]) players.set(id, { wins, losses, rate, best });
          if (s.q.includes("VALUES ('batch'")) batchMark = String(s.binds[0]);
        }
      },
    };
    return db;
  }
  /** 受付係の代わり（結果と、途中の印） */
  function fakeLobby(results: ReturnType<typeof row>[]) {
    let rows = [...results];
    let pend: { id: string; matchIds: string[] } | null = null;
    let ackFails = false;
    return {
      get rows() {
        return rows;
      },
      ackFailsOnce: () => void (ackFails = true),
      exportResults: () => [...rows],
      ack: (ids: string[]) => {
        if (ackFails) {
          ackFails = false;
          throw new Error('受付係が止まった');
        }
        rows = rows.filter((r) => !ids.includes(r.matchId));
      },
      pending: () => pend,
      setPending: (p: { id: string; matchIds: string[] } | null) => void (pend = p),
      day: new Map<string, number>(),
      dayCounts(): Map<string, number> {
        return new Map(this.day);
      },
      saveDayCounts(changed: [string, number][]) {
        for (const [k, v] of changed) this.day.set(k, v);
      },
    };
  }
  const row = (n: number, a: string, b: string, winner: string) => ({ matchId: mid(5000 + n), a, b, winner, at: 1_800_000_000_000 + n, known: true });
  const A = pid(1);
  const B = pid(2);

  it('D1 に書く前に失敗したら、結果は受付係に残り、次の まとめ処理で1回だけ数える', async () => {
    const { runBatchJob } = await import('../worker/src/ranking');
    const db = fakeDb();
    const lobby = fakeLobby([row(1, A, B, A), row(2, A, B, B)]);
    db.failNext();
    await expect(runBatchJob(db as never, lobby, 1_800_000_100_000)).rejects.toThrow();
    expect(lobby.rows).toHaveLength(2);
    await runBatchJob(db as never, lobby, 1_800_000_200_000);
    expect(db.players.get(A)).toMatchObject({ wins: 1, losses: 1 });
    expect(lobby.rows).toHaveLength(0);
  });

  it('D1 に書いた後、結果を消す前に止まったら、次の まとめ処理はその分を消すだけ（数え直さない）', async () => {
    const { runBatchJob } = await import('../worker/src/ranking');
    const db = fakeDb();
    const lobby = fakeLobby([row(1, A, B, A)]);
    lobby.ackFailsOnce();
    await expect(runBatchJob(db as never, lobby, 1_800_000_100_000)).rejects.toThrow();
    expect(db.players.get(A)).toMatchObject({ wins: 1, losses: 0 });
    expect(lobby.rows).toHaveLength(1);
    // 次の まとめ処理：前の印が D1 にもあるので、その結果は消すだけ
    await runBatchJob(db as never, lobby, 1_800_000_200_000);
    expect(db.players.get(A)).toMatchObject({ wins: 1, losses: 0 });
    expect(lobby.rows).toHaveLength(0);
  });

  it('1日2回の まとめ処理：それぞれ前回より後の結果を時刻順に計算する（1回で全部計算した時と同じ）', async () => {
    const { runBatchJob } = await import('../worker/src/ranking');
    const C = pid(3);
    // 午前（4:00 の更新の後）の試合と、午後（14:00 の更新の後）の試合。順番でレートが変わる並び（A が B に勝つ → C が A に勝つ…）
    const am = [row(1, A, B, A), row(2, C, A, C), row(3, B, C, C)];
    const pm = [row(4, A, C, A), row(5, A, B, B), row(6, C, B, C)];
    const db = fakeDb();
    const lobby = fakeLobby(am);
    await runBatchJob(db as never, lobby, 1_800_000_100_000);
    const afterAm = new Map(db.players);
    expect(afterAm.get(A)).toMatchObject({ wins: 1, losses: 1 });
    for (const x of pm) (lobby.rows as unknown[]).push(x);
    await runBatchJob(db as never, lobby, 1_800_000_200_000);
    expect(lobby.rows).toHaveLength(0);
    // 1回でまとめて（時刻順に）計算した時と、レート・勝敗・最高レートまで同じ
    const one = runBatch(new Map(), [...pm, ...am], 0);
    for (const p of one.changed) expect(db.players.get(p.id)).toEqual({ wins: p.wins, losses: p.losses, rate: p.rate, best: p.best });
    // 順番を入れ替えて計算すると違う結果になる（順番を確かめられている）
    const swapped = runBatch(new Map(), [...pm, ...am].map((x, i) => ({ ...x, at: -i })), 0);
    expect(swapped.changed.map((p) => p.rate)).not.toEqual(one.changed.map((p) => p.rate));
  });

  it('同じ2人の「1日3試合」は、2回の まとめ処理をまたいでも数える（日本時間 0:00〜24:00）', async () => {
    const { runBatchJob } = await import('../worker/src/ranking');
    // 2026-10-04（日本時間）の 1:00・3:00（4:00 の更新で数える）と 10:00・12:00・13:00（14:00 の更新で数える）
    const at = (h: number) => Date.UTC(2026, 9, 3, 15 + h, 0);
    const mk = (n: number, h: number) => ({ matchId: mid(7000 + n), a: A, b: B, winner: A, at: at(h), known: true });
    const db = fakeDb();
    const lobby = fakeLobby([mk(1, 1), mk(2, 3)]);
    const r1 = await runBatchJob(db as never, lobby, at(4));
    expect(r1.counted).toBe(2);
    expect(lobby.day.get(pairKey(20261004, A, B))).toBe(2);
    for (const x of [mk(3, 10), mk(4, 12), mk(5, 13)]) (lobby.rows as unknown[]).push(x);
    const r2 = await runBatchJob(db as never, lobby, at(14));
    // 午前の2試合と合わせて3試合まで：午後は1試合だけ
    expect(r2.counted).toBe(1);
    expect(r2.skipped).toBe(2);
    expect(db.players.get(A)).toMatchObject({ wins: 3, losses: 0 });
    // 次の日（日本時間 0:00 を過ぎた試合）は また数える
    (lobby.rows as unknown[]).push(mk(6, 24 + 1));
    const r3 = await runBatchJob(db as never, lobby, at(24 + 4));
    expect(r3.counted).toBe(1);
  });

  it('D1 に書いた後に止まっても、その日に数えた数は次の まとめ処理で書かれる', async () => {
    const { runBatchJob } = await import('../worker/src/ranking');
    const db = fakeDb();
    const lobby = fakeLobby([row(1, A, B, A)]);
    lobby.ackFailsOnce();
    await expect(runBatchJob(db as never, lobby, 1_800_000_100_000)).rejects.toThrow();
    expect(lobby.day.size).toBe(0);
    await runBatchJob(db as never, lobby, 1_800_000_200_000);
    expect(lobby.day.get(pairKey(jstDay(1_800_000_000_001), A, B))).toBe(1);
  });

  it('予備の待合所の試合は、1人1日10試合まで（日の区切りは日本時間 0:00）', () => {
    const C = pid(3);
    const rs = [];
    for (let i = 0; i < 12; i++) rs.push({ id: i, matchId: mid(9000 + i), a: A, b: i % 2 ? B : C, winner: A, at: Date.UTC(2026, 9, 4, 3, 0) + i, known: false });
    const out = runBatch(new Map(), rs, Date.UTC(2026, 9, 4, 19, 0));
    expect(out.counted).toBe(6); // A-B 3試合・A-C 3試合（同じ2人は3試合まで）
    const many = [];
    for (let i = 0; i < 15; i++) many.push({ matchId: mid(9100 + i), a: A, b: pid(100 + i), winner: A, at: Date.UTC(2026, 9, 4, 3, 0) + i, known: false });
    expect(runBatch(new Map(), many, 0).counted).toBe(10);
    // 受付係が組んだ試合には この制限は無い
    expect(runBatch(new Map(), many.map((r) => ({ ...r, known: true })), 0).counted).toBe(15);
    // 日本時間 23:59 と 0:00 は別の日。4:00 では区切らない
    expect(jstDay(Date.UTC(2026, 9, 4, 14, 59))).not.toBe(jstDay(Date.UTC(2026, 9, 4, 15, 0)));
    expect(jstDay(Date.UTC(2026, 9, 4, 18, 59))).toBe(jstDay(Date.UTC(2026, 9, 4, 19, 0)));
  });
});
