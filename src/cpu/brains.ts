import { decideCpuAction } from './normal';
import { applyAction, getLegalActions } from '../engine';
import type { Action, GameState, ItemCardDef, Side } from '../engine/types';
import { koChance, expectedDamage, otegeValue, threat } from './estimate';
import { determinize } from './observe';
import { type Rand, pick } from './random';

/**
 * CPU の考え方（SPEC §13-5）。どれも「見えない情報を仮に決め直した状態」（observe.ts の determinize）だけを見る。
 * 状態はルールエンジンの getLegalActions・applyAction でしか動かさない（ルールを別に書かない）。
 */

export type CpuLevel = 'weak' | 'normal' | 'strong' | 'strongest';
export const CPU_LEVELS: readonly CpuLevel[] = ['weak', 'normal', 'strong', 'strongest'];
export const CPU_LEVEL_LABEL: Record<CpuLevel, string> = { weak: 'よわい', normal: 'ふつう', strong: 'つよい', strongest: 'さいきょう' };

type Of<T extends Action['type']> = Extract<Action, { type: T }>;
const only = <T extends Action['type']>(legal: Action[], type: T) => legal.filter((a): a is Of<T> => a.type === type);
const best = <A>(list: A[], score: (a: A) => number): A => list.reduce((a, b) => (score(b) > score(a) ? b : a));

function itemDef(s: GameState, uid: string): ItemCardDef | null {
  const d = s.cardDefs[s.cards[uid].no];
  return d.kind === 'item' ? d : null;
}
const healOf = (d: ItemCardDef) => d.effects.reduce((t, e) => t + (e.type === 'heal' ? e.amount : 0), 0);
const addOf = (d: ItemCardDef) => d.effects.reduce((t, e) => t + (e.type === 'addAttack' ? e.amount : 0), 0);
const setHpOf = (d: ItemCardDef) => d.effects.find((e) => e.type === 'setHp') as { value: number } | undefined;

/**
 * 交代は1ターンに何回でもできるので、考え方によっては「交代 → 交代し直す」をくり返して終わらない。
 * 1回交代したターンは、もう交代しない（交代したターンは攻撃できないので、2回目の交代で得することはほぼ無い）。
 * また、前の自分のターンに交代していたら、このターンは交代しない（noSwap）。お互いに毎ターン交代して
 * どちらも攻撃しないまま終わらない、ということが CPU 同士で起きたため
 */
function noRepeatSwap(s: GameState, side: Side, legal: Action[], noSwap = false): Action[] {
  return noSwap || s.players[side].swappedThisTurn ? legal.filter((a) => a.type !== 'SWAP') : legal;
}

// ---------------------------------------------------------------- よわい

/** よわい：ほぼでたらめ。ただし出せるおてあげはベンチに出す */
export function weakAction(s: GameState, side: Side, rand: Rand, noSwap = false): Action | null {
  const legal = noRepeatSwap(s, side, getLegalActions(s, side), noSwap);
  if (legal.length === 0) return null;
  const bench = only(legal, 'PLACE_BENCH');
  if (bench.length > 0) return pick(rand, bench);
  return pick(rand, legal);
}

// ---------------------------------------------------------------- ふつう

/** ふつう：デバッグ用の「かんたんCPU」と同じ */
export function normalAction(s: GameState, side: Side): Action | null {
  return decideCpuAction(s, side);
}

// ---------------------------------------------------------------- つよい

