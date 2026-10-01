import { describe, expect, it } from 'vitest';
import { type GameState, applyAction, getLegalActions } from '../src/engine';
import { arrange, forceDice, ok, patchCard, startMain } from './helpers';

/**
 * E20 出したばかりのおてあげは交代できない（SPEC §4-4・v1.4）
 * E21 合法手に、交代できないおてあげが入らない
 */

function endTurn(state: GameState, die: number) {
  return ok(forceDice(state, die), { type: 'END_TURN', player: state.currentPlayer });
}

/** p1 のメイン：バトル場 おてあげ、手札 みつめ・おてさげ */
function setup(swapCooldownTurns?: number) {
  let s = startMain(swapCooldownTurns === undefined ? {} : { rules: { p1: { swapCooldownTurns } } });
  s = arrange(s, 'p1', { active: 'oteage', hand: ['mitsume', 'otesage'] });
  s = arrange(s, 'p2', { active: 'mutsuashi' });
  return s;
}

const swap = (s: GameState, uid: string) => applyAction(s, { type: 'SWAP', player: s.currentPlayer, benchUid: uid });
const canSwap = (s: GameState, uid: string) => getLegalActions(s, s.currentPlayer).some((a) => a.type === 'SWAP' && a.benchUid === uid);

describe('E20 出したばかりのおてあげは交代できない', () => {
  it('手札から出したターンは交代でバトル場に出せない', () => {
    let s = setup();
    const mitsume = s.players.p1.hand[0];
    s = ok(s, { type: 'PLACE_BENCH', player: 'p1', uid: mitsume }).state;
    const r = swap(s, mitsume);
    expect(r.rejected).toBe('justPlaced');
    expect(r.state).toBe(s);
    expect(canSwap(s, mitsume)).toBe(false); // E21
  });

  it('次の自分のターンからは交代できる', () => {
    let s = setup();
    const mitsume = s.players.p1.hand[0];
    s = ok(s, { type: 'PLACE_BENCH', player: 'p1', uid: mitsume }).state;
    s = endTurn(s, 4).state; // p1 → p2
    // 相手のターン中はまだ「でたばかり」のまま（相手の番なので交代自体できない）
    s = endTurn(s, 4).state; // p2 → p1
    expect(s.currentPlayer).toBe('p1');
    expect(canSwap(s, mitsume)).toBe(true);
    s = ok(s, { type: 'SWAP', player: 'p1', benchUid: mitsume }).state;
    expect(s.players.p1.active).toBe(mitsume);
  });

  it('前から場にいたベンチのおてあげは、同じターンに別のおてあげを出しても交代できる', () => {
    let s = startMain();
    s = arrange(s, 'p1', { active: 'oteage', bench: ['mitsume'], hand: ['otesage'] });
    s = arrange(s, 'p2', { active: 'mutsuashi' });
    const [mitsume] = s.players.p1.bench;
    const otesage = s.players.p1.hand[0];
    s = ok(s, { type: 'PLACE_BENCH', player: 'p1', uid: otesage }).state;
    expect(canSwap(s, otesage)).toBe(false);
    expect(canSwap(s, mitsume)).toBe(true);
    s = ok(s, { type: 'SWAP', player: 'p1', benchUid: mitsume }).state;
    // 交代でベンチに下がった元のバトル場（おてあげ）は、すぐ戻せる（出したばかりではない）
    const oteage = s.players.p1.bench.find((u) => u !== otesage)!;
    expect(canSwap(s, oteage)).toBe(true);
  });

  it('相手のターンに くりだしたおてあげは、自分のターンが来たら交代に使える（出したばかりの制限が消える）', () => {
    // p2 は待つターン数 2（制限が消えたかどうかが分かるように）
    let s = startMain({ rules: { p2: { swapCooldownTurns: 2 } } });
    s = arrange(s, 'p1', { active: 'otesage' });
    s = arrange(s, 'p2', { active: 'oteage', bench: ['sanbon', 'mitsume'] });
    const [sanbon, mitsume] = s.players.p2.bench;
    // みつめは「出したばかり」、p2 のバトル場は HP10
    s = patchCard(s, mitsume, { benchedOnTurn: s.players.p2.turnCount });
    s = patchCard(s, s.players.p2.active!, { hp: 10 });
    s = endTurn(s, 1).state; // p1 の攻撃（40）で きぜつ → p2 は くりだしを選ぶ
    expect(s.phase).toBe('promote');
    s = ok(s, { type: 'PROMOTE', player: 'p2', benchUid: mitsume }).state;
    expect(s.currentPlayer).toBe('p2');
    expect(s.players.p2.active).toBe(mitsume);
    expect(s.cards[mitsume].benchedOnTurn).toBeNull();
    // p2 のターン：さんぼん と交代 → すぐ みつめ に戻せる（制限が残っていたら 2ターン待ち）
    s = ok(s, { type: 'SWAP', player: 'p2', benchUid: sanbon }).state;
    expect(canSwap(s, mitsume)).toBe(true);
  });

  it('swapCooldownTurns を変えると待つターン数が変わる（0＝制限なし、2＝2ターン待つ）', () => {
    let s0 = setup(0);
    const m0 = s0.players.p1.hand[0];
    s0 = ok(s0, { type: 'PLACE_BENCH', player: 'p1', uid: m0 }).state;
    expect(canSwap(s0, m0)).toBe(true);

    let s2 = setup(2);
    const m2 = s2.players.p1.hand[0];
    s2 = ok(s2, { type: 'PLACE_BENCH', player: 'p1', uid: m2 }).state;
    s2 = endTurn(endTurn(s2, 4).state, 4).state; // 次の自分ターン
    expect(canSwap(s2, m2)).toBe(false);
    s2 = endTurn(endTurn(s2, 4).state, 4).state; // その次
    expect(canSwap(s2, m2)).toBe(true);
  });
});
