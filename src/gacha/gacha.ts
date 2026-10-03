import { cardById } from '../data/cards';
import { PACK_DATA, type DrawRules, type PackDef } from '../data/packs';
import { ECONOMY, addCoins } from '../economy/rewards';
import { OWN_MAX, type SaveData } from '../save/saveData';

/**
 * パックガチャの引き方（SPEC §7 S09・UPDATE_v2 §6-3）。乱数を受け取る純粋な関数だけ。
 * 画面では crypto.getRandomValues（cryptoRand）、テストでは種付きの乱数を渡す。
 */

/** 0 以上 1 未満 */
export type Rand = () => number;

/** 1枚：カードNo と、スーパーレアか */
export type Pull = { no: number; super: boolean };
/** 1袋：基本1枚、ダブルなら2枚 */
export type Bag = { cards: Pull[]; double: boolean };

export type Offer = DrawRules['offers'][number];

export const DRAW: DrawRules = PACK_DATA.draw;

/** 本物の乱数（crypto.getRandomValues。エンジンの乱数とは別） */
export function cryptoRand(): number {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return a[0] / 2 ** 32;
}

export function packById(id: string): PackDef | undefined {
  return PACK_DATA.packs.find((p) => p.id === id);
}

export function offerById(id: string): Offer | undefined {
  return DRAW.offers.find((o) => o.id === id);
}

/** パックの全カードの重みの合計（ノーマル1種類 weights.normal・スーパー1種類 weights.super。v2.1-K） */
function totalWeight(pack: PackDef, rules: DrawRules): number {
  return pack.normal.length * rules.weights.normal + pack.super.length * rules.weights.super;
}

/** パックの中のカード1枚が、1枚引いた時に出る確率（「なかみ」パネル用。SPEC §7 S09）＝重み ÷ 合計 */
export function cardRate(pack: PackDef, id: string, rules: DrawRules = DRAW): number {
  const inNormal = pack.normal.filter((x) => x === id).length;
  const inSuper = pack.super.filter((x) => x === id).length;
  return (inNormal * rules.weights.normal + inSuper * rules.weights.super) / totalWeight(pack, rules);
}

/** 1枚引いた時に、スーパーおてあげのどれかが出る確率（「なかみ」パネル用） */
export function superRate(pack: PackDef, rules: DrawRules = DRAW): number {
  return (pack.super.length * rules.weights.super) / totalWeight(pack, rules);
}

/** 1枚引く：重みの割合で1枚を選ぶ（SPEC §7 S09。v2.1-K） */
function pickOne(pack: PackDef, rand: Rand, rules: DrawRules): Pull {
  let r = rand() * totalWeight(pack, rules);
  const nN = pack.normal.length * rules.weights.normal;
  let id: string;
  let sr: boolean;
  if (r < nN) {
    sr = false;
    id = pack.normal[Math.min(pack.normal.length - 1, Math.floor(r / rules.weights.normal))];
  } else {
    sr = true;
    r -= nN;
    id = pack.super[Math.min(pack.super.length - 1, Math.floor(r / rules.weights.super))];
  }
  const def = cardById(id);
  if (!def) throw new Error(`カード ${id} は cards.json にありません`);
  return { no: def.no, super: sr };
}

/** bags 袋を引く（1袋ごとに doubleRate で2枚入り） */
export function drawBags(pack: PackDef, bags: number, rand: Rand, rules: DrawRules = DRAW): Bag[] {
  const out: Bag[] = [];
  for (let i = 0; i < bags; i++) {
    const double = rand() < rules.doubleRate;
    const cards = [pickOne(pack, rand, rules)];
    if (double) cards.push(pickOne(pack, rand, rules));
    out.push({ cards, double });
  }
  return out;
}

/** 引いた1枚の結果（まとめ画面用） */
export type PullResult = Pull & {
  /** 初めて手に入れた（引く前に1枚も持っていなかった） */
  isNew: boolean;
  /** 換金できる：スーパーレアで、引く前に（同じ回の中で先に引いた分も数えて）すでに1枚以上持っていた */
  convertible: boolean;
  /** このカードを足した直後の所持数 */
  ownedAfter: number;
};

/** コインが足りるか */
export function canAfford(save: Pick<SaveData, 'coins'>, offer: Offer): boolean {
  return save.coins >= offer.price;
}

/**
 * 引いた結果をセーブの下書きに書く：コインを減らし、カードを足す（同じ保存で両方。SPEC §7 S09）。
 * コインが足りなければ何もしないで null。
 */
export function applyPull(draft: Pick<SaveData, 'coins' | 'collection'>, offer: Offer, bags: Bag[]): PullResult[] | null {
  if (!canAfford(draft, offer)) return null;
  addCoins(draft, -offer.price);
  return applyBags(draft, bags);
}

/** 引いた袋のカードを所持数に足す（コインは変えない。デイリーパックの報酬でも使う。v2.1-M） */
export function applyBags(draft: Pick<SaveData, 'collection'>, bags: Bag[]): PullResult[] {
  const results: PullResult[] = [];
  for (const bag of bags) {
    for (const c of bag.cards) {
      const before = draft.collection[c.no] ?? 0;
      draft.collection[c.no] = Math.min(OWN_MAX, before + 1);
      results.push({ ...c, isNew: before === 0, convertible: c.super && before >= 1, ownedAfter: draft.collection[c.no] });
    }
  }
  return results;
}

/** 換金してもコインが上限を超えないか（超えるなら換金させない。カードだけ減って損をしないように） */
export function coinsRoomFor(save: Pick<SaveData, 'coins'>, rules: DrawRules = DRAW): boolean {
  return save.coins + rules.superToCoins <= ECONOMY.coinsMax;
}

/**
 * スーパーレアの換金（SPEC §7 S09）：そのカード1枚をコイン superToCoins 枚に替える（所持数 -1・コイン +50 を同じ保存で）。
 * 1枚も持っていなければ何もしないで false
 */
export function convertSuper(draft: Pick<SaveData, 'coins' | 'collection'>, no: number, rules: DrawRules = DRAW): boolean {
  const owned = draft.collection[no] ?? 0;
  if (owned < 1 || !coinsRoomFor(draft, rules)) return false;
  if (owned === 1) delete draft.collection[no];
  else draft.collection[no] = owned - 1;
  addCoins(draft, rules.superToCoins);
  return true;
}
