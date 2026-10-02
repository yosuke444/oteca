import { type Ctx, SIDES, rollDie } from './core';
import { DEFAULT_RULES } from './rules';
import { seedRng, shuffleInPlace } from './rng';
import type { CardDb, CardInstance, GameEvent, GameState, PlayerState, RuleSet, Side } from './types';

/** 試合を始めるのに必要なもの */
export type GameConfig = {
  /** 共通の乱数の種（オンラインではコミット・リビールで決めた値。SPEC §11-4） */
  seed: string;
  /** 両者のデッキ（カードNoの配列） */
  decks: Record<Side, number[]>;
  /** カード定義 */
  cardDb: CardDb;
  /** プレイヤー別に変えたいルールだけ書く（省略時は既定の RuleSet） */
  rules?: Partial<Record<Side, Partial<RuleSet>>>;
  /** デバッグ・テスト用：乱数の代わりに出すサイコロの目 */
  forcedDice?: number[];
  /** デバッグ用：配ったあと、山札の上に置くカード（カードNo、上から順）。山札に無いものは無視 */
  stackTop?: Partial<Record<Side, number[]>>;
  /** デバッグ用：サイコロの目を固定（1〜6）。先攻決めには使わない */
  fixedDie?: number | null;
  /**
   * デバッグ用「カードを ためす」（SPEC §7 S99・v2.0）：カードを置いた所から、p1 のメインで始める（準備を飛ばす）。
   * decks は使わず、ここに書いたカードでデッキを作る（バトル場 → ベンチ → 手札 → 山札 の順。山札は書いた順のまま）
   */
  sandbox?: Record<Side, SandboxSide>;
  /**
   * チュートリアルの台本（UPDATE_v2 §6T-5）：最初に山札を切らず、decks に書いた順のまま配る（先頭から手札、残りが山札の上から）。
   * 引き直しが起きた時だけは、ふつうどおり種付き乱数で切る
   */
  noShuffle?: boolean;
};

/** カードを ためす：1人ぶんの置き方（カードNo） */
export type SandboxSide = { active: number; bench: number[]; hand: number[]; deck: number[] };

/**
 * 試合の準備（SPEC §4-3）
 * 1. 先攻決め（同じ目なら振り直し） 2. 山札を切って配る 3. おてあげチェック（引き直し）
 * このあと両者の SETUP_ACTIVE でバトル場を決めると、先攻の1ターン目が始まる。
 */
export function createGame(config: GameConfig): { state: GameState; events: GameEvent[] } {
  const cardDefs: CardDb = {};
  const cards: Record<string, CardInstance> = {};
  const players = {} as Record<Side, PlayerState>;
  const rules = {} as Record<Side, RuleSet>;

  for (const side of SIDES) {
    rules[side] = { ...DEFAULT_RULES, ...config.rules?.[side] };
    const sb = config.sandbox?.[side];
    const deck = sb ? [sb.active, ...sb.bench, ...sb.hand, ...sb.deck] : config.decks[side];
    if (!deck.some((no) => config.cardDb[no]?.kind === 'otege')) {
      throw new Error(`${side} のデッキに おてあげが 1まいも ありません`);
    }
    deck.forEach((no, i) => {
      const def = config.cardDb[no];
      if (!def) throw new Error(`カードNo ${no} は存在しません`);
      cardDefs[no] = def;
      const uid = `${side}-${i}`;
      const hp = def.kind === 'otege' ? def.hp : 0;
      cards[uid] = { uid, no, owner: side, hp, maxHp: hp, attackAdd: 0, attackOverride: null, itemsThisTurn: [], benchedOnTurn: null };
    });
    players[side] = {
      deck: deck.map((_, i) => `${side}-${i}`),
      hand: [],
      active: null,
      bench: [],
      discard: [],
      koCount: 0,
      turnCount: 0,
      benchPlacedThisTurn: 0,
      swappedThisTurn: false,
      setupChoice: null,
    };
  }

  const state: GameState = {
    version: 1,
    cardDefs,
    rules,
    rng: seedRng(config.seed),
    forcedDice: [...(config.forcedDice ?? [])],
    fixedDie: null,
    cards,
    players,
    phase: 'setup',
    firstPlayer: 'p1',
    currentPlayer: 'p1',
    turnNumber: 0,
    pendingPromote: [],
    resumeAfterPromote: null,
    scheduled: [],
    lasting: [],
    pendingChoice: null,
    winner: null,
    endReason: null,
  };
  const ctx: Ctx = { s: state, events: [] };

  if (config.sandbox) return { state: placeSandbox(ctx, config.sandbox), events: ctx.events };

  // 1. 先攻決め：大きい方が先攻。同じ目なら振り直し
  for (;;) {
    const a = rollDie(ctx, 'order', 'p1');
    const b = rollDie(ctx, 'order', 'p2');
    if (a === b) continue;
    state.firstPlayer = a > b ? 'p1' : 'p2';
    state.currentPlayer = state.firstPlayer;
    break;
  }

  // 2〜3. 切って配る → おてあげが来るまで引き直し
  for (const side of SIDES) deal(ctx, side, !!config.noShuffle);
  for (const side of SIDES) stackDeck(state, side, config.stackTop?.[side] ?? []);
  const fixed = config.fixedDie;
  state.fixedDie = fixed && fixed >= 1 && fixed <= 6 ? Math.floor(fixed) : null;

  return { state, events: ctx.events };
}

