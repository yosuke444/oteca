import raw from './packs.json';
import { cardById } from './cards';

/**
 * パックの中身（UPDATE_v2 §6-2）。デッキ編集の「パック」の絞り込みに使う（v2.0-B）。
 * 中身はカードの id で書く。まだ cards.json に無いカード（UPDATE_v2 C で足す）は、カードを足す時に一緒に書き足す。
 * 確率・値段（draw）はパックガチャ（SPEC §7 S09・v2.0-E）で使う。
 * limited は限定カード（ストーリーのボスを倒すと手に入る。パックからは出ない）。
 */

export type PackDef = {
  id: string;
  /** パックの名前（固有名詞。言語で変えない） */
  name: string;
  /** 漢字の設定の時の名前（v2.7。大会パック。書かなければ name） */
  nameKanji?: string;
  /** 絞り込みのボタンに出す短い名前（固有名詞） */
  short: string;
  /** 仮の絵の色（パックの絵が届くまで。SPEC §7 S09）。daily は緑と黄色のしま（v2.1-M）。taikai は青い袋に大きく「たいかい」（v2.7） */
  color: 'blue' | 'red' | 'green' | 'daily' | 'taikai';
  /** 中身（normal・super）を、このパックと同じにする（v2.7。大会パックはデイリーパックと同じ）。読み込んだ時に写す */
  contentsOf?: string;
  /** false：パックガチャでは売らない（デイリーパック。ミッションの報酬でだけ手に入る。v2.1-M）。書かなければ売る */
  purchasable?: boolean;
  normal: string[];
  super: string[];
};

/**
 * 引き方（SPEC §7 S09。v2.2）：1袋に1枚。
 * - superRate：ふだんの袋がスーパーおてあげの確率（どのパックも同じ。スーパーの中・ノーマルの中では、どのカードも同じ確率）
 * - glowRate：中身がスーパーの袋が光る確率。中身がノーマルの袋は glowRate × superRate ÷ (1 − superRate) で光る
 *   （光った袋のスーパー率が 50% になる）。確定の袋とデイリーパックは除く
 * - offers：買い方。lastBagSuper：最後の袋をスーパーおてあげ確定にする（10まい。v2.7 で15まい→10まい）
 * - superToCoins：スーパーレアの換金の枚数
 */
export type DrawRules = {
  superRate: number;
  glowRate: number;
  offers: { id: string; bags: number; price: number; lastBagSuper: boolean }[];
  superToCoins: number;
};

export type PackData = { version: number; packs: PackDef[]; limited: string[]; draw: DrawRules };

/** 形が正しくなければエラー（無い id・スーパーでないカードを super に書いた など） */
export function parsePackData(data: unknown): PackData {
  const d = data as PackData;
  check(typeof d?.version === 'number', 'version がありません');
  check(Array.isArray(d.packs) && Array.isArray(d.limited), 'packs・limited が配列ではありません');
  const ids = new Set<string>();
  for (const p of d.packs) {
    check(typeof p.id === 'string' && !ids.has(p.id), `パック ${String(p?.id)}: id が無いか重複しています`);
    ids.add(p.id);
    check(typeof p.name === 'string' && typeof p.short === 'string', `パック ${p.id}: name・short がありません`);
    for (const id of p.normal) {
      const c = cardById(id);
      check(!!c && !(c.kind === 'otege' && c.rarity === 'super'), `パック ${p.id}: normal の ${id} が無いか、スーパーです`);
    }
    for (const id of p.super) {
      const c = cardById(id);
      check(!!c && c.kind === 'otege' && c.rarity === 'super', `パック ${p.id}: super の ${id} が無いか、スーパーではありません`);
    }
  }
  for (const id of d.limited) check(!!cardById(id), `limited の ${id} は cards.json にありません`);
  // 中身を別のパックと同じにする（v2.7）：写す元は contentsOf の無いパック
  for (const p of d.packs) {
    if (p.contentsOf === undefined) continue;
    const from = d.packs.find((x) => x.id === p.contentsOf);
    check(!!from && from.contentsOf === undefined && p.normal.length === 0 && p.super.length === 0, `パック ${p.id}: contentsOf が不正です`);
    p.normal = [...from!.normal];
    p.super = [...from!.super];
  }
  for (const p of d.packs) {
    check(['blue', 'red', 'green', 'daily', 'taikai'].includes(p.color), `パック ${p.id}: color が不正です`);
    check(p.nameKanji === undefined || typeof p.nameKanji === 'string', `パック ${p.id}: nameKanji が不正です`);
    check(p.purchasable === undefined || typeof p.purchasable === 'boolean', `パック ${p.id}: purchasable が不正です`);
    // 売るパックはノーマルとスーパーレアが1枚以上。売らないパック（デイリー）はスーパーレア無しでもよい
    check(p.normal.length > 0 && (p.super.length > 0 || p.purchasable === false), `パック ${p.id}: ノーマルとスーパーレアが1枚以上必要です`);
  }
  const dr = d.draw;
  const rate = (v: unknown) => typeof v === 'number' && v >= 0 && v <= 1;
  // superRate は 1 未満（ノーマルの光る確率の割り算のため）
  check(!!dr && rate(dr.superRate) && dr.superRate < 1 && rate(dr.glowRate), 'draw.superRate・glowRate が不正です');
  check(dr.glowRate * dr.superRate <= 1 - dr.superRate, 'draw：ノーマルの袋の光る確率が 1 を超えます');
  check(
    Array.isArray(dr.offers) &&
      dr.offers.length > 0 &&
      dr.offers.every((o) => typeof o.id === 'string' && Number.isInteger(o.bags) && o.bags > 0 && Number.isInteger(o.price) && o.price > 0 && typeof o.lastBagSuper === 'boolean'),
    'draw.offers が不正です',
  );
  check(Number.isInteger(dr.superToCoins) && dr.superToCoins >= 0, 'draw.superToCoins が不正です');
  return d;
}

function check(ok: boolean, message: string): asserts ok {
  if (!ok) throw new Error(`packs.json: ${message}`);
}

export const PACK_DATA: PackData = parsePackData(raw);

/** パックガチャで売るパック（デイリーパックは売らない） */
export const SHOP_PACKS: PackDef[] = PACK_DATA.packs.filter((p) => p.purchasable !== false);

/** パックの名前（漢字の設定では nameKanji があればそれ。v2.7） */
export function packName(pack: PackDef, lang: 'hira' | 'kanji'): string {
  return lang === 'kanji' && pack.nameKanji ? pack.nameKanji : pack.name;
}

/** 絞り込みの「パック」：各パックと 限定 */
export type PackFilter = string | 'limited';

/** そのカードが、パック（または限定）に入っているか */
export function inPack(cardId: string, pack: PackFilter): boolean {
  if (pack === 'limited') return PACK_DATA.limited.includes(cardId);
  const p = PACK_DATA.packs.find((x) => x.id === pack);
  return !!p && (p.normal.includes(cardId) || p.super.includes(cardId));
}
