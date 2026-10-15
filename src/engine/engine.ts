import {
  type Ctx,
  SIDES,
  cloneState,
  defOf,
  drawOne,
  endGame,
  healBlocked,
  isOver,
  faint,
  isInPlay,
  isSearchable,
  other,
  otegeDefOf,
  promote,
  rollDie,
} from './core';
import { applyChoice, clearLastingHeal, clearLastingOnBench, fireLasting, runEffect, runQueue } from './effects';
import type {
  Action,
  ApplyResult,
  ChoiceAfter,
  Effect,
  EffectSourceData,
  GameState,
  Lasting,
  QueuedEffect,
  RejectReason,
  Resume,
  ScheduledEffect,
  Side,
} from './types';

/**
 * ルールエンジンの入口（SPEC §4, §11-3）
 * applyAction(state, action) → { state, events }
 * 同じ状態に同じ操作を渡せば、必ず同じ結果になる（決定論）。
 * 自分の操作も相手の操作も、ここを通す。
 */
export function applyAction(state: GameState, action: Action): ApplyResult {
  const rejected = validateAction(state, action);
  if (rejected) return { state, events: [], rejected };

  const ctx: Ctx = { s: cloneState(state), events: [] };
  switch (action.type) {
    case 'SETUP_ACTIVE':
      doSetupActive(ctx, action.player, action.uid);
      break;
    case 'PLACE_BENCH':
      doPlaceBench(ctx, action.player, action.uid);
      break;
    case 'USE_ITEM':
      doUseItem(ctx, action.player, action.uid, action.targetUid);
      break;
    case 'SWAP':
      doSwap(ctx, action.player, action.benchUid);
      break;
    case 'END_TURN':
      doEndTurn(ctx, action.player);
      break;
    case 'PROMOTE':
      doPromote(ctx, action.player, action.benchUid);
      break;
    case 'CHOOSE':
      doChoose(ctx, action.uids);
      break;
    case 'SURRENDER':
      endGame(ctx, other(action.player), 'surrender');
      break;
  }
  return { state: ctx.s, events: ctx.events };
}

// ---------------------------------------------------------------- 検証

