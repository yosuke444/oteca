import { CARD_DB, isTrophyNo, trophyCardNo } from '../data/cards';
import { PACK_DATA } from '../data/packs';
import { validateDeck } from '../engine';
import { OWN_MAX, type SaveData } from '../save/saveData';
import { checkSavedDeck } from '../save/collection';

/**
 * カードトレードの決まり（UPDATE_v2 §9・SPEC §7 S16）。画面にも通信にも関係しない、ふつうの処理だけ。
 */

/** 出すカード：カードNo → 枚数（1以上） */
export type Offer = Record<number, number>;

/** 片側で出せる上限（§9-3：最大99種類・合計99枚） */
export const TRADE_MAX_KINDS = 99;
export const TRADE_MAX_CARDS = 99;
/** 処理済みの交換IDを覚えておく数（§12「直近20件」） */
export const TRADE_DONE_KEEP = 20;

/** 種類の数・合計の枚数 */
export function offerSize(o: Offer): { kinds: number; cards: number } {
  const v = Object.values(o).filter((n) => n > 0);
  return { kinds: v.length, cards: v.reduce((a, b) => a + b, 0) };
}

/** 並びをそろえた形（ハッシュ・比べる時に使う） */
export function canonical(o: Offer): [number, number][] {
  return Object.entries(o)
    .map(([k, v]) => [Number(k), v] as [number, number])
    .filter(([no, n]) => n > 0 && Number.isInteger(no) && Number.isInteger(n))
    .sort((a, b) => a[0] - b[0]);
}

/** ストーリーの限定カード（packs.json の limited）のカードNo */
const LIMITED_NOS = new Set(
  Object.values(CARD_DB)
    .filter((c) => PACK_DATA.limited.includes(c.id))
    .map((c) => c.no),
);

/** トレードに出せるカードか（v2.2：ストーリーの限定カードとトロフィあげは出せない） */
export function isTradable(no: number): boolean {
  return !!CARD_DB[no] && !isTrophyNo(no) && !LIMITED_NOS.has(no);
}

/** 限定カードか（v2.3：トレードの一覧で灰色にして理由を出す。v2.7 からトロフィあげ（大会の賞品）も同じ扱い・同じ表示） */
export function isLimitedNo(no: number): boolean {
  return LIMITED_NOS.has(no) || isTrophyNo(no);
}

/** 内容に、トレードに出せないカード（限定カード・トロフィあげ・知らないカード）が入っているか */
export function hasUntradable(o: Offer): boolean {
  return Object.entries(o).some(([k, v]) => Number(v) > 0 && !isTradable(Number(k)));
}

/**
 * 相手から届いた offer が「出せないカード」入りか（v2.3）。
 * 形は正しいのに限定カード・トロフィあげが入っている（古い版・書き換え）時は true。壊れたデータは false（今までどおり無視する）
 */
export function offerHasUntradable(x: unknown): boolean {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return false;
  return Object.entries(x as Record<string, unknown>).some(([k, v]) => {
    const no = Number(k);
    return Number.isInteger(no) && typeof v === 'number' && v > 0 && !!CARD_DB[no] && !isTradable(no);
  });
}

/** トレードの一覧に出す自分のカード（v2.3：限定カードも出し、灰色・選べない。v2.7：持っているトロフィあげも同じに出す） */
export function giveCandidates(save: Pick<SaveData, 'collection'> & Partial<Pick<SaveData, 'trophies'>>): { no: number; limited: boolean }[] {
  const trophies = (save.trophies ?? []).map((t) => trophyCardNo(t.number));
  return [
    ...Object.keys(save.collection)
      .map(Number)
      .filter((no) => (save.collection[no] ?? 0) > 0 && !!CARD_DB[no] && !isTrophyNo(no)),
    ...trophies,
  ]
    .filter((no) => isTradable(no) || isLimitedNo(no))
    .sort((a, b) => a - b)
    .map((no) => ({ no, limited: isLimitedNo(no) }));
}