/** つよい：サイコロの確率から期待ダメージを計算して判断する */
export function strongAction(s: GameState, side: Side, noSwap = false): Action | null {
  const legal = getLegalActions(s, side);
  if (legal.length === 0) return null;
  const opp: Side = side === 'p1' ? 'p2' : 'p1';
  const ps = s.players[side];
  const oppActive = s.players[opp].active;

  // 準備：価値（HP と攻撃力）が一番高いおてあげ
  const setup = only(legal, 'SETUP_ACTIVE');
  if (setup.length > 0) return best(setup, (a) => otegeValue(s, a.uid));

  // くりだし：倒されにくく、相手を倒しやすいおてあげ
  const promote = only(legal, 'PROMOTE');
  if (promote.length > 0) {
    return best(promote, (a) => {
      const safe = 1 - threat(s, side, a.benchUid);
      const ko = oppActive ? koChance(s, a.benchUid, s.cards[oppActive].hp) : 0;
      return safe * 100 + ko * 80 + otegeValue(s, a.benchUid) * 0.05;
    });
  }

  // 1. ベンチを空にしない：出せるなら価値の高いおてあげを出す
  const bench = only(legal, 'PLACE_BENCH');
  if (bench.length > 0) return best(bench, (a) => otegeValue(s, a.uid));

  const me = ps.active;
  if (!me) return legal.find((a) => a.type === 'END_TURN') ?? legal[0];
  const items = only(legal, 'USE_ITEM');
  const winOnKo = s.players[side].koCount + 1 >= s.rules[side].koToWin || (oppActive !== null && s.players[opp].bench.length === 0);
  const oppHp = oppActive ? s.cards[oppActive].hp : Infinity;
  const danger = threat(s, side, me, 10);
  const attackNow = koChance(s, me, oppHp);

  // 2. 回復：無駄にしない（回復量の2/3以上が効く時だけ）。倒されそうなバトル場を優先
  const heals = items.filter((a) => {
    const d = itemDef(s, a.uid);
    if (!d || healOf(d) === 0 || setHpOf(d)) return false;
    const c = s.cards[a.targetUid];
    return c.maxHp - c.hp >= healOf(d) * (2 / 3);
  });
  if (heals.length > 0) {
    return best(heals, (a) => {
      const c = s.cards[a.targetUid];
      const amount = Math.min(healOf(itemDef(s, a.uid)!), c.maxHp - c.hp);
      const saves = a.targetUid === me ? Math.max(0, danger - threat({ ...s, cards: { ...s.cards, [me]: { ...c, hp: c.hp + amount } } }, side, me, 10)) : 0;
      return saves * 200 + amount + (a.targetUid === me ? 10 : 0);
    });
  }

  // 3. 倒されそうな時は交代して守る（このターンに倒せる見込みが薄い時だけ。交代するとこのターンは攻撃できない）
  if (!ps.swappedThisTurn && !noSwap && danger >= 0.5 && attackNow < 0.34) {
    const swaps = only(legal, 'SWAP').filter((a) => threat(s, side, a.benchUid, 10) <= danger - 0.34);
    if (swaps.length > 0) return best(swaps, (a) => (1 - threat(s, side, a.benchUid, 10)) * 100 + otegeValue(s, a.benchUid) * 0.1);
  }

  if (!ps.swappedThisTurn && oppActive) {
    // 4. ダメージを足すアイテム（バトル場にだけ）
    const powers = items.filter((a) => a.targetUid === me && (itemDef(s, a.uid) ? addOf(itemDef(s, a.uid)!) > 0 : false));
    let bestPower: { a: Of<'USE_ITEM'>; gain: number } | null = null;
    for (const a of powers) {
      const d = itemDef(s, a.uid)!;
      const add = addOf(d);
      const after = koChance(s, me, oppHp, add);
      const gain = after - attackNow;
      const hpTo = setHpOf(d);
      if (hpTo) {
        // HPが下がるアイテム（ドリンク）：攻撃力が低いおてあげで、倒せる見込みが大きく上がる時だけ
        const weakHitter = expectedDamage(s, me) <= 40;
        const cheap = s.cards[me].hp <= Math.max(hpTo.value, 30) || danger >= 0.67;
        const ok = (winOnKo && gain >= 0.3) || (gain >= 0.5 && (weakHitter || cheap)) || (gain >= 0.3 && cheap);
        if (!ok) continue;
      } else if (!(gain >= 0.2 || (winOnKo && gain >= 0.1))) continue;
      if (!bestPower || gain > bestPower.gain) bestPower = { a, gain };
    }
    if (bestPower) return bestPower.a;
  }

  // 5. ターンおわり（攻撃）
  return legal.find((a) => a.type === 'END_TURN') ?? legal[0];
}

// ---------------------------------------------------------------- さいきょう

/**
 * さいきょうの考える量：試算は最大1000回、ただし最大1.4秒で打ち切る（1回の判断は1.5秒以内。SPEC §13-5）。
 * 回数で決めるので、速い端末でも遅い端末でも強さがそろいやすい（遅い端末は時間で打ち切り）
 */
export const STRONGEST_SEARCH: SearchOptions = { maxRollouts: 1000, timeMs: 1400 };

export type SearchOptions = {
  /** 考える時間の上限（ms） */
  timeMs?: number;
  /** 試算の回数の上限（テストで速く・同じ結果にしたい時） */
  maxRollouts?: number;
  /** 時計（Web Worker・Node どちらでも動くように外から渡す） */
  now?: () => number;
  /** 前の自分のターンに交代した（このターンは交代しない） */
  noSwap?: boolean;
};

