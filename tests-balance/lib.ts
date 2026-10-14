import { mkdirSync, writeFileSync } from 'node:fs';
import { seededRand } from '../src/cpu/random';
import { selfPlay } from '../src/cpu/selfPlay';
import { CARD_DB, CARD_LIST } from '../src/data/cards';
import { PACK_DATA } from '../src/data/packs';
import { applyAction, createGame } from '../src/engine';
import type { CardDef, Effect, GameState, OtegeCardDef, Side } from '../src/engine/types';

/**
 * カードのバランスのデータ集め（v2.7。企画者の指示）。カードの数値は変えない。
 * 1. 計算で出す強さ（効果のデータから）
 * 2. 1対1の総当たり（おてあげ1体どうし・アイテムなし・ベンチなし）
 * 3. デッキに入れた時の効き目（基準のデッキの1枚を入れかえて、基準のデッキと対戦。CPU は両方「つよい」）
 * 結果は docs/balance/raw/*.json に書き、scripts/balance.mjs が CSV と表（markdown）にまとめる。
 * どれも決まった種で行うので、同じコマンドで何回でも同じ結果になる（npm run balance）
 */

export const RAW_DIR = 'docs/balance/raw';

/** 調べるおてあげ（トロフィあげは おてあげ と同じなので外す。ストーリー限定は入れる） */
export const OTEGE: OtegeCardDef[] = CARD_LIST.filter((c): c is OtegeCardDef => c.kind === 'otege' && c.trophy === undefined);
export const ITEMS = CARD_LIST.filter((c) => c.kind === 'item');

export function writeRaw(name: string, data: unknown): void {
  mkdirSync(RAW_DIR, { recursive: true });
  writeFileSync(`${RAW_DIR}/${name}.json`, JSON.stringify(data, null, 1));
}

// ---------------------------------------------------------------- 1. 計算で出す強さ

const avg = (xs: number[]) => xs.reduce((t, x) => t + x, 0) / xs.length;
const sum = (xs: number[] | undefined) => (xs ?? []).reduce((t, x) => t + x, 0);

/** 目 1〜6 ごとの技の効果 */
function movesByFace(def: OtegeCardDef): Effect[][] {
  return [1, 2, 3, 4, 5, 6].map((f) => def.moves.find((m) => m.faces.includes(f))?.effects ?? []);
}

export type Calc = {
  no: number;
  id: string;
  name: string;
  rarity: string;
  hp: number;
  /** サイコロ1回あたりの平均：今すぐの相手へのダメージ・あとからの相手へのダメージ・回復（今すぐ＋あとから）・自分へのダメージ（今すぐ＋あとから）・ドロー（今すぐ＋あとから）・ばくだん（時限のきぜつ）の出る確率 */
  dmgNow: number;
  dmgLater: number;
  dmgTotal: number;
  heal: number;
  self: number;
  draw: number;
  bomb: number;
  /** HP × 平均ダメージ（あとからも入れる。基準のデッキの並べ方に使う） */
  hpTimesDmg: number;
  /** HP × 平均ダメージ（1回のダメージは100まで。HP100の相手より多い分は数えない。999 の「きぜつさせる」技がふくらまないように。順位はこちらで決める） */
  hpTimesDmgCap: number;
  /** HP100 の相手を倒すまでの平均の攻撃回数（あとからのダメージも、来る回に数える。ばくだんは来た時に倒す） */
  turnsToKo100: number;
};

