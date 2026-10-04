import { describe, expect, it } from 'vitest';
import raw from '../src/data/daily.json';
import { CARD_DB } from '../src/data/cards';
import { PACK_DATA, SHOP_PACKS } from '../src/data/packs';
import { StatsCollector } from '../src/battle/stats';
import {
  DAILY,
  addDailyProgress,
  allClearDone,
  claimAllClear,
  claimMission,
  claimableCount,
  cycleKeyAt,
  dailyMatchKind,
  dailyPack,
  debugNextDaily,
  drawDailyBags,
  isDone,
  matchProgress,
  missionDef,
  nextResetAt,
  parseDailyData,
  pickMissions,
  rollDaily,
} from '../src/daily/daily';
import { type Action, applyAction, createGame } from '../src/engine';
import { CARD_DB as DB, cardById } from '../src/data/cards';
import { ECONOMY } from '../src/economy/rewards';
import { DAILY_MISSION_IDS, type DailyMissionId, type SaveData, createDefaultSave } from '../src/save/saveData';
import { makeRandom } from './save.helpers';
import { deckOf, forceDice, startMain } from './helpers';

/** デイリーミッション（SPEC §7 S17・§16-2m。UPDATE_v2_1 §3） */

const at = (d: number, h: number, m = 0, s = 0) => new Date(2026, 9, d, h, m, s).getTime();
const rand = (seed: number) => makeRandom(seed).next;

/** その日のミッションを、指定の3つにしたセーブ */
function saveWith(ids: DailyMissionId[], now = at(3, 15)): SaveData {
  const s = createDefaultSave();
  s.playerId = '0123456789abcdef';
  rollDaily(s, now);
  s.daily.missions = ids.map((id) => ({ id, progress: 0, claimed: false }));
  return s;
}

describe('M01 12時に入れ替わる', () => {
  it('12時より前は前の日。11:59:59 と 12:00:00 で「その日」が変わる。次の入れ替わりの時刻', () => {
    expect(cycleKeyAt(at(3, 11, 59, 59))).toBe(20261002);
    expect(cycleKeyAt(at(3, 12, 0, 0))).toBe(20261003);
    expect(cycleKeyAt(at(3, 0, 0, 0))).toBe(20261002);
    expect(cycleKeyAt(new Date(2026, 0, 1, 9).getTime())).toBe(20251231); // 年またぎ
    expect(nextResetAt(at(3, 11, 59, 59))).toBe(at(3, 12));
    expect(nextResetAt(at(3, 12, 0, 0))).toBe(at(4, 12));
    expect(nextResetAt(at(3, 23))).toBe(at(4, 12));
    expect(DAILY.resetHour).toBe(12);
  });

  it('7つから3つ。同じ人・同じ日は同じ3つ。日や人が変われば変わることがある。7つとも選ばれることがある', () => {
    const a = pickMissions(20261003, 'aaaaaaaaaaaaaaaa');
    expect(a).toHaveLength(3);
    expect(new Set(a).size).toBe(3);
    expect(pickMissions(20261003, 'aaaaaaaaaaaaaaaa')).toEqual(a);
    const seen = new Set<string>();
    const sets = new Set<string>();
    for (let k = 0; k < 60; k++) {
      const p = pickMissions(20261001 + k, k % 2 ? 'aaaaaaaaaaaaaaaa' : 'bbbbbbbbbbbbbbbb');
      for (const id of p) seen.add(id);
      sets.add(p.join(','));
      for (const id of p) expect(DAILY_MISSION_IDS).toContain(id);
    }
    expect(seen.size).toBe(7);
    expect(sets.size).toBeGreaterThan(10);
  });

  it('入れ替わり：12時をまたぐと新しい3つ（進み具合は0）。同じ日の中では入れ替わらない', () => {
    const s = createDefaultSave();
    s.playerId = '0123456789abcdef';
    expect(rollDaily(s, at(3, 12, 30))).toBeNull(); // 初めて（前の日の分は無い）
    expect(s.daily.cycleKey).toBe(20261003);
    expect(s.daily.missions).toHaveLength(3);
    s.daily.missions[0].progress = 1;
    const before = structuredClone(s.daily);
    expect(rollDaily(s, at(4, 11, 59))).toBeNull();
    expect(s.daily).toEqual(before);
    rollDaily(s, at(4, 12, 0));
    expect(s.daily.cycleKey).toBe(20261004);
    expect(s.daily.missions.every((m) => m.progress === 0 && !m.claimed)).toBe(true);
    expect(s.daily.allClearClaimed).toBe(false);
  });

  it('デバッグ「デイリーの じかんを すすめる」：その日を1日前にずらすと、次に開いた時に入れ替わる', () => {
    const s = saveWith(['draw20', 'ko5', 'gacha1'], at(3, 13));
    debugNextDaily(s);
    expect(s.daily.cycleKey).toBe(20261002);
    rollDaily(s, at(3, 13));
    expect(s.daily.cycleKey).toBe(20261003);
    expect(s.daily.missions.map((m) => m.progress)).toEqual([0, 0, 0]);
  });
});