/** 同じ結果になる手をまとめる（同じ種類のカードを手札に2枚持っている時など） */
function dedupe(s: GameState, legal: Action[]): Action[] {
  const seen = new Map<string, Action>();
  for (const a of legal) {
    const no = (uid: string) => s.cards[uid].no;
    const key =
      a.type === 'USE_ITEM' ? `I${no(a.uid)}>${a.targetUid}` : a.type === 'PLACE_BENCH' || a.type === 'SETUP_ACTIVE' ? `${a.type[0]}${no(a.uid)}` : JSON.stringify(a);
    if (!seen.has(key)) seen.set(key, a);
  }
  return [...seen.values()];
}

/** 両者が「つよい」の考え方で、決着まで打ち合う。side が勝てば 1、負ければ 0 */
export function rollout(state: GameState, side: Side, maxSteps = 400): number {
  let s = state;
  for (let step = 0; step < maxSteps && s.phase !== 'over'; step++) {
    const actors: Side[] =
      s.phase === 'setup'
        ? (['p1', 'p2'] as Side[]).filter((p) => s.players[p].setupChoice === null)
        : s.phase === 'promote'
          ? [...s.pendingPromote]
          : [s.currentPlayer];
    const who = actors[0];
    if (!who) break;
    const a = strongAction(s, who);
    if (!a) break;
    const r = applyAction(s, a);
    if (r.rejected) break;
    s = r.state;
  }
  if (s.phase === 'over') return s.winner === side ? 1 : 0;
  // 決着しなかった：倒した数とHPで おおまかに
  const opp: Side = side === 'p1' ? 'p2' : 'p1';
  const hp = (p: Side) => [s.players[p].active, ...s.players[p].bench].reduce((t, u) => t + (u ? s.cards[u].hp : 0), 0);
  return 0.5 + 0.15 * (s.players[side].koCount - s.players[opp].koCount) + 0.001 * (hp(side) - hp(opp));
}

/**
 * さいきょう：手ごとに、見えない情報を仮に決め直した状態で決着まで打ち合う試算をくり返し（モンテカルロ）、
 * 勝ちの割合が一番高い手を選ぶ。どの手を多く試すかは UCB1 で決める（よさそうな手を重点的に）。
 */
export function strongestAction(s: GameState, side: Side, rand: Rand, opts: SearchOptions = {}): Action | null {
  const legal = dedupe(s, noRepeatSwap(s, side, getLegalActions(s, side), opts.noSwap));
  if (legal.length <= 1) return legal[0] ?? null;
  const now = opts.now ?? (() => Date.now());
  const until = now() + (opts.timeMs ?? 1200);
  const maxRollouts = opts.maxRollouts ?? Infinity;
  const n = legal.map(() => 0);
  const w = legal.map(() => 0);
  let total = 0;
  while (total < maxRollouts && (total < legal.length || now() < until)) {
    // UCB1：まだ試していない手 → 平均が高く、試した回数が少ない手
    let i = n.findIndex((x) => x === 0);
    if (i < 0) {
      let bestScore = -Infinity;
      for (let k = 0; k < legal.length; k++) {
        const score = w[k] / n[k] + 0.6 * Math.sqrt(Math.log(total) / n[k]);
        if (score > bestScore) {
          bestScore = score;
          i = k;
        }
      }
    }
    const world = determinize(s, side, rand);
    const r = applyAction(world, legal[i]);
    const v = r.rejected ? 0 : rollout(r.state, side);
    n[i] += 1;
    w[i] += v;
    total += 1;
  }
  // 一番よく試した手（＝一番よさそうな手）
  let pickI = 0;
  for (let k = 1; k < legal.length; k++) if (n[k] > n[pickI] || (n[k] === n[pickI] && w[k] > w[pickI])) pickI = k;
  return legal[pickI];
}

// ---------------------------------------------------------------- 入口

/**
 * 強さごとの考え方。state は元の状態でよい（ここで見えない情報を仮に決め直してから考える）。
 * 返す操作は元の状態でもそのまま使える（自分の手札・場は決め直していないため）
 */
export function decide(level: CpuLevel, state: GameState, side: Side, rand: Rand, opts: SearchOptions = {}): Action | null {
  if (state.phase === 'over') return null;
  const view = determinize(state, side, rand);
  switch (level) {
    case 'weak':
      return weakAction(view, side, rand, opts.noSwap);
    case 'normal':
      return normalAction(view, side);
    case 'strong':
      return strongAction(view, side, opts.noSwap);
    case 'strongest':
      return strongestAction(view, side, rand, opts);
  }
}
