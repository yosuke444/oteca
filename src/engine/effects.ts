import { type Ctx, dealDamage, discardCards, drawOne, heal, isInPlay, isOver, other, setHp } from './core';
import { shuffleInPlace } from './rng';
import type {
  CardInstance,
  Effect,
  EffectSourceData,
  EffectType,
  GameState,
  Lasting,
  PendingChoice,
  QueuedEffect,
  Side,
} from './types';

/**
 * 効果の登録表（SPEC §13-3 効果の登録制・§4-5・§5-3）
 * 新しい効果タイプは、types.ts の Effect に1行足して、ここに処理を1つ追加するだけで済む。
 * カード名で個別の処理は書かない（どのカードも効果データの組み合わせ）。
 */

/** 効果がどこから出たか */
export type EffectSource = EffectSourceData;

type Handler<T extends EffectType> = (ctx: Ctx, effect: Extract<Effect, { type: T }>, src: EffectSource) => void;

export const effectHandlers: { [T in EffectType]: Handler<T> } = {
  /** 相手のバトル場にダメージ（技なら §4-5 ④の計算。0 なら何もしない） */
  damage(ctx, effect, src) {
    const target = ctx.s.players[other(src.player)].active;
    if (!target) return;
    const amount = src.kind === 'move' ? moveDamage(ctx.s, ctx.s.cards[src.sourceUid], effect.amount) : effect.amount;
    if (amount <= 0) return;
    dealDamage(ctx, target, amount, src.player);
  },

  /** 回復（技なら自分自身、アイテムなら選んだ対象）。999 は最大まで（最大HPを超えないので同じ） */
  heal(ctx, effect, src) {
    if (effect.amount <= 0) return;
    heal(ctx, targetOf(src), effect.amount);
  },

  /** 技を使ったおてあげ自身にダメージ。きぜつしたら相手の手柄（SPEC §4-5 ③） */
  selfDamage(ctx, effect, src) {
    const c = ctx.s.cards[src.sourceUid];
    if (!c || effect.amount <= 0) return;
    dealDamage(ctx, c.uid, effect.amount, other(c.owner));
  },

  /** 山札から引く（山札が0なら引けないだけ） */
  draw(ctx, effect, src) {
    for (let i = 0; i < effect.count; i++) drawOne(ctx, src.player);
  },

  /** 手札から選んで捨てる（SPEC §4-5 ⑤） */
  discard(ctx, effect, src) {
    const ps = ctx.s.players[src.player];
    if (effect.count <= 0) return;
    if (ps.hand.length === 0) {
      // 手札が0なら山札の一番上（山札も0なら捨てない）
      if (effect.deckIfNoHand && ps.deck.length > 0) discardCards(ctx, src.player, [ps.deck[0]], true);
      return;
    }
    // 手札が捨てる枚数以下なら、選ばずに全部
    if (ps.hand.length <= effect.count) {
      discardCards(ctx, src.player, [...ps.hand], false);
      return;
    }
    requestChoice(ctx, { player: src.player, kind: 'discard', count: effect.count, options: [...ps.hand], sourceUid: src.sourceUid });
  },

  /** 技を使ったおてあげをベンチと交代：2体なら選ぶ・1体なら自動・0体なら何もしない（SPEC §4-5 ⑤） */
  switchWithBench(ctx, _effect, src) {
    const ps = ctx.s.players[src.player];
    // 技を使ったおてあげがバトル場にいない（自分へのダメージできぜつした等）なら行わない
    if (ps.active !== src.sourceUid || ps.bench.length === 0) return;
    if (ps.bench.length === 1) {
      switchByEffect(ctx, src.player, ps.bench[0]);
      return;
    }
    requestChoice(ctx, { player: src.player, kind: 'switch', count: 1, options: [...ps.bench], sourceUid: src.sourceUid });
  },

  /** 時限のきぜつは「登録」だけ（registerLasting）。今すぐは何もしない */
  faintLater() {},

  /** 山札から選んで手札に加え、山札を切る（ひきかえカード） */
  search(ctx, effect, src) {
    const ps = ctx.s.players[src.player];
    if (ps.deck.length === 0 || effect.count <= 0) return;
    if (ps.deck.length <= effect.count) {
      takeFromDeck(ctx, src.player, [...ps.deck], src.sourceUid);
      return;
    }
    requestChoice(ctx, { player: src.player, kind: 'search', count: effect.count, options: [...ps.deck], sourceUid: src.sourceUid });
  },

  /** このターンのダメージ加算（重ね掛け可） */
  addAttack(ctx, effect, src) {
    const c = ctx.s.cards[targetOf(src)];
    if (!c || !isInPlay(ctx.s, c.uid)) return;
    c.attackAdd += effect.amount;
    pushBuff(ctx, c);
  },

  /** HPを指定の値にする */
  setHp(ctx, effect, src) {
    setHp(ctx, targetOf(src), effect.value);
  },

  /** 予約：このターンのダメージ上書き */
  overrideAttack(ctx, effect, src) {
    const c = ctx.s.cards[targetOf(src)];
    if (!c || !isInPlay(ctx.s, c.uid)) return;
    c.attackOverride = effect.value;
    pushBuff(ctx, c);
  },

  /** 予約：タイミング付き効果キューに積む（発動は engine.ts の processScheduled） */
  scheduled(ctx, effect, src) {
    ctx.s.scheduled.push({
      owner: src.player,
      timing: effect.timing,
      effect: effect.effect,
      sourceUid: src.sourceUid,
      createdTurn: ctx.s.turnNumber,
    });
  },
};