describe('M02 7つのミッション：数え方・達成・受け取り（30コイン）', () => {
  const cases: [DailyMissionId, Parameters<typeof addDailyProgress>[2], number][] = [
    ['draw20', { draws: 7 }, 3],
    ['item10', { items: 4 }, 3],
    ['ko5', { kos: 2 }, 3],
    ['friend1', { friend: true }, 1],
    ['onlineWin1', { onlineWin: true }, 1],
    ['story1', { story: true }, 1],
    ['gacha1', { gacha: true }, 1],
  ];
  for (const [id, step, times] of cases) {
    it(`${id}：達成までは受け取れず、達成したら30コインを1回だけ`, () => {
      const other = DAILY_MISSION_IDS.filter((x) => x !== id).slice(0, 2);
      const s = saveWith([id, ...other]);
      const now = at(3, 18);
      for (let i = 0; i < times; i++) {
        expect(claimMission(s, id, now)).toBeNull();
        addDailyProgress(s, now, step);
      }
      const m = s.daily.missions.find((x) => x.id === id)!;
      expect(isDone(m)).toBe(true);
      // 目標で止まる
      expect(m.progress).toBe(missionDef(id).target);
      expect(claimableCount(s.daily)).toBe(1);
      const coins = s.coins;
      expect(claimMission(s, id, now)).toBe(30);
      expect(s.coins).toBe(coins + 30);
      expect(m.claimed).toBe(true);
      expect(claimMission(s, id, now)).toBeNull();
      expect(s.coins).toBe(coins + 30);
      expect(claimableCount(s.daily)).toBe(0);
      // ほかのミッションは進んでいない（関係ない数え方は足さない）
      for (const o of s.daily.missions.filter((x) => x.id !== id)) expect(o.progress).toBe(0);
    });
  }

  it('その日が過ぎた後の「うけとる」は受け取れない（入れ替わりで自動で受け取る）', () => {
    const s = saveWith(['gacha1', 'ko5', 'story1']);
    addDailyProgress(s, at(3, 18), { gacha: true });
    expect(claimMission(s, 'gacha1', at(4, 12, 1))).toBeNull();
  });

  it('コインが上限（99,999）でも「受け取った」の印は付く（ずっと残らない）', () => {
    const s = saveWith(['gacha1', 'ko5', 'story1']);
    s.coins = ECONOMY.coinsMax;
    addDailyProgress(s, at(3, 18), { gacha: true });
    expect(claimMission(s, 'gacha1', at(3, 18))).toBe(0);
    expect(s.daily.missions[s.daily.missions.findIndex((m) => m.id === 'gacha1')].claimed).toBe(true);
    expect(claimableCount(s.daily)).toBe(0);
    expect(s.coins).toBe(ECONOMY.coinsMax);
  });

  it('数値は daily.json の値（目標・報酬30・選ぶ数3・12時・デイリーパック3袋＋50コイン）。形のおかしい daily.json はエラー', () => {
    expect(DAILY.missions.map((m) => [m.id, m.target, m.coins])).toEqual([
      ['draw20', 20, 30],
      ['item10', 10, 30],
      ['ko5', 5, 30],
      ['friend1', 1, 30],
      ['onlineWin1', 1, 30],
      ['story1', 1, 30],
      ['gacha1', 1, 30],
    ]);
    expect(DAILY.pick).toBe(3);
    expect(DAILY.allClear).toEqual({ packId: 'daily', bags: 3, coins: 50 });
    expect(() => parseDailyData({ ...raw, missions: raw.missions.slice(1) })).toThrow('7つ');
    expect(() => parseDailyData({ ...raw, resetHour: 24 })).toThrow('resetHour');
    expect(() => parseDailyData({ ...raw, missions: raw.missions.map((m, i) => (i ? m : { ...m, target: 0 })) })).toThrow('draw20');
  });
});