/** 受け取った offer を確かめる（壊れたデータ・存在しないカード・トレードに出せないカード・上限越えは null） */
export function cleanOffer(x: unknown): Offer | null {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return null;
  const out: Offer = {};
  for (const [k, v] of Object.entries(x as Record<string, unknown>)) {
    const no = Number(k);
    // トロフィーのカード（v2.0-J）とストーリーの限定カード（v2.2）はトレードに出せない
    if (!Number.isInteger(no) || !isTradable(no) || typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > TRADE_MAX_CARDS) return null;
    if (v > 0) out[no] = v;
  }
  const s = offerSize(out);
  if (s.kinds > TRADE_MAX_KINDS || s.cards > TRADE_MAX_CARDS) return null;
  return out;
}

/** その枚数を足せるか（所持数まで・上限まで） */
export function canAdd(save: Pick<SaveData, 'collection'>, offer: Offer, no: number): boolean {
  const s = offerSize(offer);
  const now = offer[no] ?? 0;
  if (!isTradable(no)) return false;
  if (now >= (save.collection[no] ?? 0)) return false;
  if (s.cards >= TRADE_MAX_CARDS) return false;
  if (now === 0 && s.kinds >= TRADE_MAX_KINDS) return false;
  return true;
}

/** 自分の所持数で出せる内容か */
export function offerFits(save: Pick<SaveData, 'collection'>, offer: Offer): boolean {
  return canonical(offer).every(([no, n]) => (save.collection[no] ?? 0) >= n);
}

/** 交換の中身（ハッシュにかける文字）：2人の offer を、プレイヤーID の順に並べる */
export function tradeKey(a: { playerId: string; offer: Offer }, b: { playerId: string; offer: Offer }): string {
  const [x, y] = a.playerId < b.playerId ? [a, b] : [b, a];
  return JSON.stringify([x.playerId, canonical(x.offer), y.playerId, canonical(y.offer)]);
}

/** この交換で使えなくなる保存デッキの名前（最終確認の警告。§9-3） */
export function brokenDecks(save: Pick<SaveData, 'decks' | 'collection' | 'unlockAll'>, give: Offer, get: Offer): string[] {
  const after = afterCollection(save.collection, give, get);
  const out: string[] = [];
  const nextSave = { ...(save as SaveData), collection: after };
  save.decks.forEach((d, i) => {
    if (d.cards.length === 0) return;
    if (checkSavedDeck(save as SaveData, i).usable && !checkSavedDeck(nextSave, i).usable) out.push(d.name);
  });
  return out;
}

/** 交換したあとの所持数（0 は消す・999 で止める） */
export function afterCollection(collection: Record<number, number>, give: Offer, get: Offer): Record<number, number> {
  const out: Record<number, number> = { ...collection };
  for (const [no, n] of canonical(give)) {
    const v = (out[no] ?? 0) - n;
    if (v > 0) out[no] = v;
    else delete out[no];
  }
  for (const [no, n] of canonical(get)) out[no] = Math.min(OWN_MAX, (out[no] ?? 0) + n);
  return out;
}

/**
 * 交換をセーブの下書きに書く（あげる・もらう・交換IDの記録を1回の保存で）。
 * 同じ交換IDは二度処理しない（false を返す）。所持数が足りない時も処理しない
 */
export function applyTrade(draft: Pick<SaveData, 'collection' | 'trade'>, tradeId: string, give: Offer, get: Offer, opts: { partial?: boolean } = {}): boolean {
  if (draft.trade.doneIds.includes(tradeId)) return false;
  // 出せないカード（限定カード・トロフィあげ）が どちらかに入っていたら、どちらのカードも動かさない（v2.3。書き換えた とちゅうの交換 なども）
  if (hasUntradable(give) || hasUntradable(get)) return false;
  if (!offerFits(draft, give)) {
    if (!opts.partial) return false;
    // 相手の側では交換が済んでいる（とちゅうの交換を仕上げる時・成立の時）：あげる分は持っている分だけ減らし、もらう分は受け取る
    give = Object.fromEntries(canonical(give).map(([no, n]) => [no, Math.min(n, draft.collection[no] ?? 0)]));
  }
  draft.collection = afterCollection(draft.collection, give, get);
  draft.trade.doneIds = [...draft.trade.doneIds, tradeId].slice(-TRADE_DONE_KEEP);
  return true;
}

/** デッキの決まりを満たすか（テスト用の道具） */
export function deckOk(cards: number[]): boolean {
  return validateDeck(cards, CARD_DB).length === 0;
}
