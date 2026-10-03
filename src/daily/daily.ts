import raw from '../data/daily.json';
import { addCoins } from '../economy/rewards';
import { type Bag, type PullResult, type Rand, applyBags, drawBags, packById } from '../gacha/gacha';
import { DAILY_MISSION_IDS, type DailyMission, type DailyMissionId, type DailyState, type SaveData } from '../save/saveData';

/**
 * デイリーミッション（SPEC §7 S17・UPDATE_v2_1 §3）。時刻（ミリ秒）と乱数を受け取る純粋な処理だけ。
 * 数値（ミッションの数・目標・報酬・更新の時刻・デイリーパックの袋の数）は src/data/daily.json にだけ書く。
 */

export type MissionDef = { id: DailyMissionId; target: number; coins: number };
export type DailyData = {
  version: number;
  /** 毎日この時刻（端末の時計の「時」）に入れ替わる */
  resetHour: number;
  /** 7つから選ぶ数 */
  pick: number;
  missions: MissionDef[];
  /** 確定のミッション（ほかを ぜんぶ クリア）の報酬 */
  allClear: { packId: string; bags: number; coins: number };
};

/** 形が正しくなければエラー（知らない id・足りない id・おかしな数） */
export function parseDailyData(data: unknown): DailyData {
  const d = data as DailyData;
  const ok = (v: unknown) => Number.isInteger(v) && (v as number) > 0;
  const fail = (m: string): never => {
    throw new Error(`daily.json: ${m}`);
  };
  if (!d || !Array.isArray(d.missions)) fail('missions がありません');
  const ids = d.missions.map((m) => m.id);
  if (ids.length !== DAILY_MISSION_IDS.length || DAILY_MISSION_IDS.some((id) => !ids.includes(id))) fail(`missions は ${DAILY_MISSION_IDS.join('・')} の7つ`);
  for (const m of d.missions) if (!ok(m.target) || !ok(m.coins)) fail(`${m.id} の target・coins が不正です`);
  if (!Number.isInteger(d.resetHour) || d.resetHour < 0 || d.resetHour > 23) fail('resetHour が不正です');
  if (!ok(d.pick) || d.pick > d.missions.length) fail('pick が不正です');
  if (!d.allClear || !ok(d.allClear.bags) || !ok(d.allClear.coins) || typeof d.allClear.packId !== 'string') fail('allClear が不正です');
  return d;
}

export const DAILY: DailyData = parseDailyData(raw);

export function missionDef(id: DailyMissionId): MissionDef {
  return DAILY.missions.find((m) => m.id === id)!;
}

// ---------------------------------------------------------------- 時刻（12時区切り）

/** 日付 → 20261003 のような数 */
function keyOf(d: Date): number {
  return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
}

/** その時刻が属する「ミッションの日」（12時より前は前の日。端末の時計） */
export function cycleKeyAt(now: number): number {
  const d = new Date(now);
  if (d.getHours() < DAILY.resetHour) d.setDate(d.getDate() - 1);
  return keyOf(d);
}

/** 次に入れ替わる時刻（ミリ秒） */
export function nextResetAt(now: number): number {
  const d = new Date(now);
  const r = new Date(d.getFullYear(), d.getMonth(), d.getDate(), DAILY.resetHour, 0, 0, 0);
  if (r.getTime() <= now) r.setDate(r.getDate() + 1);
  return r.getTime();
}

/** YYYYMMDD の1日前（デバッグ「デイリーの じかんを すすめる」で、記録の方を1日ずらすのに使う） */
export function prevCycleKey(key: number): number {
  if (key <= 0) return 0;
  const d = new Date(Math.floor(key / 10000), (Math.floor(key / 100) % 100) - 1, key % 100);
  d.setDate(d.getDate() - 1);
  return keyOf(d);
}

// ---------------------------------------------------------------- ミッションを選ぶ

