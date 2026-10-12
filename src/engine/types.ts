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
  /** 先攻の1ターン目は攻撃できない（サイコロを振らない。v2.0・SPEC §4-4） */
  firstPlayerFirstTurnNoAttack: boolean;
};

// ---------------------------------------------------------------- カード定義（cards.json の形）

/** タイミング付き効果の発動タイミング（SPEC §13-3） */
export type Timing = 'selfTurnStart' | 'selfTurnEnd' | 'opponentTurnStart' | 'opponentTurnEnd';

/**
 * 効果（SPEC §5-3・§4-5）
 * then は「+」の持続効果（UPDATE_v2 §4-2 ①）：then[0] が1回後、then[1] が2回後…（0 はその回は何もしない）。
 * 相手へのダメージは相手のターンの終わり、自分の回復・自分へのダメージ・ドローは自分のターンの終わりに発動する。
 */
export type Effect =
  /** 相手のバトル場にダメージ（技なら §4-5 ④の計算）。then は攻撃を受けたおてあげに付く */
  | { type: 'damage'; amount: number; then?: number[] }
  /** 回復（技なら自分自身、アイテムなら選んだ対象）。999 は最大まで */
  | { type: 'heal'; amount: number; then?: number[] }
  /** 技を使ったおてあげ自身にダメージ。999 は必ずきぜつ */
  | { type: 'selfDamage'; amount: number; then?: number[] }
  /** 山札から引く。then はプレイヤーに付く（おてあげがきぜつしても続く） */
  | { type: 'draw'; count: number; then?: number[] }
  /** 手札から選んで捨てる。deckIfNoHand なら手札0の時に山札の一番上を捨てる */
  | { type: 'discard'; count: number; deckIfNoHand?: boolean }
  /** 技を使ったおてあげを、ベンチの誰かと交代（交代の制限は受けない） */
  | { type: 'switchWithBench' }
  /** 攻撃を受けたおてあげが、after 回後の相手のターンの終わりにきぜつ（ばくだん） */
  | { type: 'faintLater'; after: number }
  /** 山札から選んで手札に加え、山札を切る（アイテム） */
  | { type: 'search'; count: number }
  | { type: 'addAttack'; amount: number; duration: 'thisTurn' }
  | { type: 'setHp'; value: number }
  // ↓ 予約（どのカードも使わない。処理枠だけ）
  | { type: 'overrideAttack'; value: number; duration: 'thisTurn' }
  | { type: 'scheduled'; timing: Timing; effect: Effect };

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
  /** トロフィーのカード（v2.0-J。番号。性能は おてあげ と同じ。画面の見た目だけに使う） */
  trophy?: number;
};

/** アイテムの使用条件：HP満タンには使えない／山札に選べるカードが無いと使えない（スーパーおてあげは選べない。v2.4） */
export type ItemUseCondition = 'notFullHp' | 'deckHasSearchable';

/** 2つの言語を持つ文（にほんご＝hira、日本語＝kanji。SPEC §6-4b）。エンジンは使わない（画面用） */
export type LocalText = { hira: string; kanji: string };

/** アイテム（ふせん）の色。画面の見た目だけに使う */
export type NoteColor = 'yellow' | 'green' | 'red' | 'purple' | 'blue';