/** 効果を1つ実行する（決着後は何もしない） */
export function runEffect(ctx: Ctx, effect: Effect, src: EffectSource): void {
  if (isOver(ctx.s)) return;
  const handler = effectHandlers[effect.type] as Handler<EffectType>;
  handler(ctx, effect, src);
}

/**
 * 持続効果・時限の登録（SPEC §4-5 ①②・処理順の6）。
 * then[i] は (i+1) 回後。0 の回は登録しない。
 */
export function registerLasting(ctx: Ctx, effect: Effect, src: EffectSource): void {
  if (isOver(ctx.s)) return;
  const add = (kind: Lasting['kind'], amount: number, targetUid: string | null, timing: Lasting['timing'], skip: number) => {
    const lasting: Lasting = { owner: src.player, kind, amount, targetUid, timing, skip, sourceUid: src.sourceUid, createdTurn: ctx.s.turnNumber };
    ctx.s.lasting.push(lasting);
    ctx.events.push({ type: 'LastingAdded', lasting: { ...lasting } });
  };
  const each = (then: number[] | undefined, fn: (amount: number, skip: number) => void) => {
    (then ?? []).forEach((amount, i) => {
      if (amount > 0) fn(amount, i);
    });
  };
  const hit = src.hitUid ?? null;
  // 付く先のおてあげが場にいなければ（すでにきぜつした等）付けない
  const alive = (uid: string | null) => uid !== null && isInPlay(ctx.s, uid);
  switch (effect.type) {
    case 'damage':
      if (alive(hit)) each(effect.then, (a, skip) => add('damage', a, hit, 'opponentTurnEnd', skip));
      break;
    case 'heal':
      if (alive(src.sourceUid)) each(effect.then, (a, skip) => add('heal', a, src.sourceUid, 'ownerTurnEnd', skip));
      break;
    case 'selfDamage':
      if (alive(src.sourceUid)) each(effect.then, (a, skip) => add('selfDamage', a, src.sourceUid, 'ownerTurnEnd', skip));
      break;
    case 'draw':
      each(effect.then, (a, skip) => add('draw', a, null, 'ownerTurnEnd', skip));
      break;
    case 'faintLater':
      if (alive(hit) && effect.after >= 1) add('faint', 0, hit, 'opponentTurnEnd', effect.after - 1);
      break;
    default:
      break;
  }
}

/** 持続効果・時限を1つ発動する（SPEC §4-5 ②③） */
export function fireLasting(ctx: Ctx, l: Lasting): void {
  const { s } = ctx;
  if (isOver(s)) return;
  if (l.targetUid !== null && !isInPlay(s, l.targetUid)) return;
  ctx.events.push({ type: 'LastingFired', lasting: { ...l } });
  switch (l.kind) {
    case 'damage':
      // 倒した数は付けたプレイヤーに
      dealDamage(ctx, l.targetUid as string, l.amount, l.owner);
      break;
    case 'heal':
      heal(ctx, l.targetUid as string, l.amount);
      break;
    case 'selfDamage':
      // 自分へのダメージは、いつでも相手の手柄
      dealDamage(ctx, l.targetUid as string, l.amount, other(s.cards[l.targetUid as string].owner));
      break;
    case 'draw':
      for (let i = 0; i < l.amount; i++) drawOne(ctx, l.owner);
      break;
    case 'faint': {
      const c = s.cards[l.targetUid as string];
      // 時限が来た時に生きていれば、HPに関係なくきぜつ（倒した数はばくだんの持ち主に）
      dealDamage(ctx, c.uid, c.hp, l.owner);
      break;
    }
  }
}

