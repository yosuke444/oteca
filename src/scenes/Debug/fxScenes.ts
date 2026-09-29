import { CARD_DB } from '../../data/cards';
import { BIG_DAMAGE, createGame } from '../../engine';
import type { CardDef, GameEvent, GameState, OtegeCardDef, Side } from '../../engine/types';
import { itemFxKind } from '../../fx/itemFx';
import { applyEventToView } from '../../fx/viewReducer';

/**
 * デバッグ画面の「演出テスト」（SPEC §9 の表の各行を、ボタンひとつで再生する）
 * 見本の盤面を作り、各場面のイベント列を用意する。数値はカードデータから取る（コードに直接書かない）。
 */

export type FxScene = {
  id: string;
  label: string;
  /** 再生する前の盤面（省略時は見本の盤面） */
  pre?: (s: GameState) => GameState;
  events: (s: GameState) => GameEvent[];
};

const allNos = Object.values(CARD_DB)
  .map((d) => d.no)
  .sort((a, b) => a - b);
const otegeNos = allNos.filter((no) => CARD_DB[no].kind === 'otege' && CARD_DB[no].rarity === 'normal');
const itemNo = (kind: string) => allNos.find((no) => CARD_DB[no].kind === 'item' && itemFxKind(CARD_DB[no]) === kind);

/** 見本の盤面：p1 の3ターンめ。両者にバトル場とベンチ、p1 の手札におてあげ1枚とアイテム4種 */
export function fxFixture(): GameState {
  const deckP1 = [...otegeNos.slice(0, 4), ...(['heal', 'power', 'weird', 'bigHeal'].map(itemNo).filter((n): n is number => n !== undefined)), ...otegeNos.slice(0, 4)];
  const deckP2 = [...otegeNos.slice(2, 6), ...allNos.filter((no) => CARD_DB[no].kind === 'item'), ...otegeNos.slice(0, 3)];
  const s = structuredClone(createGame({ seed: 'fx-gallery', decks: { p1: deckP1, p2: deckP2 }, cardDb: CARD_DB, forcedDice: [6, 1] }).state);
  const uidsOf = (side: Side) => Object.values(s.cards).filter((c) => c.owner === side).map((c) => c.uid);
  const isOtege = (uid: string) => s.cardDefs[s.cards[uid].no].kind === 'otege';
  for (const side of ['p1', 'p2'] as const) {
    const all = uidsOf(side);
    const oteges = all.filter(isOtege);
    const items = all.filter((u) => !isOtege(u));
    const ps = s.players[side];
    ps.active = oteges[0];
    ps.bench = side === 'p1' ? [oteges[1]] : [oteges[1], oteges[2]];
    ps.hand = side === 'p1' ? [oteges[2], ...items.slice(0, 4)] : items.slice(0, 4);
    const used = new Set([ps.active, ...ps.bench, ...ps.hand]);
    ps.deck = all.filter((u) => !used.has(u));
    ps.discard = [];
    ps.turnCount = 2;
    ps.setupChoice = null;
    ps.benchPlacedThisTurn = 0;
    ps.swappedThisTurn = false;
  }
  // 少し減ったHP（回復が見えるように）
  const p1a = s.cards[s.players.p1.active!];
  p1a.hp = Math.max(10, Math.round(p1a.maxHp * 0.5 / 10) * 10);
  const p1b = s.cards[s.players.p1.bench[0]];
  p1b.hp = Math.max(10, Math.round(p1b.maxHp * 0.3 / 10) * 10);
  s.players.p1.koCount = 1;
  s.phase = 'main';
  s.currentPlayer = 'p1';
  s.turnNumber = 5;
  s.firstPlayer = 'p1';
  return s;
}

const defOf = (s: GameState, uid: string): CardDef => s.cardDefs[s.cards[uid].no];
const otegeDef = (s: GameState, uid: string) => defOf(s, uid) as OtegeCardDef;

/** そのおてあげの技から、条件に合う技（目・番号・量） */
function pickMove(s: GameState, uid: string, want: 'damage' | 'heal' | 'big') {
  const def = otegeDef(s, uid);
  const list = def.moves.map((m, i) => ({ i, face: m.faces[0], e: m.effects[0] }));
  const found =
    want === 'heal'
      ? list.find((m) => m.e.type === 'heal')
      : want === 'big'
        ? [...list].filter((m) => m.e.type === 'damage').sort((a, b) => ('amount' in b.e ? b.e.amount : 0) - ('amount' in a.e ? a.e.amount : 0))[0]
        : list.find((m) => m.e.type === 'damage');
  const m = found ?? list[0];
  return { moveIndex: m.i, face: m.face, amount: 'amount' in m.e ? m.e.amount : 0 };
}

/** 一番大きいダメージ技を持つ通常おてあげ（大ダメージの見本） */
function bigHitter(s: GameState): string {
  const cands = [s.players.p1.active!, ...s.players.p1.bench, ...s.players.p1.hand].filter((u) => defOf(s, u).kind === 'otege');
  return cands.sort((a, b) => pickMove(s, b, 'big').amount - pickMove(s, a, 'big').amount)[0];
}