export type ItemCardDef = {
  no: number;
  id: string;
  name: string;
  kind: 'item';
  color?: NoteColor;
  /** 使う相手（自分のおてあげ）。書かないアイテムは、おてあげに使わない（ひきかえカード・やばいつぼ。v2.0） */
  target?: { side: 'self'; zones: Zone[]; rarity: Rarity[] };
  useCondition?: ItemUseCondition;
  /** このカードを含めた手札がこの枚数未満なら使えない */
  minHand?: number;
  /**
   * 重ねがけ禁止（SPEC §4-7・v1.4）：このターンに、ここに書いた id のアイテムを使ったおてあげには使えない
   */
  blockedIfUsedThisTurn?: string[];
  /** このアイテムを使ったおてあげに、重ねがけ禁止のアイテムを使おうとした時の一言（にほんご・日本語） */
  afterUseNote?: LocalText;
  effects: Effect[];
  /** 効果の説明（にほんご・日本語。SPEC §5-2） */
  text: LocalText;
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

/**
 * 持続効果・時限の1件（SPEC §4-5 ①②。v2.0。v2.5 で作り直し）
 * holder のターンの終わり1回を「1ターン」と数える。turns が 1 のものは、次に来る holder のターンの終わりに発動する。
 * - 持続ダメージ・持続回復・自分への持続ダメージ・ばくだん：付いたおてあげ（targetUid）の持ち主が holder
 * - 遅延ドロー：プレイヤー（targetUid は null）が holder
 */
export type Lasting = {
  /** 受けた順番（試合の中で1から。小さいほど古い） */
  seq: number;
  /** 効果を付けた人（倒した数はこの人に） */
  owner: Side;
  /** このプレイヤーのターンの終わりに数え、発動する */
  holder: Side;
  kind: 'damage' | 'heal' | 'selfDamage' | 'draw' | 'faint';
  /** ダメージ・回復の量、ドローの枚数（faint では 0） */
  amount: number;
  /** 付いているおてあげ。null はプレイヤーに付く（ドロー） */
  targetUid: string | null;
  /** 何ターン後に発動するか（1 なら次に来る holder のターンの終わり。遅延ドローでは「あと」の数） */
  turns: number;
  /** 効果を出したおてあげ */
  sourceUid: string;
  /** 登録された通算ターン番号（そのターンの終わりは数えない） */
  createdTurn: number;
};

/** 選び終わったあとに続ける処理 */
export type ChoiceAfter = { kind: 'main' } | { kind: 'endTurn'; player: Side; attacked: boolean };

/** 選んだあとに続けて行う効果（技・アイテムの残り） */
export type QueuedEffect = { effect: Effect; src: EffectSourceData; stage: 'act' | 'register' };

/** 効果がどこから出たか（状態に保存できる形） */
export type EffectSourceData = {
  /** move＝技／item＝アイテム／scheduled＝予約の効果／lasting＝持続効果 */
  kind: 'move' | 'item' | 'scheduled' | 'lasting';
  player: Side;
  /** 効果を出したカード（技ならおてあげ、アイテムならアイテム） */
  sourceUid: string;
  /** アイテムで選んだ対象 */
  targetUid?: string;
  /** 技の時、その時に攻撃を受けた相手のバトル場（持続ダメージ・ばくだんの付く先） */
  hitUid?: string | null;
};

/** カードを選ぶ待ち（SPEC §4-5 ⑤。v2.0） */
export type PendingChoice = {
  player: Side;
  /** discard＝手札を捨てる／search＝山札から手札へ／switch＝ベンチの誰と交代するか */
  kind: 'discard' | 'search' | 'switch';
  /** 選ぶ枚数 */
  count: number;
  /** 選べるカード */
  options: string[];
  /** 効果を出したカード */
  sourceUid: string;
  /** 選んだあとに続けて行う効果 */
  rest: QueuedEffect[];
  after: ChoiceAfter;
};

/** タイミング付き効果キューの1件（SPEC §13-3。予約） */
export type ScheduledEffect = {
  owner: Side;
  timing: Timing;
  effect: Effect;
  /** 効果を出したカード */
  sourceUid: string;
  /** 登録された時の通算ターン番号。これより後のターンでだけ発動する */
  createdTurn: number;
};

export type Phase = 'setup' | 'main' | 'promote' | 'choose' | 'over';

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
  /** 持続効果・時限（受けた順。v2.0） */
  lasting: Lasting[];
  /** 最後に付けた持続効果の受けた順番（v2.5） */
  lastingSeq: number;
  /** カードを選ぶ待ち（phase が choose の時） */
  pendingChoice: PendingChoice | null;
  winner: Side | null;
  endReason: EndReason | null;
};

// ---------------------------------------------------------------- 操作（SPEC §11-5）

