import {
  type Ctx,
  SIDES,
  defOf,
  drawOne,
  endGame,
  isOver,
  other,
  otegeDefOf,
  promote,
  rollDie,
} from './core';
import { runEffect } from './effects';
import type { Action, ApplyResult, GameState, RejectReason, Resume, ScheduledEffect, Side } from './types';

/**
 * ルールエンジンの入口（SPEC §4, §11-3）
 * applyAction(state, action) → { state, events }
 * 同じ状態に同じ操作を渡せば、必ず同じ結果になる（決定論）。
 * 自分の操作も相手の操作も、ここを通す。
 */
export function applyAction(state: GameState, action: Action): ApplyResult {
  const rejected = validateAction(state, action);
  if (rejected) return { state, events: [], rejected };

  const ctx: Ctx = { s: structuredClone(state), events: [] };
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
      const target = s.cards[action.targetUid];
      const targetDef = otegeDefOf(s, action.targetUid);
      if (!target || !targetDef) return 'badTarget';
      // 今回のアイテムは全部「自分のおてあげ」が対象
      if (item.target.side === 'self' && target.owner !== p) return 'badTarget';
      const zone = ps.active === target.uid ? 'active' : ps.bench.includes(target.uid) ? 'bench' : null;
      if (!zone || !item.target.zones.includes(zone)) return 'badTarget';
      if (!item.target.rarity.includes(targetDef.rarity)) return 'badTarget';
      if (item.useCondition === 'notFullHp' && target.hp >= target.maxHp) return 'fullHp';
      return null;
    }

    case 'SWAP':
      if (!ps.active) return 'noActive';
      if (!ps.bench.includes(action.benchUid)) return 'notOnBench';
      return null;

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
  } else if (s.phase === 'main' && s.currentPlayer === player) {
    const field = [ps.active, ...ps.bench].filter((u): u is string => u !== null);
    for (const uid of ps.hand) {
      candidates.push({ type: 'PLACE_BENCH', player, uid });
      for (const targetUid of field) candidates.push({ type: 'USE_ITEM', player, uid, targetUid });
    }
    for (const uid of ps.bench) candidates.push({ type: 'SWAP', player, benchUid: uid });
    candidates.push({ type: 'END_TURN', player });
  }
  return candidates.filter((a) => validateAction(s, a) === null);
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
  ctx.events.push({ type: 'BenchPlaced', player, uid });
}

function doUseItem(ctx: Ctx, player: Side, itemUid: string, targetUid: string): void {
  const ps = ctx.s.players[player];
  const item = defOf(ctx.s, itemUid);
  if (!item || item.kind !== 'item') return;
  ps.hand = ps.hand.filter((u) => u !== itemUid);
  ps.discard.push(itemUid);
  ctx.events.push({ type: 'ItemUsed', player, itemUid, targetUid });
  for (const effect of item.effects) {
    runEffect(ctx, effect, { kind: 'item', player, sourceUid: itemUid, targetUid });
  }
}

function doSwap(ctx: Ctx, player: Side, benchUid: string): void {
  const ps = ctx.s.players[player];
  const oldActive = ps.active as string;
  const i = ps.bench.indexOf(benchUid);
  ps.bench[i] = oldActive;
  ps.active = benchUid;
  ps.swappedThisTurn = true;
  ctx.events.push({ type: 'Swapped', player, toActive: benchUid, toBench: oldActive });
}

function doPromote(ctx: Ctx, player: Side, benchUid: string): void {
  const { s } = ctx;
  promote(ctx, player, benchUid);
  s.pendingPromote = s.pendingPromote.filter((p) => p !== player);
  if (s.pendingPromote.length > 0) return;
  resume(ctx);
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

/** [3] ターン終了：攻撃 → タイミング付き効果 → 「このターン」の効果を消す → 相手のターンへ */
function doEndTurn(ctx: Ctx, player: Side): void {
  const { s } = ctx;
  const ps = s.players[player];
  const attacked = !ps.swappedThisTurn;
  if (attacked) attack(ctx, player);
  if (isOver(s)) return;

  processScheduled(ctx, 'end', player);
  if (isOver(s)) return;

  clearTurnBuffs(ctx);
  ctx.events.push({ type: 'TurnEnded', player, attacked });

  const next = other(player);
  if (pauseForPromote(ctx, { kind: 'startTurn', player: next })) return;
  startTurn(ctx, next);
}

/** サイコロを振り、バトル場のおてあげの技を使う */
function attack(ctx: Ctx, player: Side): void {
  const { s } = ctx;
  const uid = s.players[player].active;
  if (!uid) return;
  const def = otegeDefOf(s, uid);
  if (!def) return;
  const value = rollDie(ctx, 'attack', player);
  const moveIndex = def.moves.findIndex((m) => m.faces.includes(value));
  if (moveIndex < 0) return;
  ctx.events.push({ type: 'MoveSelected', uid, moveIndex });
  for (const effect of def.moves[moveIndex].effects) {
    runEffect(ctx, effect, { kind: 'move', player, sourceUid: uid });
    if (isOver(s)) return;
  }
}

/** ひみつのやいば・きみょうなドリンクなど「このターン」だけの効果を消す */
function clearTurnBuffs(ctx: Ctx): void {
  for (const c of Object.values(ctx.s.cards)) {
    if (c.attackAdd === 0 && c.attackOverride === null) continue;
    c.attackAdd = 0;
    c.attackOverride = null;
    ctx.events.push({ type: 'BuffChanged', uid: c.uid, attackAdd: 0, attackOverride: null });
  }
}

/**
 * タイミング付き効果キュー（SPEC §13-3）
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
