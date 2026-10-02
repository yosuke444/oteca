import { moveDamage } from '../engine/effects';
import { DICE_FACES } from '../engine/rules';
import type { GameState, OtegeCardDef, Side } from '../engine/types';

/**
 * サイコロの確率から見た「強さ」の見積もり（CPU つよい・さいきょう 用。SPEC §13-5）。
 * ルールエンジンの moveDamage（§4-5 ④の計算）をそのまま使うので、ルールを二重に書かない。
 * どの技も効果データ（damage・heal・selfDamage・draw・faintLater…）から計算する。カード名では判定しない（v2.0）。
 */

/** サイコロの目ごとの結果 */
export type Outcome = {
  /** 今すぐ相手に与えるダメージ */
  damage: number;
  /** 持続効果で、あとから相手に与えるダメージの合計（どく） */
  later: number;
  /** 回復（今すぐ。最大HPで切らない） */
  heal: number;
  /** あとからの回復の合計 */
  healLater: number;
  /** 自分へのダメージ（今すぐ） */
  self: number;
  /** あとからの自分へのダメージの合計 */
  selfLater: number;
  /** 引く枚数（今すぐ＋あとから） */
  draw: number;
  /** 相手に時限（ばくだん）を付ける */
  bomb: boolean;
  /** 手札を捨てる枚数 */
  discard: number;
};

export function otegeDef(s: GameState, uid: string): OtegeCardDef | null {
  const d = s.cardDefs[s.cards[uid]?.no];
  return d && d.kind === 'otege' ? d : null;
}

const sum = (xs: number[] | undefined) => (xs ?? []).reduce((t, x) => t + x, 0);

/** そのおてあげが攻撃した時の、目 1〜6 ごとの結果。extraAdd はこれから足すダメージ（やいば等） */
export function outcomes(s: GameState, uid: string, extraAdd = 0): Outcome[] {
  const c = s.cards[uid];
  const def = otegeDef(s, uid);
  const out: Outcome[] = [];
  for (let face = 1; face <= DICE_FACES; face++) {
    const move = def?.moves.find((m) => m.faces.includes(face));
    const o: Outcome = { damage: 0, later: 0, heal: 0, healLater: 0, self: 0, selfLater: 0, draw: 0, bomb: false, discard: 0 };
    for (const e of move?.effects ?? []) {
      switch (e.type) {
        case 'damage':
          o.damage += moveDamage(s, { ...c, attackAdd: c.attackAdd + extraAdd }, e.amount);
          o.later += sum(e.then);
          break;
        case 'heal':
          o.heal += e.amount;
          o.healLater += sum(e.then);
          break;
        case 'selfDamage':
          o.self += e.amount;
          o.selfLater += sum(e.then);
          break;
        case 'draw':
          o.draw += e.count + sum(e.then);
          break;
        case 'faintLater':
          o.bomb = true;
          break;
        case 'discard':
          o.discard += e.count;
          break;
        default:
          break;
      }
    }
    out.push(o);
  }
  return out;
}

/** 期待ダメージ（あとからの分は少し割り引く） */
export function expectedDamage(s: GameState, uid: string, extraAdd = 0): number {
  return outcomes(s, uid, extraAdd).reduce((t, o) => t + o.damage + 0.8 * o.later, 0) / DICE_FACES;
}

/** 1回の攻撃で（今すぐ）hp 以上のダメージが出る確率 */
export function koChance(s: GameState, attackerUid: string, hp: number, extraAdd = 0): number {
  return outcomes(s, attackerUid, extraAdd).filter((o) => o.damage >= hp).length / DICE_FACES;
}

/**
 * 自分の技で自分がきぜつする確率（今の HP で。v2.0）。
 * 自分へのダメージは相手の手柄になるので、HPが低い時はこの値が高いおてあげを前に出さない
 */
export function selfKoChance(s: GameState, uid: string): number {
  const hp = s.cards[uid].hp;
  return outcomes(s, uid).filter((o) => o.self > 0 && o.self >= hp).length / DICE_FACES;
}

/**
 * 相手のバトル場のおてあげが、次の攻撃で このおてあげを倒す確率（相手の手札のアイテムは分からないので margin だけ多めに見る）。
 * withLasting：付いている持続ダメージ・時限も数えるか（交代で守るかを決める時は数えない。ベンチに下げても付いたままなので）
 */
export function threat(s: GameState, side: Side, targetUid: string, margin = 0, withLasting = true): number {
  const opp: Side = side === 'p1' ? 'p2' : 'p1';
  const a = s.players[opp].active;
  if (!a) return 0;
  // 相手のこのターンの効果（やいば等）は相手のターン終わりに消えているので、素の強さで見る
  const base = { ...s, cards: { ...s.cards, [a]: { ...s.cards[a], attackAdd: 0, attackOverride: null } } };
  // 付いている持続ダメージ・時限も、このおてあげを倒す原因になる
  if (!withLasting) return koChance(base, a, s.cards[targetUid].hp - margin);
  const pending = s.lasting.filter((l) => l.targetUid === targetUid && l.owner === opp && l.kind === 'damage' && l.skip === 0).reduce((t, l) => t + l.amount, 0);
  const bombNow = s.lasting.some((l) => l.targetUid === targetUid && l.kind === 'faint' && l.skip === 0);
  if (bombNow) return 1;
  return koChance(base, a, s.cards[targetUid].hp - margin - pending);
}

/**
 * おてあげの「価値」（HP と 攻撃力など）。準備・くりだし・ベンチに出す順の目安。
 * 効果データから：与えるダメージ（あとからの分も）・回復・ドローは足し、自分へのダメージは引く
 */
export function otegeValue(s: GameState, uid: string): number {
  const c = s.cards[uid];
  const os = outcomes(s, uid);
  const per = (f: (o: Outcome) => number) => os.reduce((t, o) => t + f(o), 0) / DICE_FACES;
  const offense = per((o) => o.damage + 0.8 * o.later + (o.bomb ? 60 : 0));
  const support = per((o) => 0.5 * Math.min(o.heal + o.healLater, c.maxHp) + 12 * o.draw - 6 * o.discard);
  const risk = per((o) => Math.min(o.self + o.selfLater, c.hp + 40));
  return c.hp + 2.5 * offense + support - 1.2 * risk;
}