/** その操作を今してよいか。だめなら理由を返す */
export function validateAction(s: GameState, action: Action): RejectReason | null {
  if (isOver(s)) return 'gameOver';
  const p = action.player;
  // 通信で届いた操作は形が壊れているかもしれない（SPEC §11-5「不正な操作は無視」）
  if (p !== 'p1' && p !== 'p2') return 'wrongPhase';
  const ps = s.players[p];

  switch (action.type) {
    case 'SURRENDER':
      return null;

    case 'SETUP_ACTIVE':
      if (s.phase !== 'setup') return 'wrongPhase';
      if (ps.setupChoice !== null) return 'alreadyChosen';
      if (!ps.hand.includes(action.uid)) return 'notInHand';
      if (!otegeDefOf(s, action.uid)) return 'notOtege';
      return null;

    case 'PROMOTE':
      if (s.phase !== 'promote') return 'wrongPhase';
      if (!s.pendingPromote.includes(p)) return 'notPending';
      if (!ps.bench.includes(action.benchUid)) return 'notOnBench';
      return null;

    case 'CHOOSE': {
      const pc = s.pendingChoice;
      if (s.phase !== 'choose' || !pc) return 'wrongPhase';
      if (pc.player !== p) return 'notYourTurn';
      const uids = action.uids;
      if (!Array.isArray(uids)) return 'badChoice';
      const need = Math.min(pc.count, pc.options.length);
      if (uids.length !== need || new Set(uids).size !== uids.length) return 'badChoice';
      if (!uids.every((u) => typeof u === 'string' && pc.options.includes(u))) return 'badChoice';
      return null;
    }
  }

  // ここから下は手番の人のメイン操作
  if (s.phase !== 'main') return 'wrongPhase';
  if (s.currentPlayer !== p) return 'notYourTurn';

  switch (action.type) {
    case 'PLACE_BENCH':
      if (!ps.hand.includes(action.uid)) return 'notInHand';
      if (!otegeDefOf(s, action.uid)) return 'notOtege';
      if (ps.bench.length >= s.rules[p].benchMax) return 'benchFull';
      if (ps.benchPlacedThisTurn >= s.rules[p].benchPlacePerTurn) return 'benchLimit';
      return null;

    case 'USE_ITEM': {
      if (!ps.hand.includes(action.uid)) return 'notInHand';
      const item = defOf(s, action.uid);
      if (!item || item.kind !== 'item') return 'notItem';
      if (item.minHand !== undefined && ps.hand.length < item.minHand) return 'handTooSmall';
      if (item.useCondition === 'deckHasSearchable') {
        if (ps.deck.length === 0) return 'deckEmpty';
        if (!ps.deck.some((u) => isSearchable(s, u))) return 'noSearchable';
      }
      // おてあげに使わないアイテム（ひきかえカード・やばいつぼ）
      if (!item.target) return action.targetUid === undefined ? null : 'badTarget';
      if (typeof action.targetUid !== 'string') return 'badTarget';
      const target = s.cards[action.targetUid];
      const targetDef = otegeDefOf(s, action.targetUid);
      if (!target || !targetDef) return 'badTarget';
      // 今あるアイテムは全部「自分のおてあげ」が対象
      if (item.target.side === 'self' && target.owner !== p) return 'badTarget';
      const zone = ps.active === target.uid ? 'active' : ps.bench.includes(target.uid) ? 'bench' : null;
      if (!zone || !item.target.zones.includes(zone)) return 'badTarget';
      if (!item.target.rarity.includes(targetDef.rarity)) return 'badTarget';
      // 回復できないおてあげ（きみょうなドリンクを使った。v2.7）には、回復のアイテムを使えない（「まんたん」より先に言う）
      if (item.effects.some((e) => e.type === 'heal') && healBlocked(s, target.uid)) return 'healBlocked';
      if (item.useCondition === 'notFullHp' && target.hp >= target.maxHp) return 'fullHp';
      if (blockedItemOn(s, item.blockedIfUsedThisTurn, target.itemsThisTurn) !== null) return 'stackBlocked';
      // 1回の対戦で、同じおてあげには1回だけ（スポドリ。v2.7）
      if (item.oncePerOtege && target.itemsUsed.includes(item.no)) return 'usedOnce';
      return null;
    }

    case 'SWAP': {
      if (!ps.active) return 'noActive';
      if (!ps.bench.includes(action.benchUid)) return 'notOnBench';
      // 出したばかりのおてあげは交代でバトル場に出せない（SPEC §4-4）
      const placed = s.cards[action.benchUid].benchedOnTurn;
      if (placed !== null && ps.turnCount - placed < s.rules[p].swapCooldownTurns) return 'justPlaced';
      return null;
    }

    case 'END_TURN':
      if (!ps.active) return 'noActive';
      return null;

    default:
      // 知らない種類の操作
      return 'wrongPhase';
  }
}

// ---------------------------------------------------------------- 合法手

/**
 * そのプレイヤーが今できる操作の一覧（CPU・画面の「いま出来る操作」用）。
 * SURRENDER はいつでもできるので一覧には入れない。
 */
