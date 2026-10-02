import { decide } from '../src/cpu/brains';
import { seededRand } from '../src/cpu/random';
import { CARD_DB, CARD_LIST } from '../src/data/cards';
import { classicDeckNos } from '../src/data/starterDeck';
import { type GameState, type Side, applyAction, createGame } from '../src/engine';

/** CPU のテスト（cpu.levels.test.ts・cpu.levels.slow.test.ts）で共通に使うもの */

export const decks = { p1: classicDeckNos(), p2: classicDeckNos() };
/** テストを速くするため、さいきょうの試算は少なめ（止まらないことの確認だけ。本物の回数の確認は npm run ladder） */
export const FAST = { maxRollouts: 6, timeMs: 1e9 };

/** 試合の途中の状態をいくつか集める（つよい同士で進めて、手番の人が操作する場面） */
export function midGameStates(): { state: GameState; side: Side }[] {
  const out: { state: GameState; side: Side }[] = [];
  // 準備中の場面（相手が裏向きでバトル場を選んだ後に、こちらが選ぶ）も入れる
  for (let g = 0; g < 4; g++) {
    let { state } = createGame({ seed: `c02-setup-${g}`, decks, cardDb: CARD_DB, forcedDice: [6, 1] });
    state = applyAction(state, decide('strong', state, 'p2', seededRand(g))!).state;
    out.push({ state, side: 'p1' });
  }
  for (let g = 0; g < 6; g++) {
    let { state } = createGame({ seed: `c02-${g}`, decks, cardDb: CARD_DB, forcedDice: [6, 1] });
    const rand = seededRand(g + 100);
    for (let step = 0; step < 60 && state.phase !== 'over'; step++) {
      const who: Side = state.phase === 'setup' ? (state.players.p1.setupChoice === null ? 'p1' : 'p2') : state.phase === 'promote' ? state.pendingPromote[0] : state.currentPlayer;
      if (state.phase === 'main' && step % 7 === 3) out.push({ state, side: who });
      state = applyAction(state, decide('strong', state, who, rand)!).state;
    }
  }
  return out;
}

/** 見えない情報だけを変える：相手の手札・山札の中身と順番、自分の山札の順番、この先のサイコロ */
export function tamper(s: GameState, side: Side, k: number): GameState {
  const t = structuredClone(s);
  const opp: Side = side === 'p1' ? 'p2' : 'p1';
  const nos = CARD_LIST.map((c) => c.no);
  for (const uid of [...t.players[opp].hand, ...t.players[opp].deck]) {
    let no = nos[(nos.indexOf(t.cards[uid].no) + k + 3) % nos.length];
    // 裏向きで選んだバトル場は おてあげのまま（ルール上ありうる形にする）
    if (uid === t.players[opp].setupChoice && CARD_DB[no].kind !== 'otege') no = t.cards[uid].no === nos[0] ? nos[1] : nos[0];
    const def = CARD_DB[no];
    t.cardDefs[no] = def;
    const hp = def.kind === 'otege' ? def.hp : 0;
    t.cards[uid] = { ...t.cards[uid], no, hp, maxHp: hp };
  }
  t.players[opp].deck.reverse();
  t.players[opp].hand.reverse();
  t.players[side].deck.reverse();
  t.rng = [k + 1, k + 2, k + 3, k + 4];
  t.forcedDice = [((k * 5) % 6) + 1];
  return t;
}
