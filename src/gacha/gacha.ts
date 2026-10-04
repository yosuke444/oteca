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
/**
 * 1袋（v2.2：1袋に1枚）。
 * glow：袋が光る（中身を決めた後で決める。スーパーとは限らない）。guaranteed：15まいの最後の、スーパーレア確定の袋（いつも光る）
 */
export type Bag = { card: Pull; glow: boolean; guaranteed: boolean };

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

/** ふだんの袋がスーパーおてあげの確率（そのパックにスーパーが無ければ 0。デイリーパック） */
export function superRate(pack: PackDef, rules: DrawRules = DRAW): number {
  return pack.super.length > 0 ? rules.superRate : 0;
}

/** 中身がノーマルの袋が光る確率（光った袋のスーパー率が 50% になる値：glowRate × superRate ÷ (1 − superRate)） */
export function normalGlowRate(rules: DrawRules = DRAW): number {
  return (rules.glowRate * rules.superRate) / (1 - rules.superRate);
}

/** パックの中のカード1枚が、ふだんの袋1つで出る確率（「なかみ」パネル用。SPEC §7 S09）。スーパー・ノーマルそれぞれの中では同じ確率 */
export function cardRate(pack: PackDef, id: string, rules: DrawRules = DRAW): number {
  const sr = superRate(pack, rules);
  const inNormal = pack.normal.filter((x) => x === id).length;
  const inSuper = pack.super.filter((x) => x === id).length;
  return (inNormal * (1 - sr)) / pack.normal.length + (pack.super.length ? (inSuper * sr) / pack.super.length : 0);
}

/** 並びの中から同じ確率で1枚 */
function pickFrom(ids: string[], rand: Rand, sr: boolean): Pull {
  const id = ids[Math.min(ids.length - 1, Math.floor(rand() * ids.length))];
  const def = cardById(id);
  if (!def) throw new Error(`カード ${id} は cards.json にありません`);
  return { no: def.no, super: sr };
}

/**
 * 1袋を引く（SPEC §7 S09。v2.2）：中身を決めてから、光らせるかを決める。
 * guaranteed：スーパーおてあげ確定（同じ確率で選ぶ。いつも光る）。glows：光らせてよい袋か（デイリーパックは光らせない）
 */
export function drawBag(pack: PackDef, rand: Rand, rules: DrawRules = DRAW, opts: { guaranteed?: boolean; glows?: boolean } = {}): Bag {
  if (opts.guaranteed && pack.super.length > 0) return { card: pickFrom(pack.super, rand, true), glow: true, guaranteed: true };
  const isSuper = rand() < superRate(pack, rules);
  const card = isSuper ? pickFrom(pack.super, rand, true) : pickFrom(pack.normal, rand, false);
  const glow = opts.glows !== false && rand() < (isSuper ? rules.glowRate : normalGlowRate(rules));
  return { card, glow, guaranteed: false };
}

/**
 * bags 袋を引く。lastBagSuper：最後の袋をスーパーおてあげ確定にする（15まい）。
 * 売らないパック（デイリーパック）の袋は光らせない
 */
export function drawBags(pack: PackDef, bags: number, rand: Rand, rules: DrawRules = DRAW, lastBagSuper = false): Bag[] {
  const glows = pack.purchasable !== false;
  const out: Bag[] = [];
  for (let i = 0; i < bags; i++) out.push(drawBag(pack, rand, rules, { guaranteed: lastBagSuper && i === bags - 1, glows }));
  return out;
}

/**
 * めくり方（v2.2。演出を選ぶ）：
 * - guaranteed：確定の袋。スーパーレアの演出を さらに3倍豪華に
 * - super：光った袋からスーパー（今までのスーパーレアの演出）
 * - letdown：光ったのにノーマル。期待させてから「…ぺらっ」と普通にめくれる（少しコミカルに）
 * - surprise：光らなかったのにスーパー。めくった瞬間に光があふれ出る（3倍豪華に）
 * - normal：ノーマル（集中線＋「ぺらっ」）
 */
export type RevealKind = 'guaranteed' | 'super' | 'letdown' | 'surprise' | 'normal';

export function revealKind(bag: Pick<Bag, 'glow' | 'guaranteed'>, isSuper: boolean): RevealKind {
  if (bag.guaranteed) return 'guaranteed';
  if (bag.glow) return isSuper ? 'super' : 'letdown';
  return isSuper ? 'surprise' : 'normal';
}

/** 買い方（3まい・15まい）で引く。15まいは最後の袋がスーパーレア確定（packs.json の lastBagSuper） */
export function drawOffer(pack: PackDef, offer: Offer, rand: Rand, rules: DrawRules = DRAW): Bag[] {
  return drawBags(pack, offer.bags, rand, rules, offer.lastBagSuper);
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
  for (const { card: c } of bags) {
    const before = draft.collection[c.no] ?? 0;
    draft.collection[c.no] = Math.min(OWN_MAX, before + 1);
    results.push({ ...c, isNew: before === 0, convertible: c.super && before >= 1, ownedAfter: draft.collection[c.no] });
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