export function getLegalActions(s: GameState, player: Side): Action[] {
  if (isOver(s)) return [];
  const ps = s.players[player];
  const candidates: Action[] = [];

  if (s.phase === 'setup') {
    for (const uid of ps.hand) candidates.push({ type: 'SETUP_ACTIVE', player, uid });
  } else if (s.phase === 'promote') {
    for (const uid of ps.bench) candidates.push({ type: 'PROMOTE', player, benchUid: uid });
  } else if (s.phase === 'choose' && s.pendingChoice?.player === player) {
    const pc = s.pendingChoice;
    for (const uids of combinations(pc.options, Math.min(pc.count, pc.options.length))) candidates.push({ type: 'CHOOSE', player, uids });
  } else if (s.phase === 'main' && s.currentPlayer === player) {
    const field = [ps.active, ...ps.bench].filter((u): u is string => u !== null);
    for (const uid of ps.hand) {
      candidates.push({ type: 'PLACE_BENCH', player, uid });
      candidates.push({ type: 'USE_ITEM', player, uid });
      for (const targetUid of field) candidates.push({ type: 'USE_ITEM', player, uid, targetUid });
    }
    for (const uid of ps.bench) candidates.push({ type: 'SWAP', player, benchUid: uid });
    candidates.push({ type: 'END_TURN', player });
  }
  return candidates.filter((a) => validateAction(s, a) === null);
}

/** options から k 個選ぶ組み合わせ（options の順を保つ） */
export function combinations<T>(options: T[], k: number): T[][] {
  const out: T[][] = [];
  const pick = (start: number, acc: T[]) => {
    if (acc.length === k) {
      out.push([...acc]);
      return;
    }
    for (let i = start; i <= options.length - (k - acc.length); i++) {
      acc.push(options[i]);
      pick(i + 1, acc);
      acc.pop();
    }
  };
  pick(0, []);
  return out;
}

// ---------------------------------------------------------------- 各操作

function doSetupActive(ctx: Ctx, player: Side, uid: string): void {
  const { s } = ctx;
  s.players[player].setupChoice = uid;
  ctx.events.push({ type: 'ActiveChosen', player });

  // 両者が決めたら同時に表にする（SPEC §4-3）
  if (SIDES.some((p) => s.players[p].setupChoice === null)) return;
  for (const p of SIDES) {
    const ps = s.players[p];
    const chosen = ps.setupChoice as string;
    ps.hand = ps.hand.filter((u) => u !== chosen);
    ps.active = chosen;
    ps.setupChoice = null;
  }
  ctx.events.push({ type: 'ActivesRevealed', p1: s.players.p1.active!, p2: s.players.p2.active! });
  startTurn(ctx, s.firstPlayer);
}

function doPlaceBench(ctx: Ctx, player: Side, uid: string): void {
  const ps = ctx.s.players[player];
  ps.hand = ps.hand.filter((u) => u !== uid);
  ps.bench.push(uid);
  ps.benchPlacedThisTurn += 1;
  ctx.s.cards[uid].benchedOnTurn = ps.turnCount;
  ctx.events.push({ type: 'BenchPlaced', player, uid });
}

function doUseItem(ctx: Ctx, player: Side, itemUid: string, targetUid: string | undefined): void {
  const ps = ctx.s.players[player];
  const item = defOf(ctx.s, itemUid);
  if (!item || item.kind !== 'item') return;
  ps.hand = ps.hand.filter((u) => u !== itemUid);
  ps.discard.push(itemUid);
  // すでに回復できないおてあげには、このアイテムでも HP を上げない（v2.7。2本目のドリンクで HP5 → 10 にしない）
  const wasBlocked = targetUid !== undefined && healBlocked(ctx.s, targetUid);
  if (targetUid !== undefined) {
    ctx.s.cards[targetUid].itemsThisTurn.push(item.no);
    ctx.s.cards[targetUid].itemsUsed.push(item.no);
  }
  ctx.events.push({ type: 'ItemUsed', player, itemUid, targetUid: targetUid ?? null });
  // 回復できなくなる（きみょうなドリンク。v2.7）：付いている持続回復は、すぐ消える
  if (item.blocksHeal && targetUid !== undefined) clearLastingHeal(ctx, targetUid);
  // アイテムの効果はデータに書いた順（やばいつぼ：引く → 捨てる）。カードを選ぶ必要があれば止まる
  const src: EffectSourceData = targetUid !== undefined ? { kind: 'item', player, sourceUid: itemUid, targetUid } : { kind: 'item', player, sourceUid: itemUid };
  const queue: QueuedEffect[] = item.effects.map((effect) => ({ effect, src, stage: 'act' }));
  if (wasBlocked) ctx.noRaiseHp = targetUid;
  runQueue(ctx, queue, { kind: 'main' });
  ctx.noRaiseHp = undefined;
}

