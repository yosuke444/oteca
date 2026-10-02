import raw from './packs.json';
import { cardById } from './cards';

/**
 * パックの中身（UPDATE_v2 §6-2）。デッキ編集の「パック」の絞り込みに使う（v2.0-B）。
 * 中身はカードの id で書く。まだ cards.json に無いカード（UPDATE_v2 C で足す）は、カードを足す時に一緒に書き足す。
 * 確率・値段はパックガチャ（UPDATE_v2 E）で足す。
 * limited は限定カード（ストーリーのボスを倒すと手に入る。パックからは出ない）。
 */

export type PackDef = {
  id: string;
  /** パックの名前（固有名詞。言語で変えない） */
  name: string;
  /** 絞り込みのボタンに出す短い名前（固有名詞） */
  short: string;
  normal: string[];
  super: string[];
};

export type PackData = { version: number; packs: PackDef[]; limited: string[] };

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