/**
 * 効果の列を順に行う。カードを選ぶ必要が出たら、残りを pendingChoice に預けて止める。
 * @returns 止まった（選ぶ待ち）なら true
 */
export function runQueue(ctx: Ctx, queue: QueuedEffect[], after: PendingChoice['after']): boolean {
  const rest = [...queue];
  while (rest.length > 0) {
    if (isOver(ctx.s)) return false;
    const q = rest.shift() as QueuedEffect;
    if (q.stage === 'register') registerLasting(ctx, q.effect, q.src);
    else runEffect(ctx, q.effect, q.src);
    const pc = ctx.s.pendingChoice;
    if (pc && !isOver(ctx.s)) {
      pc.rest = rest;
      pc.after = after;
      ctx.s.phase = 'choose';
      ctx.events.push({ type: 'ChoiceNeeded', player: pc.player, kind: pc.kind, count: pc.count });
      return true;
    }
  }
  return false;
}

/** 選んだカードで、選ぶ待ちを片付ける（検証は engine.ts の validateAction で済んでいる） */
export function applyChoice(ctx: Ctx, uids: string[]): void {
  const pc = ctx.s.pendingChoice;
  if (!pc) return;
  ctx.s.pendingChoice = null;
  if (pc.kind === 'discard') discardCards(ctx, pc.player, uids, false);
  else if (pc.kind === 'search') takeFromDeck(ctx, pc.player, uids, pc.sourceUid);
  else if (pc.kind === 'switch') switchByEffect(ctx, pc.player, uids[0]);
}

/**
 * 技のダメージ計算（SPEC §4-5 ④）
 * 1. 基本値（今すぐの分）→ 2. 基本値が1以上なら + このターンの加算（やいば・ドリンク）→ 3. 基本値が1以上なら + ルール補正
 * （置き換え attackOverride は予約。どのカードも使わない）
 * 画面の「このターン出る数値」の表示にも使う。
 */
export function moveDamage(s: GameState, attacker: CardInstance, base: number): number {
  const b = attacker.attackOverride ?? base;
  if (b <= 0) return 0;
  return Math.max(0, b + attacker.attackAdd + s.rules[attacker.owner].attackBonus);
}

function requestChoice(ctx: Ctx, c: Omit<PendingChoice, 'rest' | 'after'>): void {
  ctx.s.pendingChoice = { ...c, rest: [], after: { kind: 'main' } };
}

/** 山札から手札へ加え、山札を切る */
function takeFromDeck(ctx: Ctx, player: Side, uids: string[], sourceUid: string): void {
  const ps = ctx.s.players[player];
  ps.deck = ps.deck.filter((u) => !uids.includes(u));
  ps.hand.push(...uids);
  ctx.events.push({ type: 'Searched', player, uids: [...uids], sourceUid });
  shuffleInPlace(ctx.s.rng, ps.deck);
  ctx.events.push({ type: 'DeckShuffled', player });
}

/** 技の効果で交代（交代の制限・「交代したターンは攻撃できない」の対象外） */
function switchByEffect(ctx: Ctx, player: Side, benchUid: string): void {
  const ps = ctx.s.players[player];
  const oldActive = ps.active;
  const i = ps.bench.indexOf(benchUid);
  if (!oldActive || i < 0) return;
  ps.bench[i] = oldActive;
  ps.active = benchUid;
  ctx.s.cards[benchUid].benchedOnTurn = null;
  ctx.events.push({ type: 'Swapped', player, toActive: benchUid, toBench: oldActive, byEffect: true });
}

function targetOf(src: EffectSource): string {
  return src.targetUid ?? src.sourceUid;
}

function pushBuff(ctx: Ctx, c: CardInstance): void {
  ctx.events.push({ type: 'BuffChanged', uid: c.uid, attackAdd: c.attackAdd, attackOverride: c.attackOverride });
}