function doSwap(ctx: Ctx, player: Side, benchUid: string): void {
  const ps = ctx.s.players[player];
  const oldActive = ps.active as string;
  const i = ps.bench.indexOf(benchUid);
  // ベンチに戻るおてあげの持続ダメージ・持続回復は消える（ばくだんは残る。v2.5）
  clearLastingOnBench(ctx, oldActive);
  ps.bench[i] = oldActive;
  ps.active = benchUid;
  ctx.s.cards[benchUid].benchedOnTurn = null;
  ps.swappedThisTurn = true;
  ctx.events.push({ type: 'Swapped', player, toActive: benchUid, toBench: oldActive });
}

function doPromote(ctx: Ctx, player: Side, benchUid: string): void {
  const { s } = ctx;
  promote(ctx, player, benchUid);
  s.pendingPromote = s.pendingPromote.filter((p) => p !== player);
  if (s.pendingPromote.length > 0) return;
  // 自爆で両方HP0の時：相手が次を出し終わったので、ここで自爆した側がきぜつする（v2.6）
  const d = s.deferredFaint;
  if (d) {
    s.deferredFaint = null;
    // ほかの理由で もう気絶していたら、二度は気絶させない
    if (isInPlay(s, d.uid)) faint(ctx, d.uid, d.by);
    if (isOver(s) || s.pendingPromote.length > 0) return;
  }
  resume(ctx);
}

/** カードを選んだ：選ぶ待ちを片付け、預けていた残りの効果と、そのあとの流れを続ける（SPEC §4-5 ⑤） */
function doChoose(ctx: Ctx, uids: string[]): void {
  const { s } = ctx;
  const pc = s.pendingChoice;
  if (!pc) return;
  applyChoice(ctx, uids);
  s.phase = 'main';
  if (isOver(s)) return;
  if (runQueue(ctx, pc.rest, pc.after)) return;
  continueAfter(ctx, pc.after);
}

/** 効果の列を終えたあとの流れ（メインに戻る／ターン終了の続き） */
function continueAfter(ctx: Ctx, after: ChoiceAfter): void {
  if (isOver(ctx.s)) return;
  if (after.kind === 'endTurn') finishEndTurn(ctx, after.player, after.attacked);
  else ctx.s.phase = 'main';
}

/** くりだし待ちが終わったら、止めていた流れを再開する */
function resume(ctx: Ctx): void {
  const { s } = ctx;
  const r = s.resumeAfterPromote;
  s.resumeAfterPromote = null;
  if (r?.kind === 'startTurn') startTurn(ctx, r.player);
  else s.phase = 'main';
}

/** くりだし待ちがあれば止める。止めたら true */
function pauseForPromote(ctx: Ctx, next: Resume): boolean {
  const { s } = ctx;
  if (isOver(s) || s.pendingPromote.length === 0) return false;
  s.phase = 'promote';
  s.resumeAfterPromote = next;
  return true;
}

// ---------------------------------------------------------------- ターンの流れ（SPEC §4-4）

/** [1] ターン開始 */
function startTurn(ctx: Ctx, player: Side): void {
  const { s } = ctx;
  const ps = s.players[player];
  s.phase = 'main';
  s.currentPlayer = player;
  s.turnNumber += 1;
  ps.turnCount += 1;
  ps.benchPlacedThisTurn = 0;
  ps.swappedThisTurn = false;
  ctx.events.push({ type: 'TurnStarted', player, turn: ps.turnCount });

  const n = s.rules[player].drawEveryNTurns;
  if (n > 0 && ps.turnCount % n === 0) drawOne(ctx, player);

  processScheduled(ctx, 'start', player);
  pauseForPromote(ctx, { kind: 'main' });
}