/** 文字列 → 32ビットの数（FNV-1a） */
function hash32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** 種付きの乱数（mulberry32） */
function seeded(seed: number): Rand {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * その日の3つを、7つからランダムに選ぶ。
 * 種は「その日」と「プレイヤーID」なので、同じ人は2つのタブで開いても同じ3つになる（人によっては違う3つ）
 */
export function pickMissions(cycleKey: number, playerId: string): DailyMissionId[] {
  const rand = seeded(hash32(`${playerId}:${cycleKey}`));
  const ids: DailyMissionId[] = [...DAILY_MISSION_IDS];
  for (let i = ids.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [ids[i], ids[j]] = [ids[j], ids[i]];
  }
  return ids.slice(0, DAILY.pick).sort((a, b) => DAILY_MISSION_IDS.indexOf(a) - DAILY_MISSION_IDS.indexOf(b));
}

// ---------------------------------------------------------------- 状態

/** そのミッションを達成したか */
export function isDone(m: DailyMission): boolean {
  return m.progress >= missionDef(m.id).target;
}

/** 確定のミッション（ほかを ぜんぶ クリア）を達成したか */
export function allClearDone(daily: DailyState): boolean {
  return daily.missions.length > 0 && daily.missions.every(isDone);
}

/** 受け取れる報酬の数（メニューのアイコンの赤い丸） */
export function claimableCount(daily: DailyState): number {
  return daily.missions.filter((m) => isDone(m) && !m.claimed).length + (allClearDone(daily) && !daily.allClearClaimed ? 1 : 0);
}

/** 自動で受け取った「きのうの ミッションの ほうしゅう」（メニューで知らせる） */
export type DailyCarry = { coins: number; cards: number[] };

/** デイリーパック（packs.json の daily） */
export function dailyPack() {
  const pack = packById(DAILY.allClear.packId);
  if (!pack) throw new Error(`デイリーパック ${DAILY.allClear.packId} が packs.json にありません`);
  return pack;
}

/** 確定のミッションの報酬のデイリーパックを引く（3袋。保存はしない） */
export function drawDailyBags(rand: Rand): Bag[] {
  return drawBags(dailyPack(), DAILY.allClear.bags, rand);
}

/** 確定のミッションの報酬：引いた袋のカードを所持数に足し、コインも足す（同じ下書き。SPEC §7 S17） */
function giveAllClear(draft: Pick<SaveData, 'coins' | 'collection'>, bags: Bag[]): { results: PullResult[]; coins: number } {
  const results = applyBags(draft, bags);
  return { results, coins: addCoins(draft, DAILY.allClear.coins) };
}

/**
 * 「その日」が変わっていたら、新しい3つに入れ替える（下書きを書き換える）。
 * 前の日に達成したのに受け取っていない報酬は、ここで自動で受け取る（SPEC §7 S17。子どもが損をしないように）。
 * その時のデイリーパックは「プレイヤーID と前の日」を種にして引く（同じ下書きに何度やっても同じ結果。
 * 画面では写しで先に計算して知らせを作り、保存は同じ計算で1回。開発時の StrictMode で2回呼ばれても同じ）。
 * @returns 自動で受け取ったもの（無ければ null）
 */
export function rollDaily(draft: Pick<SaveData, 'daily' | 'coins' | 'collection' | 'playerId'>, now: number): DailyCarry | null {
  const key = cycleKeyAt(now);
  if (draft.daily.cycleKey === key) return null;
  let carry: DailyCarry | null = null;
  const old = draft.daily;
  if (old.cycleKey !== 0) {
    let coins = 0;
    const cards: number[] = [];
    for (const m of old.missions) if (isDone(m) && !m.claimed) coins += addCoins(draft, missionDef(m.id).coins);
    if (allClearDone(old) && !old.allClearClaimed) {
      const got = giveAllClear(draft, drawDailyBags(seeded(hash32(`${draft.playerId}:${old.cycleKey}:carry`))));
      coins += got.coins;
      cards.push(...got.results.map((r) => r.no));
    }
    if (coins > 0 || cards.length > 0) carry = { coins, cards };
  }
  draft.daily = { cycleKey: key, missions: pickMissions(key, draft.playerId).map((id) => ({ id, progress: 0, claimed: false })), allClearClaimed: false };
  return carry;
}

/** 対戦・ガチャで数えたもの（SPEC §7 S17 の「数え方」） */
export type DailyProgress = {
  /** ドローした枚数（効果のドローも含む。最初の手札は数えない） */
  draws?: number;
  /** 使ったアイテムの数 */
  items?: number;
  /** 相手のおてあげを気絶させた数 */
  kos?: number;
  /** フレンド対戦を最後まで遊んだ */
  friend?: boolean;
  /** フレンド対戦かレート対戦で勝った */
  onlineWin?: boolean;
  /** ストーリーの対戦を最後まで遊んだ */
  story?: boolean;
  /** パックガチャを引いた */
  gacha?: boolean;
};

/** 数える対戦の種類 */
export type DailyMatchKind = 'cpu' | 'story' | 'friend' | 'rate';

/** 対戦の結果（リザルトに来たもの）から、デイリーミッションに数える種類を決める。数えない時は null */
export type DailyMatchInput = {
  mode: 'online' | 'cpu' | 'local';
  /** 勝敗を記録する対戦か（チュートリアル・カードを ためす・ストーリーは false） */
  record: boolean;
  debug?: boolean;
  /** レート対戦 */
  rated?: boolean;
  /** ストーリーの対戦 */
  story?: boolean;
  /** 終わり方（disconnect＝相手が切れた） */
  reason: string;
  /** フレンド対戦：2人の結果がそろったか（null＝まだ・分からない） */
  agree: boolean | null;
  /** レート対戦：2人の結果がそろってレートを計算した（無効・切断・相手が消えた は false） */
  rateDecided?: boolean;
  win: boolean;
  /** 両者の自分ターン数 */
  turnCounts: { p1: number; p2: number };
  /** 「最後まで遊んだ」と数えるのに要る、両者の自分ターン数（コインの報酬と同じ。economy.json の minTurnsEach） */
  minTurns: number;
};

/**
 * どの対戦を数えるか（SPEC §7 S17）。
 * - 切断・データのずれ（リザルトに来ない）・結果の食い違い・無効試合は数えない
 * - チュートリアル・デバッグ・カードを ためす・ひとりで両方 は数えない
 * - フレンド・レート・ストーリーの負けは、両者が minTurns ターン以上進んだ時だけ（すぐ降参しあって「あそぶ」「かつ」を取れないように。コインの報酬と同じ条件）
 */
export function dailyMatchKind(x: DailyMatchInput): DailyMatchKind | null {
  if (x.reason === 'disconnect') return null;
  const enough = x.turnCounts.p1 >= x.minTurns && x.turnCounts.p2 >= x.minTurns;
  if (x.story) return x.win || enough ? 'story' : null;
  if (!x.record || x.debug) return null;
  if (x.mode === 'cpu') return 'cpu';
  if (x.mode !== 'online') return null;
  if (x.rated) return x.rateDecided && enough ? 'rate' : null;
  return x.agree === true && enough ? 'friend' : null;
}

/** 1試合の進み具合（自分の分だけ）。mine は自分の集計（src/battle/stats.ts） */
export function matchProgress(kind: DailyMatchKind, win: boolean, mine: { draws?: number; items?: number; kos: number }): DailyProgress {
  return {
    draws: mine.draws ?? 0,
    items: mine.items ?? 0,
    kos: mine.kos,
    friend: kind === 'friend',
    onlineWin: (kind === 'friend' || kind === 'rate') && win,
    story: kind === 'story',
  };
}

/**
 * 進み具合を足す（下書きを書き換える）。その日が変わっていたら、先に入れ替える（前の日の報酬は自動で受け取る）。
 * 達成した後は、それ以上は数えない（目標の数で止める）。
 * @returns rollDaily で自動で受け取ったもの（無ければ null）
 */
export function addDailyProgress(draft: Pick<SaveData, 'daily' | 'coins' | 'collection' | 'playerId'>, now: number, p: DailyProgress): DailyCarry | null {
  const carry = rollDaily(draft, now);
  const add: Record<DailyMissionId, number> = {
    draw20: p.draws ?? 0,
    item10: p.items ?? 0,
    ko5: p.kos ?? 0,
    friend1: p.friend ? 1 : 0,
    onlineWin1: p.onlineWin ? 1 : 0,
    story1: p.story ? 1 : 0,
    gacha1: p.gacha ? 1 : 0,
  };
  for (const m of draft.daily.missions) {
    const n = Math.max(0, Math.floor(add[m.id]));
    if (n > 0) m.progress = Math.min(missionDef(m.id).target, m.progress + n);
  }
  return carry;
}

/**
 * ミッションの報酬を受け取る（コイン。同じ保存で「受け取った」の印）。
 * コインが上限（99,999）でも「受け取った」の印は付ける（増えるのは上限までの分）。
 * @returns 受け取れたら増えたコイン（0 のこともある）。達成していない・受け取り済み・その日が変わっていた時は null
 */
export function claimMission(draft: Pick<SaveData, 'daily' | 'coins'>, id: DailyMissionId, now: number): number | null {
  if (draft.daily.cycleKey !== cycleKeyAt(now)) return null;
  const m = draft.daily.missions.find((x) => x.id === id);
  if (!m || m.claimed || !isDone(m)) return null;
  m.claimed = true;
  return addCoins(draft, missionDef(id).coins);
}

/**
 * 確定のミッションの報酬を受け取る：デイリーパック3袋（bags。先に drawDailyBags で引いておく）の所持数と50コインを、1回の保存で。
 * @returns 結果（開封の演出に使う）。受け取れない時は null
 */
export function claimAllClear(draft: Pick<SaveData, 'daily' | 'coins' | 'collection'>, now: number, bags: Bag[]): { results: PullResult[]; coins: number } | null {
  if (draft.daily.cycleKey !== cycleKeyAt(now) || draft.daily.allClearClaimed || !allClearDone(draft.daily)) return null;
  draft.daily.allClearClaimed = true;
  return giveAllClear(draft, bags);
}

/** デバッグ「デイリーの じかんを すすめる」：記録の「その日」を1日前にずらす（次の12時を過ぎたのと同じ） */
export function debugNextDaily(draft: Pick<SaveData, 'daily'>): void {
  draft.daily.cycleKey = prevCycleKey(draft.daily.cycleKey);
}