/** p1 のバトル場を入れかえる（大ダメージ・回復技の見本用） */
function withActive(s: GameState, uid: string): GameState {
  const v = structuredClone(s);
  const ps = v.players.p1;
  if (ps.active === uid) return v;
  const old = ps.active!;
  ps.hand = ps.hand.map((u) => (u === uid ? old : u));
  ps.bench = ps.bench.map((u) => (u === uid ? old : u));
  ps.active = uid;
  return v;
}

function healer(s: GameState): string | null {
  return [s.players.p1.active!, ...s.players.p1.bench, ...s.players.p1.hand].find((u) => defOf(s, u).kind === 'otege' && otegeDef(s, u).moves.some((m) => m.effects.some((e) => e.type === 'heal'))) ?? null;
}

const itemIn = (s: GameState, kind: string) => s.players.p1.hand.find((u) => defOf(s, u).kind === 'item' && itemFxKind(defOf(s, u)) === kind)!;

function attack(s: GameState, uid: string, want: 'damage' | 'heal' | 'big'): GameEvent[] {
  const m = pickMove(s, uid, want);
  return [
    { type: 'DiceRolled', purpose: 'attack', player: 'p1', value: m.face },
    { type: 'MoveSelected', uid, moveIndex: m.moveIndex },
  ];
}