/**
 * [3] ターン終了：攻撃 → 持続効果・タイミング付き効果 → 「このターン」の効果を消す → 相手のターンへ。
 * 技の効果でカードを選ぶ必要があれば、選び終わるまで止まる（続きは finishEndTurn）
 */
function doEndTurn(ctx: Ctx, player: Side): void {
  const { s } = ctx;
  const ps = s.players[player];
  // 先攻の1ターン目は攻撃しない（SPEC §4-4・v2.0）
  const firstTurn = s.rules[player].firstPlayerFirstTurnNoAttack && player === s.firstPlayer && ps.turnCount === 1;
  const attacked = !ps.swappedThisTurn && !firstTurn;
  if (attacked && attack(ctx, player)) return;
  if (isOver(s)) return;
  finishEndTurn(ctx, player, attacked, firstTurn);
}

/** ターン終了の続き（攻撃のあと） */
function finishEndTurn(ctx: Ctx, player: Side, attacked: boolean, firstTurn = false): void {
  const { s } = ctx;
  processLasting(ctx, player);
  if (isOver(s)) return;
  processScheduled(ctx, 'end', player);
  if (isOver(s)) return;

  clearTurnBuffs(ctx);
  ctx.events.push(firstTurn ? { type: 'TurnEnded', player, attacked, firstTurn } : { type: 'TurnEnded', player, attacked });

  const next = other(player);
  if (pauseForPromote(ctx, { kind: 'startTurn', player: next })) return;
  startTurn(ctx, next);
}

/** 1つの技の中の処理順（SPEC §4-5 ③）：小さい順に行う。同じ順のものはデータに書いた順 */
const MOVE_STEP: Record<Effect['type'], number> = {
  damage: 1,
  heal: 3,
  selfDamage: 4,
  draw: 5,
  search: 6,
  discard: 7,
  switchWithBench: 8,
  addAttack: 9,
  setHp: 9,
  overrideAttack: 9,
  scheduled: 9,
  faintLater: 9,
};

/**
 * サイコロを振り、バトル場のおてあげの技を使う。
 * 処理順（SPEC §4-5 ③）：相手へのダメージ → 勝敗 → 回復 → 自分へのダメージ → ドロー・捨てる・交代 → 持続効果・時限の登録
 * @returns カードを選ぶ待ちで止まったら true
 */
function attack(ctx: Ctx, player: Side): boolean {
  const { s } = ctx;
  const uid = s.players[player].active;
  if (!uid) return false;
  const def = otegeDefOf(s, uid);
  if (!def) return false;
  const value = rollDie(ctx, 'attack', player);
  const moveIndex = def.moves.findIndex((m) => m.faces.includes(value));
  if (moveIndex < 0) return false;
  ctx.events.push({ type: 'MoveSelected', uid, moveIndex });
  // 持続ダメージ・ばくだんは「その時に攻撃を受けたおてあげ」に付く（SPEC §4-5 ②）
  const src: EffectSourceData = { kind: 'move', player, sourceUid: uid, hitUid: s.players[other(player)].active };
  const effects = def.moves[moveIndex].effects;
  const acts: QueuedEffect[] = effects
    .map((effect, i) => ({ effect, i }))
    .sort((a, b) => MOVE_STEP[a.effect.type] - MOVE_STEP[b.effect.type] || a.i - b.i)
    .map(({ effect }) => ({ effect, src, stage: 'act' }));
  const registers: QueuedEffect[] = effects.map((effect) => ({ effect, src, stage: 'register' }));
  return runQueue(ctx, [...acts, ...registers], { kind: 'endTurn', player, attacked: true });
}

