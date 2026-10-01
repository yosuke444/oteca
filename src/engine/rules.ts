import type { RuleSet } from './types';

/** 既定のルールセット（SPEC §4-8）。ルールの数値はここにだけ書く */
export const DEFAULT_RULES: RuleSet = {
  deckSize: 15,
  initialHand: 5,
  drawEveryNTurns: 3,
  koToWin: 3,
  benchMax: 2,
  benchPlacePerTurn: 1,
  superMaxPerDeck: 1,
  attackBonus: 0,
  mulliganIfNoOtege: true,
  swapCooldownTurns: 1,
};

/** 大ダメージ演出に切り替えるダメージ量（SPEC §14-3 の big） */
export const BIG_DAMAGE = 60;

/** サイコロの面の数 */
export const DICE_FACES = 6;