export const FX_SCENES: FxScene[] = [
  {
    id: 'order',
    label: 'せんこう きめ',
    events: () => [
      { type: 'DiceRolled', purpose: 'order', player: 'p1', value: 3 },
      { type: 'DiceRolled', purpose: 'order', player: 'p2', value: 3 },
      { type: 'DiceRolled', purpose: 'order', player: 'p1', value: 5 },
      { type: 'DiceRolled', purpose: 'order', player: 'p2', value: 2 },
    ],
  },
  { id: 'mulligan', label: 'ひきなおし', events: () => [{ type: 'Mulligan', player: 'p1' }, { type: 'Mulligan', player: 'p2' }] },
  {
    id: 'reveal',
    label: 'バトルば オープン',
    pre: (s) => {
      const v = structuredClone(s);
      for (const side of ['p1', 'p2'] as const) {
        v.players[side].hand.unshift(v.players[side].active!);
        v.players[side].active = null;
      }
      v.phase = 'setup';
      return v;
    },
    events: (s) => [{ type: 'ActivesRevealed', p1: s.players.p1.hand[0], p2: s.players.p2.hand[0] }],
  },
  { id: 'turn', label: 'ターン かいし', events: () => [{ type: 'TurnStarted', player: 'p1', turn: 3 }] },
  { id: 'turnOpp', label: 'あいての ターン', events: () => [{ type: 'TurnStarted', player: 'p2', turn: 3 }] },
  { id: 'draw', label: 'ドロー', events: (s) => [{ type: 'TurnStarted', player: 'p1', turn: 3 }, { type: 'Drew', player: 'p1', uid: s.players.p1.deck[0] }] },
  { id: 'bench', label: 'ベンチに だす', events: (s) => [{ type: 'BenchPlaced', player: 'p1', uid: s.players.p1.hand[0] }] },
  { id: 'benchOpp', label: 'あいての ベンチ', pre: (s) => { const v = structuredClone(s); v.players.p2.hand.push(v.players.p2.bench.pop()!); return v; }, events: (s) => [{ type: 'BenchPlaced', player: 'p2', uid: s.players.p2.hand.at(-1)! }] },
  { id: 'swap', label: 'こうたい', events: (s) => [{ type: 'Swapped', player: 'p1', toActive: s.players.p1.bench[0], toBench: s.players.p1.active! }] },
  {
    id: 'kusuri',
    label: 'アイテム かいふく',
    events: (s) => {
      const target = s.players.p1.active!;
      const amount = (defOf(s, itemIn(s, 'heal')) as { effects: { type: string; amount?: number }[] }).effects.find((e) => e.type === 'heal')?.amount ?? 0;
      const hp = Math.min(s.cards[target].maxHp, s.cards[target].hp + amount);
      return [
        { type: 'ItemUsed', player: 'p1', itemUid: itemIn(s, 'heal'), targetUid: target },
        { type: 'Healed', uid: target, amount: hp - s.cards[target].hp, hpAfter: hp },
      ];
    },
  },
  {
    id: 'yaiba',
    label: 'アイテム ＋こうげき',
    events: (s) => {
      const target = s.players.p1.active!;
      const add = (defOf(s, itemIn(s, 'power')) as { effects: { type: string; amount?: number }[] }).effects.find((e) => e.type === 'addAttack')?.amount ?? 0;
      return [
        { type: 'ItemUsed', player: 'p1', itemUid: itemIn(s, 'power'), targetUid: target },
        { type: 'BuffChanged', uid: target, attackAdd: add, attackOverride: null },
      ];
    },
  },
  {
    id: 'drink',
    label: 'アイテム ふしぎ',
    events: (s) => {
      const target = s.players.p1.active!;
      const eff = (defOf(s, itemIn(s, 'weird')) as { effects: { type: string; value?: number }[] }).effects;
      return [
        { type: 'ItemUsed', player: 'p1', itemUid: itemIn(s, 'weird'), targetUid: target },
        { type: 'HpSet', uid: target, hpAfter: eff.find((e) => e.type === 'setHp')?.value ?? 1 },
        { type: 'BuffChanged', uid: target, attackAdd: 0, attackOverride: eff.find((e) => e.type === 'overrideAttack')?.value ?? null },
      ];
    },
  },
  {
    id: 'spodori',
    label: 'アイテム だいかいふく',
    events: (s) => {
      const target = s.players.p1.bench[0];
      const amount = (defOf(s, itemIn(s, 'bigHeal')) as { effects: { type: string; amount?: number }[] }).effects.find((e) => e.type === 'heal')?.amount ?? 0;
      const hp = Math.min(s.cards[target].maxHp, s.cards[target].hp + amount);
      return [
        { type: 'ItemUsed', player: 'p1', itemUid: itemIn(s, 'bigHeal'), targetUid: target },
        { type: 'Healed', uid: target, amount: hp - s.cards[target].hp, hpAfter: hp },
      ];
    },
  },
  { id: 'dice', label: 'サイコロ', events: (s) => attack(s, s.players.p1.active!, 'damage') },
  {
    id: 'hit',
    label: 'ダメージ 小',
    events: (s) => {
      const t = s.players.p2.active!;
      const m = pickMove(s, s.players.p1.active!, 'damage');
      const amount = Math.min(m.amount, BIG_DAMAGE - 10);
      return [...attack(s, s.players.p1.active!, 'damage'), { type: 'Damaged', uid: t, amount, hpAfter: Math.max(0, s.cards[t].hp - amount), big: false }];
    },
  },
  {
    id: 'bigHit',
    label: 'ダメージ 大',
    pre: (s) => withActive(s, bigHitter(s)),
    events: (s) => {
      const t = s.players.p2.active!;
      const m = pickMove(s, s.players.p1.active!, 'big');
      const amount = Math.max(m.amount, BIG_DAMAGE);
      return [...attack(s, s.players.p1.active!, 'big'), { type: 'Damaged', uid: t, amount, hpAfter: Math.max(0, s.cards[t].hp - amount), big: true }];
    },
  },
  {
    id: 'heal',
    label: 'わざの かいふく',
    pre: (s) => {
      const h = healer(s);
      return h ? withActive(s, h) : structuredClone(s);
    },
    events: (s) => {
      const uid = s.players.p1.active!;
      const m = pickMove(s, uid, 'heal');
      const hp = Math.min(s.cards[uid].maxHp, s.cards[uid].hp + m.amount);
      return [...attack(s, uid, 'heal'), { type: 'Healed', uid, amount: hp - s.cards[uid].hp, hpAfter: hp }];
    },
  },
  {
    id: 'faint',
    label: 'きぜつ',
    events: (s) => {
      const t = s.players.p2.active!;
      const m = pickMove(s, s.players.p1.active!, 'damage');
      return [
        ...attack(s, s.players.p1.active!, 'damage'),
        { type: 'Damaged', uid: t, amount: Math.max(m.amount, s.cards[t].hp), hpAfter: 0, big: m.amount >= BIG_DAMAGE },
        { type: 'Fainted', uid: t, by: 'p1', koCount: 2 },
        { type: 'NeedPromote', player: 'p2' },
      ];
    },
  },
  {
    id: 'promote',
    label: 'くりだし',
    pre: (s) => {
      const v = structuredClone(s);
      v.players.p2.discard.push(v.players.p2.active!);
      v.players.p2.active = null;
      v.phase = 'promote';
      v.pendingPromote = ['p2'];
      return v;
    },
    events: (s) => [{ type: 'Promoted', player: 'p2', uid: s.players.p2.bench[0] }],
  },
  {
    id: 'finish',
    label: 'けっちゃく',
    pre: (s) => {
      const v = withActive(s, bigHitter(s));
      v.players.p1.koCount = 2;
      return v;
    },
    events: (s) => {
      const t = s.players.p2.active!;
      const m = pickMove(s, s.players.p1.active!, 'big');
      return [
        ...attack(s, s.players.p1.active!, 'big'),
        { type: 'Damaged', uid: t, amount: Math.max(m.amount, s.cards[t].hp), hpAfter: 0, big: true },
        { type: 'Fainted', uid: t, by: 'p1', koCount: 3 },
        { type: 'GameOver', winner: 'p1', reason: 'ko' },
      ];
    },
  },
];

/** イベント列を見た目の状態に全部通した結果（演出が終わった後にそろえる状態） */
export function foldEvents(s: GameState, events: GameEvent[]): GameState {
  return events.reduce(applyEventToView, s);
}
