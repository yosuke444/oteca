import { CARD_DB } from '../data/cards';
import type { CardDb, GameState, Side } from '../engine/types';
import { type Rand, pick, shuffle } from './random';

/**
 * ズルの禁止（SPEC §13-5）：CPU が考える前に、見えない情報を「ありうる並び」に仮に決め直す。
 * - 相手の手札・山札の中身 … 見えている相手のカードと、全部のカードの中から、ありうるものを選んで入れる
 * - 自分の山札の順番 … 混ぜ直す（中身は自分のデッキなので知っていてよい）
 * - この先のサイコロ（乱数の状態） … 知らない種に変える。デバッグ用の固定の目も消す
 * CPU の考え（brains.ts）は、この関数を通した状態しか見ない。だから元の状態の見えない部分を変えても、同じ手を選ぶ。
 */
export function determinize(state: GameState, side: Side, rand: Rand, db: CardDb = CARD_DB): GameState {
  const s = structuredClone(state);
  const opp: Side = side === 'p1' ? 'p2' : 'p1';
  const op = s.players[opp];

  // 相手の見えているカード（場・すてふだ）
  const seenNos = [op.active, ...op.bench, ...op.discard].filter((u): u is string => u !== null).map((u) => s.cards[u].no);
  const seenSuper = seenNos.some((no) => isSuper(db, no));
  // ありうるカード：全部のカード（見えているカードは多めに）。スーパーはデッキに1枚までなので、見えていたらもう入れない
  const pool: number[] = [];
  for (const def of Object.values(db)) {
    if (isSuper(db, def.no) && seenSuper) continue;
    pool.push(def.no);
  }
  for (const no of seenNos) if (!(isSuper(db, no) && seenSuper)) pool.push(no, no);
  const otegePool = pool.filter((no) => db[no].kind === 'otege');

  let superUsed = seenSuper;
  // 見えないカードの並び順も情報なので、uid の順に並べ直してから決める（元の並びに左右されないように）
  const byUid = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  op.deck.sort(byUid);
  op.hand.sort(byUid);
  const hidden = [...op.hand, ...op.deck];
  for (const uid of hidden) {
    // 準備で裏向きに出したカードは おてあげ
    const from = uid === op.setupChoice ? otegePool : pool;
    let no = pick(rand, from);
    if (isSuper(db, no)) {
      if (superUsed) no = pick(rand, from.filter((n) => !isSuper(db, n)));
      superUsed = true;
    }
    const def = db[no];
    s.cardDefs[no] = def;
    const hp = def.kind === 'otege' ? def.hp : 0;
    s.cards[uid] = { uid, no, owner: opp, hp, maxHp: hp, attackAdd: 0, attackOverride: null, itemsThisTurn: [], benchedOnTurn: null };
  }
  // 引き直しの規則があるので、相手の手札におてあげが1枚も無いことはない（準備中だけ気にする）
  if (s.phase === 'setup' && op.setupChoice === null && op.hand.length > 0 && !op.hand.some((u) => s.cardDefs[s.cards[u].no].kind === 'otege')) {
    const uid = op.hand[0];
    const no = pick(rand, otegePool.filter((n) => !isSuper(db, n)));
    const def = db[no];
    s.cardDefs[no] = def;
    const hp = def.kind === 'otege' ? def.hp : 0;
    s.cards[uid] = { uid, no, owner: opp, hp, maxHp: hp, attackAdd: 0, attackOverride: null, itemsThisTurn: [], benchedOnTurn: null };
  }

  shuffle(rand, s.players[side].deck.sort(byUid));
  shuffle(rand, op.deck);
  s.rng = [u32(rand), u32(rand), u32(rand), u32(rand) | 1];
  s.forcedDice = [];
  s.fixedDie = null;
  return s;
}

function isSuper(db: CardDb, no: number): boolean {
  const d = db[no];
  return d.kind === 'otege' && d.rarity === 'super';
}

function u32(rand: Rand): number {
  return Math.floor(rand() * 2 ** 32) >>> 0;
}