/** 操作。player は通信では送らず、受け取った側が送り主の役割を入れる */
export type Action =
  | { type: 'SETUP_ACTIVE'; player: Side; uid: string }
  | { type: 'PLACE_BENCH'; player: Side; uid: string }
  /** targetUid はおてあげに使うアイテムだけ（ひきかえカード・やばいつぼには無い） */
  | { type: 'USE_ITEM'; player: Side; uid: string; targetUid?: string }
  | { type: 'SWAP'; player: Side; benchUid: string }
  | { type: 'END_TURN'; player: Side }
  | { type: 'PROMOTE'; player: Side; benchUid: string }
  /** カードを選ぶ（捨てる・山札から選ぶ・交代先。v2.0） */
  | { type: 'CHOOSE'; player: Side; uids: string[] }
  | { type: 'SURRENDER'; player: Side };

export type ActionType = Action['type'];

// ---------------------------------------------------------------- イベント（SPEC §14-3）

export type GameEvent =
  | { type: 'DiceRolled'; purpose: 'order' | 'attack'; player: Side; value: number }
  | { type: 'Mulligan'; player: Side }
  | { type: 'Drew'; player: Side; uid: string }
  | { type: 'TurnStarted'; player: Side; turn: number }
  | { type: 'BenchPlaced'; player: Side; uid: string }
  /** byEffect：技の効果で交代した（交代の制限を受けない） */
  | { type: 'Swapped'; player: Side; toActive: string; toBench: string; byEffect?: boolean }
  | { type: 'ItemUsed'; player: Side; itemUid: string; targetUid: string | null }
  | { type: 'BuffChanged'; uid: string; attackAdd: number; attackOverride: number | null }
  | { type: 'MoveSelected'; uid: string; moveIndex: number }
  | { type: 'Damaged'; uid: string; amount: number; hpAfter: number; big: boolean }
  | { type: 'Healed'; uid: string; amount: number; hpAfter: number }
  | { type: 'HpSet'; uid: string; hpAfter: number }
  | { type: 'Fainted'; uid: string; by: Side; koCount: number }
  | { type: 'NeedPromote'; player: Side }
  | { type: 'Promoted'; player: Side; uid: string }
  /** firstTurn：先攻の1ターン目なので攻撃しなかった */
  | { type: 'TurnEnded'; player: Side; attacked: boolean; firstTurn?: boolean }
  // ↓ v2.0（UPDATE_v2 §4）
  /** 持続効果・時限が付いた */
  | { type: 'LastingAdded'; lasting: Lasting }
  /** 持続効果・時限が発動する（このあとに Damaged・Healed・Drew・Fainted が続く）。同じターンの中では新しいものから1つずつ */
  | { type: 'LastingFired'; lasting: Lasting }
  /** player のターンの終わりで、残りの持続効果が1ターン進んだ（seqs のものの turns が1減った。v2.5） */
  | { type: 'LastingTicked'; player: Side; seqs: number[] }
  /** バトル場からベンチに戻ったので、持続ダメージ・持続回復が消えた（ばくだんは残る。v2.5） */
  | { type: 'LastingCleared'; uid: string; seqs: number[] }
  /** 捨てた。fromDeck なら山札の一番上から */
  | { type: 'Discarded'; player: Side; uids: string[]; fromDeck: boolean }
  /** 山札から選んで手札に加えた（相手には何を取ったか見せない） */
  | { type: 'Searched'; player: Side; uids: string[]; sourceUid: string }
  | { type: 'DeckShuffled'; player: Side }
  /** カードを選ぶ待ちになった */
  | { type: 'ChoiceNeeded'; player: Side; kind: PendingChoice['kind']; count: number }
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
  | 'notPending'
  /** 山札が0枚なので使えない（ひきかえカード） */
  | 'deckEmpty'
  /** 山札に選べるカードが無いので使えない（ひきかえカード。山札がスーパーおてあげだけ。v2.4） */
  | 'noSearchable'
  /** 手札が足りないので使えない（やばいつぼ） */
  | 'handTooSmall'
  /** 選び方が正しくない（枚数・選べないカード） */
  | 'badChoice';

export type ApplyResult = {
  state: GameState;
  events: GameEvent[];
  /** 弾いた時だけ入る。その時 state は渡したものと同じ */
  rejected?: RejectReason;
};