/**
 * 持続効果・時限（SPEC §4-5 ①②。v2.5）：player のターンの終わりに1ターン進める。
 * 1. 持続ダメージ・持続回復・ばくだんのうち、このターンに来るもの（turns が 1）を、新しく受けたものから1つずつ発動する
 *    （途中で気絶したら、そのおてあげに残っているものは消える）
 * 2. 残りを1ターン進める（turns を1減らす。LastingTicked）
 * 3. 遅延ドローのうち 0 になったものを、新しいものから引く（同じターンなら、持続ダメージ・回復の後）
 * 登録されたターンの終わりは数えない。
 */
function processLasting(ctx: Ctx, player: Side): void {
  const { s } = ctx;
  // きぜつを後回しにしている（HP0の）おてあげの持続効果は発動しない（このあと気絶して消える。v2.6）
  const counts = (l: Lasting) => l.holder === player && l.createdTurn < s.turnNumber && (l.targetUid === null || l.targetUid !== s.deferredFaint?.uid);
  const newestFirst = (a: Lasting, b: Lasting) => b.seq - a.seq;
  const fire = (list: Lasting[]) => {
    for (const l of list) {
      // 前に発動したもので気絶して、消えていれば行わない
      if (!s.lasting.includes(l)) continue;
      s.lasting = s.lasting.filter((x) => x !== l);
      fireLasting(ctx, l);
      if (isOver(s)) return;
    }
  };
  fire(s.lasting.filter((l) => counts(l) && l.kind !== 'draw' && l.turns <= 1).sort(newestFirst));
  if (isOver(s)) return;
  const ticked = s.lasting.filter(counts);
  for (const l of ticked) l.turns -= 1;
  if (ticked.length > 0) ctx.events.push({ type: 'LastingTicked', player, seqs: ticked.map((l) => l.seq) });
  fire(s.lasting.filter((l) => counts(l) && l.kind === 'draw' && l.turns <= 0).sort(newestFirst));
}

/**
 * 重ねがけ禁止（SPEC §4-7）：このターンに使われたアイテム（used）の中に、blocked の id のものがあれば、そのカードNo。無ければ null
 */
export function blockedItemOn(s: GameState, blocked: string[] | undefined, used: number[]): number | null {
  if (!blocked || blocked.length === 0) return null;
  for (const no of used) if (blocked.includes(s.cardDefs[no]?.id)) return no;
  return null;
}

/** ひみつのやいば・きみょうなドリンクなど「このターン」だけの効果を消す */
function clearTurnBuffs(ctx: Ctx): void {
  for (const c of Object.values(ctx.s.cards)) {
    c.itemsThisTurn = [];
    if (c.attackAdd === 0 && c.attackOverride === null) continue;
    c.attackAdd = 0;
    c.attackOverride = null;
    ctx.events.push({ type: 'BuffChanged', uid: c.uid, attackAdd: 0, attackOverride: null });
  }
}

/**
 * タイミング付き効果キュー（SPEC §13-3。予約）
 * 登録されたターンより後の、最初に当てはまるタイミングで1回だけ発動する。
 */
function processScheduled(ctx: Ctx, point: 'start' | 'end', player: Side): void {
  const { s } = ctx;
  const due = s.scheduled.filter((e) => e.createdTurn < s.turnNumber && matches(e, point, player));
  if (due.length === 0) return;
  s.scheduled = s.scheduled.filter((e) => !due.includes(e));
  for (const e of due) {
    runEffect(ctx, e.effect, { kind: 'scheduled', player: e.owner, sourceUid: e.sourceUid });
    if (isOver(s)) return;
  }
}

function matches(e: ScheduledEffect, point: 'start' | 'end', player: Side): boolean {
  const self = e.owner === player;
  if (point === 'start') return e.timing === (self ? 'selfTurnStart' : 'opponentTurnStart');
  return e.timing === (self ? 'selfTurnEnd' : 'opponentTurnEnd');
}
