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
  /** 絞り込みのボタンに出す短い名前（固有名詞） */
  short: string;
  /** 仮の絵の色（パックの絵が届くまで。SPEC §7 S09） */
  color: 'blue' | 'red' | 'green';
  normal: string[];
  super: string[];
};

/**
 * 引き方（SPEC §7 S09）：1枚ごとの重み（ノーマル1種類・スーパー1種類。v2.1-K）・1袋ごとのダブルの確率・買い方・換金の枚数。
 * 1枚の確率＝そのカードの重み ÷ パックの全カードの重みの合計
 */
export type DrawRules = {
  weights: { normal: number; super: number };
  doubleRate: number;
  offers: { id: string; bags: number; price: number }[];
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
  for (const p of d.packs) {
    check(['blue', 'red', 'green'].includes(p.color), `パック ${p.id}: color が不正です`);
    check(p.normal.length > 0 && p.super.length > 0, `パック ${p.id}: ノーマルとスーパーレアが1枚以上必要です`);
  }
  const dr = d.draw;
  const rate = (v: unknown) => typeof v === 'number' && v >= 0 && v <= 1;
  const weight = (v: unknown) => typeof v === 'number' && v > 0 && Number.isFinite(v);
  check(!!dr && !!dr.weights && weight(dr.weights.normal) && weight(dr.weights.super) && rate(dr.doubleRate), 'draw の重み・確率が不正です');
  check(Array.isArray(dr.offers) && dr.offers.length > 0 && dr.offers.every((o) => typeof o.id === 'string' && Number.isInteger(o.bags) && o.bags > 0 && Number.isInteger(o.price) && o.price > 0), 'draw.offers が不正です');
  check(Number.isInteger(dr.superToCoins) && dr.superToCoins >= 0, 'draw.superToCoins が不正です');
  return d;
}

function check(ok: boolean, message: string): asserts ok {
  if (!ok) throw new Error(`packs.json: ${message}`);
}

export const PACK_DATA: PackData = parsePackData(raw);

/** 絞り込みの「パック」：各パックと 限定 */
export type PackFilter = string | 'limited';

/** そのカードが、パック（または限定）に入っているか */
export function inPack(cardId: string, pack: PackFilter): boolean {
  if (pack === 'limited') return PACK_DATA.limited.includes(cardId);
  const p = PACK_DATA.packs.find((x) => x.id === pack);
  return !!p && (p.normal.includes(cardId) || p.super.includes(cardId));
}