describe('M03 確定のミッション（ほかを ぜんぶ クリア）', () => {
  it('3つを達成すると、デイリーパック3袋の所持数と50コインが1回の保存で入る。1回だけ', () => {
    const s = saveWith(['friend1', 'story1', 'gacha1']);
    const now = at(3, 20);
    const bags = drawDailyBags(rand(5));
    expect(claimAllClear(s, now, bags)).toBeNull(); // まだ
    addDailyProgress(s, now, { friend: true, story: true });
    expect(allClearDone(s.daily)).toBe(false);
    addDailyProgress(s, now, { gacha: true });
    expect(allClearDone(s.daily)).toBe(true);
    // 3つの報酬を受け取らなくても、確定のミッションは受け取れる（数は 3＋1）
    expect(claimableCount(s.daily)).toBe(4);
    const coins = s.coins;
    const before = { ...s.collection };
    const res = claimAllClear(s, now, bags)!;
    expect(bags).toHaveLength(3);
    expect(res.coins).toBe(50);
    expect(s.coins).toBe(coins + 50);
    const pulled = bags.map((b) => b.card);
    expect(res.results).toHaveLength(pulled.length);
    const added = new Map<number, number>();
    for (const c of pulled) added.set(c.no, (added.get(c.no) ?? 0) + 1);
    for (const [no, n] of added) expect(s.collection[no]).toBe((before[no] ?? 0) + n);
    expect(s.daily.allClearClaimed).toBe(true);
    expect(claimAllClear(s, now, bags)).toBeNull();
    expect(s.coins).toBe(coins + 50);
    expect(claimableCount(s.daily)).toBe(3);
  });

  it('デイリーパックは売らない（パックガチャに並ばない）。中身は3つのパックのノーマル36種類で、スーパーおてあげは無い', () => {
    const p = dailyPack();
    expect(p.id).toBe('daily');
    expect(p.purchasable).toBe(false);
    expect(SHOP_PACKS.map((x) => x.id)).not.toContain('daily');
    expect(p.super).toEqual([]);
    expect(new Set(p.normal).size).toBe(36);
    const union = new Set(PACK_DATA.packs.filter((x) => x.id !== 'daily').flatMap((x) => x.normal));
    expect(new Set(p.normal)).toEqual(union);
    for (const id of p.normal) {
      const def = Object.values(CARD_DB).find((c) => c.id === id)!;
      expect(def.kind === 'otege' && def.rarity === 'super').toBe(false);
    }
  });
});

describe('M04 受け取り忘れは、次の入れ替わりで自動で受け取る', () => {
  it('達成して受け取っていないミッションのコインと、確定のミッション（デイリーパック＋50コイン）。同じ下書きに何度やっても同じ結果', () => {
    const s = saveWith(['ko5', 'story1', 'gacha1'], at(3, 13));
    addDailyProgress(s, at(3, 14), { kos: 5, story: true, gacha: true });
    claimMission(s, 'ko5', at(3, 14)); // 1つは受け取った
    const coins = s.coins;
    const total = Object.values(s.collection).reduce((a, b) => a + b, 0);
    const copy = structuredClone(s);
    const carry = rollDaily(s, at(4, 12, 5))!;
    expect(carry.coins).toBe(30 + 30 + 50);
    expect(carry.cards.length).toBeGreaterThanOrEqual(3);
    expect(s.coins).toBe(coins + 110);
    expect(Object.values(s.collection).reduce((a, b) => a + b, 0)).toBe(total + carry.cards.length);
    expect(s.daily.cycleKey).toBe(20261004);
    // 写しで計算しても同じ（画面は写しで知らせを作り、保存は同じ計算で1回）
    expect(rollDaily(copy, at(4, 12, 5))).toEqual(carry);
    expect(copy).toEqual(s);
    // もう一度は何も起きない
    expect(rollDaily(s, at(4, 13))).toBeNull();
  });

  it('何も達成していなければ知らせは無い。確定のミッションを受け取っていれば、もう一度は受け取らない', () => {
    const s = saveWith(['ko5', 'story1', 'gacha1']);
    expect(rollDaily(s, at(4, 12, 5))).toBeNull();
    const t = saveWith(['ko5', 'story1', 'gacha1']);
    addDailyProgress(t, at(3, 16), { kos: 9, story: true, gacha: true });
    for (const id of ['ko5', 'story1', 'gacha1'] as const) claimMission(t, id, at(3, 16));
    claimAllClear(t, at(3, 16), drawDailyBags(rand(1)));
    const coins = t.coins;
    expect(rollDaily(t, at(4, 12, 5))).toBeNull();
    expect(t.coins).toBe(coins);
  });

  it('進み具合を足す時にその日が変わっていたら、先に入れ替えてから新しい日に数える', () => {
    const s = saveWith(['gacha1', 'ko5', 'story1'], at(3, 13));
    addDailyProgress(s, at(3, 14), { gacha: true });
    const carry = addDailyProgress(s, at(4, 13), { draws: 3, items: 2, kos: 1, story: true, gacha: true });
    expect(carry?.coins).toBe(30); // 前の日の gacha1
    expect(s.daily.cycleKey).toBe(20261004);
    const m = Object.fromEntries(s.daily.missions.map((x) => [x.id, x.progress]));
    for (const [id, n] of Object.entries(m)) {
      const want = { draw20: 3, item10: 2, ko5: 1, friend1: 0, onlineWin1: 0, story1: 1, gacha1: 1 }[id as DailyMissionId];
      expect(n, id).toBe(want);
    }
  });
});