export function calc(def: OtegeCardDef): Calc {
  const faces = movesByFace(def);
  const per = (f: (e: Effect) => number) => avg(faces.map((es) => es.reduce((t, e) => t + f(e), 0)));
  const dmgNow = per((e) => (e.type === 'damage' ? e.amount : 0));
  const dmgLater = per((e) => (e.type === 'damage' ? sum(e.then) : 0));
  const heal = per((e) => (e.type === 'heal' ? Math.min(e.amount, def.hp) + sum(e.then) : 0));
  const self = per((e) => (e.type === 'selfDamage' ? Math.min(e.amount, def.hp) + sum(e.then) : 0));
  const draw = per((e) => (e.type === 'draw' ? e.count + sum(e.then) : 0));
  const bomb = per((e) => (e.type === 'faintLater' ? 1 : 0));
  return {
    no: def.no,
    id: def.id,
    name: def.name,
    rarity: def.rarity,
    hp: def.hp,
    dmgNow,
    dmgLater,
    dmgTotal: dmgNow + dmgLater,
    heal,
    self,
    draw,
    bomb,
    hpTimesDmg: def.hp * (dmgNow + dmgLater),
    hpTimesDmgCap: def.hp * per((e) => (e.type === 'damage' ? Math.min(e.amount, 100) + (e.then ?? []).reduce((t, a) => t + Math.min(a, 100), 0) : 0)),
    turnsToKo100: turnsToKo(def, 100, 20000),
  };
}

/** HP の相手を倒すまでの攻撃回数の平均（決まった種で trials 回。上限50回） */
function turnsToKo(def: OtegeCardDef, hp: number, trials: number): number {
  const faces = movesByFace(def);
  const rand = seededRand(def.no * 7919);
  let total = 0;
  for (let t = 0; t < trials; t++) {
    const incoming = new Map<number, number>();
    let left = hp;
    let n = 0;
    let bombAt = Infinity;
    while (left > 0 && n < 50) {
      n += 1;
      const es = faces[Math.floor(rand() * 6)];
      for (const e of es) {
        if (e.type === 'damage') {
          left -= e.amount;
          (e.then ?? []).forEach((a, i) => incoming.set(n + i + 1, (incoming.get(n + i + 1) ?? 0) + a));
        }
        if (e.type === 'faintLater') bombAt = Math.min(bombAt, n + e.after);
      }
      // 前に付けた持続ダメージ・ばくだんが、この回に来る
      left -= incoming.get(n) ?? 0;
      if (n >= bombAt) left = 0;
    }
    total += n;
  }
  return total / trials;
}

// ---------------------------------------------------------------- 2. 1対1

/**
 * おてあげ1体どうし（アイテム・ベンチ・山札なし）の1試合。a が先攻（p1）。
 * どちらも出来ることは「ターンおわり（攻撃）」だけなので、CPU は使わない。200手で決着しなければ引き分け
 * @returns a の勝ち 1・負け 0・引き分け 0.5
 */
export function duel(a: number, b: number, seed: string): number {
  let s: GameState = createGame({
    seed,
    decks: { p1: [], p2: [] },
    cardDb: CARD_DB,
    sandbox: { p1: { active: a, bench: [], hand: [], deck: [] }, p2: { active: b, bench: [], hand: [], deck: [] } },
  }).state;
  for (let i = 0; i < 200 && s.phase !== 'over'; i++) {
    const player = s.phase === 'choose' && s.pendingChoice ? s.pendingChoice.player : s.currentPlayer;
    const r =
      s.phase === 'choose' && s.pendingChoice
        ? applyAction(s, { type: 'CHOOSE', player, uids: s.pendingChoice.options.slice(0, s.pendingChoice.count) })
        : applyAction(s, { type: 'END_TURN', player });
    if (r.rejected) break;
    s = r.state;
  }
  if (s.phase !== 'over' || !s.winner) return 0.5;
  return s.winner === 'p1' ? 1 : 0;
}

/** a と b の勝率（a から見て）。games 試合のうち半分は a が先攻、半分は b が先攻 */
export function duelRate(a: number, b: number, games: number): { rate: number; draws: number } {
  let score = 0;
  let draws = 0;
  for (let k = 0; k < games; k++) {
    const aFirst = k % 2 === 0;
    const r = aFirst ? duel(a, b, `duel-${a}-${b}-${k}`) : 1 - duel(b, a, `duel-${a}-${b}-${k}`);
    if (r === 0.5) draws += 1;
    score += r;
  }
  return { rate: score / games, draws };
}

// ---------------------------------------------------------------- 3. デッキに入れた時の効き目

