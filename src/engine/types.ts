/**
 * ルールエンジンの型（SPEC §4, §5, §13-3, §14-3）
 * このフォルダは React・通信・Math.random()・Date.now() を使わない純粋な処理だけにする。
 */

export type Side = 'p1' | 'p2';

// ---------------------------------------------------------------- ルールセット

/** ルールの数値（SPEC §4-8）。プレイヤーごとに別の値を持てる */
export type RuleSet = {
  deckSize: number;
  initialHand: number;
  /** 自分ターン数がこの倍数の時にドロー */
  drawEveryNTurns: number;
  /** 相手を何体倒せば勝ちか */
  koToWin: number;
  benchMax: number;
  benchPlacePerTurn: number;
  superMaxPerDeck: number;
  /** ダメージ技に常に足す値 */
  attackBonus: number;
  /** 初手におてあげがいなければ引き直し */
  mulliganIfNoOtege: boolean;
  /**
   * 手札からベンチに出したおてあげが、交代でバトル場に出られるまでの自分ターン数（SPEC §4-4・v1.4）。
   * 1 なら「出したターンはだめ、次の自分ターンから」。0 なら制限なし
   */
  swapCooldownTurns: number;
};

// ---------------------------------------------------------------- カード定義（cards.json の形）

/** タイミング付き効果の発動タイミング（SPEC §13-3） */
export type Timing = 'selfTurnStart' | 'selfTurnEnd' | 'opponentTurnStart' | 'opponentTurnEnd';

/** 効果（SPEC §5-3） */
export type Effect =
  | { type: 'damage'; amount: number }
  | { type: 'heal'; amount: number }
  | { type: 'addAttack'; amount: number; duration: 'thisTurn' }
  | { type: 'overrideAttack'; value: number; duration: 'thisTurn' }
  | { type: 'setHp'; value: number }
  // ↓ 予約（今回のカードでは使わない。処理枠だけ）
  | { type: 'scheduled'; timing: Timing; effect: Effect }
  | { type: 'selfDamage'; amount: number };

export type EffectType = Effect['type'];

export type Rarity = 'normal' | 'super';
export type Zone = 'active' | 'bench';

export type Move = {
  /** この技が出るサイコロの目 */
  faces: number[];
  effects: Effect[];
};

export type OtegeCardDef = {
  no: number;
  id: string;
  name: string;
  kind: 'otege';
  rarity: Rarity;
  hp: number;
  moves: Move[];
  image: string;
  flavor: string;
};

export type ItemUseCondition = 'notFullHp';

/** アイテム（ふせん）の色。画面の見た目だけに使う */
export type NoteColor = 'yellow' | 'green' | 'red' | 'purple' | 'blue';

export type ItemCardDef = {
  no: number;
  id: string;
  name: string;
  kind: 'item';
  color?: NoteColor;
  target: { side: 'self'; zones: Zone[]; rarity: Rarity[] };
  useCondition?: ItemUseCondition;
  /**
   * 重ねがけ禁止（SPEC §4-7・v1.4）：このターンに、ここに書いた id のアイテムを使ったおてあげには使えない
   */
  blockedIfUsedThisTurn?: string[];
  /** このアイテムを使ったおてあげに、重ねがけ禁止のアイテムを使おうとした時の一言（例「ドリンクを のんだ おてあげには つかえないよ」） */
  afterUseNote?: string;
  effects: Effect[];
  text: string;
  image: string;
};

export type CardDef = OtegeCardDef | ItemCardDef;

/** カードNo → 定義 */
export type CardDb = Record<number, CardDef>;

// ---------------------------------------------------------------- 状態

/** 場・手札・山札にある1枚のカード */
export type CardInstance = {
  /** 個体ID：「役割-デッキ内の位置」（例 p1-0〜p1-14）。両端末で同じになる */
  uid: string;
  no: number;
  owner: Side;
  hp: number;
  maxHp: number;
  /** このターンのダメージ加算（ひみつのやいば） */
  attackAdd: number;
  /** このターンのダメージ上書き（予約。v1.4 ではどのカードも使わない）。無ければ null */
  attackOverride: number | null;
  /** このターンに、このおてあげに使われたアイテム（カードNo。重ねがけ禁止の判定用。ターン終了で空になる） */
  itemsThisTurn: number[];
  /** 手札からベンチに出した時の、持ち主の自分ターン数（交代制限の判定用）。バトル場に出たら null */
  benchedOnTurn: number | null;
};

export type PlayerState = {
  /** 山札（先頭＝一番上） */
  deck: string[];
  hand: string[];
  active: string | null;
  bench: string[];
  discard: string[];
  /** 倒した数 */
  koCount: number;
  /** 自分ターン数（1から数える） */
  turnCount: number;
  benchPlacedThisTurn: number;
  swappedThisTurn: boolean;
  /** 準備中に選んだバトル場（相手にはまだ見せない） */
  setupChoice: string | null;
};