function deal(ctx: Ctx, side: Side, noShuffle: boolean): void {
  const { s } = ctx;
  const ps = s.players[side];
  const r = s.rules[side];
  const hasOtege = () => ps.hand.some((uid) => s.cardDefs[s.cards[uid].no].kind === 'otege');

  if (!noShuffle) shuffleInPlace(s.rng, ps.deck);
  ps.hand = ps.deck.splice(0, r.initialHand);
  while (r.mulliganIfNoOtege && !hasOtege()) {
    ctx.events.push({ type: 'Mulligan', player: side });
    ps.deck.push(...ps.hand);
    ps.hand = [];
    shuffleInPlace(s.rng, ps.deck);
    ps.hand = ps.deck.splice(0, r.initialHand);
  }
}

/** 山札の上を指定する（デバッグ用。配り終わってから並べ替える） */
function stackDeck(s: GameState, side: Side, nos: number[]): void {
  const ps = s.players[side];
  const top: string[] = [];
  for (const no of nos) {
    const uid = ps.deck.find((u) => s.cards[u].no === no && !top.includes(u));
    if (uid) top.push(uid);
  }
  ps.deck = [...top, ...ps.deck.filter((u) => !top.includes(u))];
}

/** カードを ためす：置き方どおりに並べ、p1 の1ターン目のメインから始める（先攻決め・配る・バトル場決めは飛ばす） */
function placeSandbox(ctx: Ctx, sandbox: Record<Side, SandboxSide>): GameState {
  const { s } = ctx;
  for (const side of SIDES) {
    const sb = sandbox[side];
    const uids = s.players[side].deck;
    const ps = s.players[side];
    if (s.cardDefs[sb.active]?.kind !== 'otege') throw new Error(`${side} のバトル場は おてあげ にしてください`);
    for (const no of sb.bench) if (s.cardDefs[no]?.kind !== 'otege') throw new Error(`${side} のベンチは おてあげ にしてください`);
    let i = 0;
    ps.active = uids[i++];
    ps.bench = sb.bench.map(() => uids[i++]);
    ps.hand = sb.hand.map(() => uids[i++]);
    ps.deck = uids.slice(i);
  }
  s.firstPlayer = 'p1';
  s.currentPlayer = 'p1';
  s.phase = 'main';
  s.turnNumber = 1;
  s.players.p1.turnCount = 1;
  ctx.events.push({ type: 'ActivesRevealed', p1: s.players.p1.active!, p2: s.players.p2.active! });
  ctx.events.push({ type: 'TurnStarted', player: 'p1', turn: 1 });
  return s;
}
