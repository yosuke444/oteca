import { expect } from 'vitest';
import { CARD_DB, cardById } from '../src/data/cards';
import { buildDeck, starterDeckNos } from '../src/data/starterDeck';
import {
  type Action,
  type CardDb,
  type GameEvent,
  type GameState,
  type RuleSet,
  type Side,
  applyAction,
  createGame,
} from '../src/engine';

/** テスト用のデッキ：id と枚数 → カードNo の配列 */
export const deckOf = buildDeck;

export function noOf(id: string): number {
  const def = cardById(id);
  if (!def) throw new Error(`unknown card ${id}`);
  return def.no;
}

export type StartOptions = {
  seed?: string;
  decks?: Partial<Record<Side, number[]>>;
  cardDb?: CardDb;
  rules?: Partial<Record<Side, Partial<RuleSet>>>;
};

/**
 * 準備を済ませて、p1 先攻の1ターン目（メイン）の状態を作る。
 * 両者とも手札の最初のおてあげをバトル場に出す。
 */
export function startMain(opts: StartOptions = {}): GameState {
  const cardDb = opts.cardDb ?? CARD_DB;
  let { state } = createGame({
    seed: opts.seed ?? 'test-seed',
    decks: { p1: opts.decks?.p1 ?? starterDeckNos(), p2: opts.decks?.p2 ?? starterDeckNos() },
    cardDb,
    rules: opts.rules,
    forcedDice: [6, 1], // 先攻は p1
  });
  for (const side of ['p1', 'p2'] as const) {
    const uid = state.players[side].hand.find((u) => cardDb[state.cards[u].no].kind === 'otege')!;
    state = ok(state, { type: 'SETUP_ACTIVE', player: side, uid }).state;
  }
  expect(state.phase).toBe('main');
  expect(state.currentPlayer).toBe('p1');
  return state;
}

/** 操作が通ることを確かめて進める */
export function ok(state: GameState, action: Action): { state: GameState; events: GameEvent[] } {
  const r = applyAction(state, action);
  expect(r.rejected, `${action.type} が弾かれた: ${r.rejected}`).toBeUndefined();
  return r;
}

/** 次に出るサイコロの目を決める */
export function forceDice(state: GameState, ...values: number[]): GameState {
  const s = structuredClone(state);
  s.forcedDice.push(...values);
  return s;
}

export type Layout = {
  /** バトル場のカード id */
  active?: string;
  /** ベンチのカード id */
  bench?: string[];
  /** 手札のカード id */
  hand?: string[];
};

/**
 * テスト用に、そのプレイヤーのカードを並べ直す。
 * 指定したカードをデッキ内から探して置き、残りは山札へ（HPは満タン・効果なしに戻す）。
 */
export function arrange(state: GameState, side: Side, layout: Layout): GameState {
  const s = structuredClone(state);
  const ps = s.players[side];
  const all = Object.values(s.cards).filter((c) => c.owner === side);
  const used = new Set<string>();
  const take = (id: string): string => {
    const no = noOf(id);
    const c = all.find((x) => x.no === no && !used.has(x.uid));
    if (!c) throw new Error(`${side} のデッキに ${id} が足りません`);
    used.add(c.uid);
    return c.uid;
  };
  ps.active = layout.active ? take(layout.active) : null;
  ps.bench = (layout.bench ?? []).map(take);
  ps.hand = (layout.hand ?? []).map(take);
  ps.discard = [];
  ps.deck = all.map((c) => c.uid).filter((u) => !used.has(u));
  for (const c of all) {
    c.hp = c.maxHp;
    c.attackAdd = 0;
    c.attackOverride = null;
    c.itemsThisTurn = [];
  }
  return s;
}

/** カードの状態を書き換える（HPなど） */
export function patchCard(state: GameState, uid: string, patch: Partial<GameState['cards'][string]>): GameState {
  const s = structuredClone(state);
  Object.assign(s.cards[uid], patch);
  return s;
}

export function eventsOf<T extends GameEvent['type']>(events: GameEvent[], type: T): Extract<GameEvent, { type: T }>[] {
  return events.filter((e): e is Extract<GameEvent, { type: T }> => e.type === type);
}