describe('M06 対戦の数え方', () => {
  const base = { mode: 'cpu' as const, record: true, reason: 'ko', agree: null, win: true, turnCounts: { p1: 3, p2: 3 }, minTurns: ECONOMY.minTurnsEach };
  it('数える対戦：CPU・ストーリー（勝ち・負け）・フレンド（結果がそろった）・レート（レートを計算した）', () => {
    expect(dailyMatchKind(base)).toBe('cpu');
    expect(dailyMatchKind({ ...base, win: false })).toBe('cpu');
    expect(dailyMatchKind({ ...base, record: false, story: true })).toBe('story');
    expect(dailyMatchKind({ ...base, record: false, story: true, win: false })).toBe('story');
    expect(dailyMatchKind({ ...base, mode: 'online', agree: true })).toBe('friend');
    expect(dailyMatchKind({ ...base, mode: 'online', agree: true, win: false, reason: 'surrender' })).toBe('friend');
    expect(dailyMatchKind({ ...base, mode: 'online', rated: true, rateDecided: true })).toBe('rate');
  });

  it('数えない：チュートリアル・カードを ためす（記録しない）・デバッグ・ひとりで両方・切断・食い違い・無効・まだそろっていない', () => {
    expect(dailyMatchKind({ ...base, record: false })).toBeNull(); // チュートリアル・カードを ためす
    expect(dailyMatchKind({ ...base, debug: true })).toBeNull();
    expect(dailyMatchKind({ ...base, mode: 'local' })).toBeNull();
    expect(dailyMatchKind({ ...base, reason: 'disconnect' })).toBeNull();
    expect(dailyMatchKind({ ...base, mode: 'online', agree: true, reason: 'disconnect' })).toBeNull();
    expect(dailyMatchKind({ ...base, mode: 'online', agree: false })).toBeNull(); // 結果の食い違い
    expect(dailyMatchKind({ ...base, mode: 'online', agree: null })).toBeNull();
    expect(dailyMatchKind({ ...base, mode: 'online', rated: true, rateDecided: false })).toBeNull(); // 無効・相手が消えた
    expect(dailyMatchKind({ ...base, mode: 'online', rated: true, rateDecided: true, reason: 'disconnect' })).toBeNull(); // 切断で勝ち
    expect(dailyMatchKind({ ...base, record: false, story: true, reason: 'disconnect' })).toBeNull();
  });

  it('すぐ終わった試合（どちらかが2ターン未満）：フレンド・レート・ストーリーの負けは数えない（すぐ降参しあって取れないように）', () => {
    const short = { ...base, turnCounts: { p1: 2, p2: 1 } };
    expect(dailyMatchKind({ ...short, mode: 'online', agree: true, reason: 'surrender' })).toBeNull();
    expect(dailyMatchKind({ ...short, mode: 'online', rated: true, rateDecided: true })).toBeNull();
    expect(dailyMatchKind({ ...short, record: false, story: true, win: false, reason: 'surrender' })).toBeNull();
    // ストーリーの勝ち・CPU は数える（勝つには相手を倒すしかない・CPU は報酬も勝った時だけ）
    expect(dailyMatchKind({ ...short, record: false, story: true, win: true })).toBe('story');
    expect(dailyMatchKind({ ...short })).toBe('cpu');
  });

  it('効果のドロー（技の「ひく」）も数える', () => {
    const no = (id: string) => cardById(id)!.no;
    const side = (id: string) => ({ active: no(id), bench: [], hand: [], deck: Array.from({ length: 8 }, () => no('kusuri')) });
    let s = createGame({
      seed: 'm06',
      decks: { p1: [], p2: [] },
      cardDb: DB,
      sandbox: { p1: side('kawaiage'), p2: side('mutsuashi') },
      rules: { p1: { firstPlayerFirstTurnNoAttack: false }, p2: { firstPlayerFirstTurnNoAttack: false } },
      forcedDice: [1],
    }).state;
    const stats = new StatsCollector();
    const deck0 = s.players.p1.deck.length;
    const r = applyAction(s, { type: 'END_TURN', player: 'p1' } as Action);
    expect(r.rejected).toBeUndefined();
    stats.add(r.events, r.state);
    s = r.state;
    // かわいあげ の 1・2 の目は「1まい ひく」
    expect(s.players.p1.deck.length).toBe(deck0 - 1);
    expect(stats.result(s).sides.p1.draws).toBe(1);
  });

  it('1試合の進み具合：自分のドロー・アイテム・倒した数。フレンドは「あそぶ」、フレンドとレートの勝ちは「かつ」、ストーリーは「あそぶ」', () => {
    const mine = { draws: 4, items: 3, kos: 2 };
    expect(matchProgress('cpu', true, mine)).toEqual({ draws: 4, items: 3, kos: 2, friend: false, onlineWin: false, story: false });
    expect(matchProgress('friend', false, mine)).toMatchObject({ friend: true, onlineWin: false });
    expect(matchProgress('friend', true, mine)).toMatchObject({ friend: true, onlineWin: true });
    expect(matchProgress('rate', true, mine)).toMatchObject({ friend: false, onlineWin: true });
    expect(matchProgress('rate', false, mine)).toMatchObject({ onlineWin: false });
    expect(matchProgress('story', false, mine)).toMatchObject({ story: true, onlineWin: false });
    expect(matchProgress('cpu', true, { kos: 1 })).toMatchObject({ draws: 0, items: 0 });
  });

  it('集計：ドロー（ターンの始めのドロー）とアイテムを、それぞれの側で数える。最初の手札は数えない', () => {
    let s = startMain({ decks: { p1: deckOf([['mutsuashi', 15]]), p2: deckOf([['mutsuashi', 15]]) } });
    const handStart = { p1: s.players.p1.hand.length, p2: s.players.p2.hand.length };
    const deckStart = { p1: s.players.p1.deck.length, p2: s.players.p2.deck.length };
    const stats = new StatsCollector();
    for (let i = 0; i < 14; i++) {
      const r = applyAction(forceDice(s, 1), { type: 'END_TURN', player: s.currentPlayer } as Action);
      expect(r.rejected).toBeUndefined();
      stats.add(r.events, r.state);
      s = r.state;
    }
    const res = stats.result(s);
    for (const side of ['p1', 'p2'] as const) {
      // 山札が減った分＝ドローした枚数（最初の手札は山札から配った後なので入らない）
      expect(res.sides[side].draws).toBe(deckStart[side] - s.players[side].deck.length);
      expect(s.players[side].hand.length).toBe(handStart[side] + (res.sides[side].draws ?? 0));
    }
    expect((res.sides.p1.draws ?? 0) + (res.sides.p2.draws ?? 0)).toBeGreaterThan(0);
    // アイテムは ItemUsed の数
    const t = new StatsCollector();
    t.add(
      [
        { type: 'ItemUsed', player: 'p1', itemUid: 'a', targetUid: null },
        { type: 'ItemUsed', player: 'p1', itemUid: 'b', targetUid: null },
        { type: 'ItemUsed', player: 'p2', itemUid: 'c', targetUid: null },
        { type: 'Drew', player: 'p2', uid: 'd' },
      ],
      s,
    );
    const r2 = t.result(s);
    expect([r2.sides.p1.items, r2.sides.p2.items, r2.sides.p1.draws, r2.sides.p2.draws]).toEqual([2, 1, 0, 1]);
  });
});