/** 基本のおてあげ（元祖パックの通常おてあげ） */
export const BASIC: OtegeCardDef[] = PACK_DATA.packs
  .find((p) => p.id === 'ganso')!
  .normal.map((id) => CARD_LIST.find((c) => c.id === id)!)
  .filter((c): c is OtegeCardDef => c.kind === 'otege');

/**
 * 基準のデッキ3つ：基本のおてあげを「HP × 平均ダメージ」の順に並べ、真ん中あたりの5種類を3枚ずつ（15枚）。
 * A は真ん中、B は1つ強い方へ、C は1つ弱い方へずらす。入れかえる1枚は、そのデッキの真ん中の強さの おてあげ の1枚
 */
export function baseDecks(): { name: string; cards: number[]; swapOut: number }[] {
  const sorted = [...BASIC].sort((x, y) => calc(x).hpTimesDmg - calc(y).hpTimesDmg || x.no - y.no);
  const mid = Math.floor((sorted.length - 5) / 2);
  const make = (name: string, from: number) => {
    const five = sorted.slice(from, from + 5);
    return { name, cards: five.flatMap((c) => [c.no, c.no, c.no]), swapOut: five[2].no };
  };
  return [make('A', mid), make('B', Math.min(sorted.length - 5, mid + 1)), make('C', Math.max(0, mid - 1))];
}

/** 基準のデッキの1枚（swapOut の1枚）を card に入れかえる */
export function swapped(deck: { cards: number[]; swapOut: number }, card: number): number[] {
  const out = [...deck.cards];
  out.splice(out.indexOf(deck.swapOut), 1, card);
  return out;
}

export type SwapStat = {
  games: number;
  /** 入れかえたデッキの勝ち（引き分けは 0.5） */
  score: number;
  /** 調べたカードが、試合の終わりに 手札にあった・使った（捨て札）・山札に残った・場にいた の回数（アイテム・おてあげ） */
  inHand: number;
  used: number;
  inDeck: number;
  onField: number;
  /** 入れかえた側の、1試合あたりの アイテムを使った回数・交代した回数・手数 */
  items: number;
  swaps: number;
  steps: number;
};

/** 入れかえたデッキ（test）と基準のデッキ（base）を games 試合。半分ずつ先攻を入れかえる。CPU は両方 level */
export function swapMatch(base: { name: string; cards: number[]; swapOut: number }, card: number | null, games: number, level: 'strong' | 'strongest' = 'strong'): SwapStat {
  const test = card === null ? base.cards : swapped(base, card);
  const st: SwapStat = { games: 0, score: 0, inHand: 0, used: 0, inDeck: 0, onField: 0, items: 0, swaps: 0, steps: 0 };
  for (let k = 0; k < games; k++) {
    const first: Side = k % 2 === 0 ? 'p1' : 'p2';
    const seedNo = (card ?? 0) * 100003 + base.name.charCodeAt(0) * 1009 + k;
    const r = selfPlay({ levels: { p1: level, p2: level }, decks: { p1: test, p2: base.cards }, cardDb: CARD_DB, seed: `swap-${base.name}-${card}-${k}`, first, rand: seededRand(seedNo) });
    st.games += 1;
    st.steps += r.steps;
    st.score += r.winner === 'p1' ? 1 : r.winner === null ? 0.5 : 0;
    for (const a of r.actions) {
      if (a.player !== 'p1') continue;
      if (a.type === 'USE_ITEM') st.items += 1;
      if (a.type === 'SWAP') st.swaps += 1;
    }
    if (card !== null) {
      const ps = r.state.players.p1;
      for (const [uid, c] of Object.entries(r.state.cards)) {
        if (c.owner !== 'p1' || c.no !== card) continue;
        if (ps.hand.includes(uid)) st.inHand += 1;
        else if (ps.deck.includes(uid)) st.inDeck += 1;
        else if (ps.discard.includes(uid)) st.used += 1;
        else st.onField += 1;
      }
    }
  }
  return st;
}

export function cardName(no: number): string {
  return (CARD_DB[no] as CardDef | undefined)?.name ?? String(no);
}