/** タイミング付き効果キューの1件（SPEC §13-3） */
export type ScheduledEffect = {
  owner: Side;
  timing: Timing;
  effect: Effect;
  /** 効果を出したカード */
  sourceUid: string;
  /** 登録された時の通算ターン番号。これより後のターンでだけ発動する */
  createdTurn: number;
};

export type Phase = 'setup' | 'main' | 'promote' | 'over';

/** くりだし待ちが終わった後に続ける処理 */
export type Resume = { kind: 'startTurn'; player: Side } | { kind: 'main' };

export type EndReason = 'ko' | 'noBench' | 'surrender';

export type GameState = {
  /** 状態の形式版数 */
  version: 1;
  /** この試合で使うカードの定義 */
  cardDefs: CardDb;
  /** プレイヤー別ルールセット */
  rules: Record<Side, RuleSet>;
  /** 種付き乱数の内部状態（xoshiro128**） */
  rng: [number, number, number, number];
  /** デバッグ・テスト用：先頭から順に、乱数の代わりにこの目を出す */
  forcedDice: number[];
  /** デバッグ用：サイコロの目を固定（null なら乱数） */
  fixedDie: number | null;
  cards: Record<string, CardInstance>;
  players: Record<Side, PlayerState>;
  phase: Phase;
  firstPlayer: Side;
  currentPlayer: Side;
  /** 通算ターン番号（どちらかのターンが始まるたび +1。準備中は 0） */
  turnNumber: number;
  /** くりだしを選ぶ必要がある人 */
  pendingPromote: Side[];
  resumeAfterPromote: Resume | null;
  scheduled: ScheduledEffect[];
  winner: Side | null;
  endReason: EndReason | null;
};

// ---------------------------------------------------------------- 操作（SPEC §11-5）

/** 操作。player は通信では送らず、受け取った側が送り主の役割を入れる */
export type Action =
  | { type: 'SETUP_ACTIVE'; player: Side; uid: string }
  | { type: 'PLACE_BENCH'; player: Side; uid: string }
  | { type: 'USE_ITEM'; player: Side; uid: string; targetUid: string }
  | { type: 'SWAP'; player: Side; benchUid: string }
  | { type: 'END_TURN'; player: Side }
  | { type: 'PROMOTE'; player: Side; benchUid: string }
  | { type: 'SURRENDER'; player: Side };

export type ActionType = Action['type'];

// ---------------------------------------------------------------- イベント（SPEC §14-3）

export type GameEvent =
  | { type: 'DiceRolled'; purpose: 'order' | 'attack'; player: Side; value: number }
  | { type: 'Mulligan'; player: Side }
  | { type: 'Drew'; player: Side; uid: string }
  | { type: 'TurnStarted'; player: Side; turn: number }
  | { type: 'BenchPlaced'; player: Side; uid: string }
  | { type: 'Swapped'; player: Side; toActive: string; toBench: string }
  | { type: 'ItemUsed'; player: Side; itemUid: string; targetUid: string }
  | { type: 'BuffChanged'; uid: string; attackAdd: number; attackOverride: number | null }
  | { type: 'MoveSelected'; uid: string; moveIndex: number }
  | { type: 'Damaged'; uid: string; amount: number; hpAfter: number; big: boolean }
  | { type: 'Healed'; uid: string; amount: number; hpAfter: number }
  | { type: 'HpSet'; uid: string; hpAfter: number }
  | { type: 'Fainted'; uid: string; by: Side; koCount: number }
  | { type: 'NeedPromote'; player: Side }
  | { type: 'Promoted'; player: Side; uid: string }
  | { type: 'TurnEnded'; player: Side; attacked: boolean }
  | { type: 'GameOver'; winner: Side; reason: EndReason }
  // ↓ SPEC §14-3 に無いが、準備（バトル場を裏向きで同時に決める）の演出に必要なので追加
  | { type: 'ActiveChosen'; player: Side }
  | { type: 'ActivesRevealed'; p1: string; p2: string };

/** 不正な操作を弾いた理由 */
export type RejectReason =
  | 'gameOver'
  | 'wrongPhase'
  | 'notYourTurn'
  | 'alreadyChosen'
  | 'notInHand'
  | 'notOtege'
  | 'notItem'
  | 'benchFull'
  | 'benchLimit'
  | 'notOnBench'
  | 'noActive'
  | 'badTarget'
  | 'fullHp'
  /** 重ねがけ禁止（このターン、このおてあげには使えないアイテム） */
  | 'stackBlocked'
  /** 出したばかりのおてあげは交代でバトル場に出せない */
  | 'justPlaced'
  | 'notPending';

export type ApplyResult = {
  state: GameState;
  events: GameEvent[];
  /** 弾いた時だけ入る。その時 state は渡したものと同じ */
  rejected?: RejectReason;
};
