import raw from '../data/gifts.json';
import { addCoins } from '../economy/rewards';
import { cardById } from '../data/cards';
import { PACK_DATA } from '../data/packs';
import { COINS_MAX, OWNED_PACK_KINDS_MAX, OWNED_PACK_MAX, OWN_MAX, type SaveData, normalizeGiftIds } from '../save/saveData';

/**
 * 贈り物（v2.7。SPEC §7 S20「ギフト」）：管理画面から「何を・いくつ」贈るかを、src/data/gifts.json の種類で決める。
 * - trophy：トロフィあげ（番号つきの1枚。今までの郵便受け・trophies で届く）
 * - pack：もっている パック（ガチャ画面から開ける）。今は大会パック
 * - coins・card：後で使う（データを足すだけで贈れる。受け取りの処理はここにある）
 * 届け方（届け係・郵便受け・二重にしない順番）は、どの種類も同じ（online/mailbox.ts・giftLink.ts）
 */

export type GiftType = 'trophy' | 'pack' | 'coins' | 'card';

export type GiftKind = {
  /** 贈り物の種類の id（サーバーの gifts.kind） */
  id: string;
  type: GiftType;
  /** pack：パックの id（packs.json） */
  pack?: string;
  /** card：カードの id（cards.json） */
  card?: string;
  /** 管理画面の「1人に いくつ」の最初の値と上限 */
  defaultCount: number;
  maxCount: number;
  /** 届いた時の演出（trophy：限定カードと同じ／taikai：たいかいの さんかしょう／それ以外：同じ形の かんたんな演出） */
  arrival: string;
};

export type GiftData = { version: number; kinds: GiftKind[] };

const TYPES: GiftType[] = ['trophy', 'pack', 'coins', 'card'];

/** 形が正しくなければエラー */
export function parseGiftData(data: unknown): GiftData {
  const d = data as GiftData;
  const fail = (m: string): never => {
    throw new Error(`gifts.json: ${m}`);
  };
  if (!d || !Array.isArray(d.kinds)) fail('kinds がありません');
  const ids = new Set<string>();
  for (const k of d.kinds) {
    if (typeof k.id !== 'string' || !/^[a-z0-9_]{1,32}$/.test(k.id) || ids.has(k.id)) fail(`id ${String(k?.id)} が不正か重複しています`);
    ids.add(k.id);
    if (!TYPES.includes(k.type)) fail(`${k.id}: type が不正です`);
    if (!Number.isInteger(k.maxCount) || k.maxCount < 1 || !Number.isInteger(k.defaultCount) || k.defaultCount < 1 || k.defaultCount > k.maxCount) fail(`${k.id}: defaultCount・maxCount が不正です`);
    if (k.type === 'pack' && !PACK_DATA.packs.some((p) => p.id === k.pack)) fail(`${k.id}: pack が packs.json にありません`);
    if (k.type === 'card' && !cardById(k.card ?? '')) fail(`${k.id}: card が cards.json にありません`);
    if (typeof k.arrival !== 'string') fail(`${k.id}: arrival がありません`);
  }
  return d;
}

export const GIFT_DATA: GiftData = parseGiftData(raw);

export function giftKind(id: string): GiftKind | undefined {
  return GIFT_DATA.kinds.find((k) => k.id === id);
}

/** サーバーから届いた贈り物（トロフィー以外。gifts の1行） */
export type Gift = { id: number; kind: string; count: number };

/** 受け取れる形か（知らない種類・おかしな数は受け取らない＝郵便受けに残す） */
export function isReceivable(g: Gift): boolean {
  const k = giftKind(g.kind);
  return !!k && k.type !== 'trophy' && Number.isSafeInteger(g.id) && g.id > 0 && Number.isInteger(g.count) && g.count >= 1 && g.count <= k.maxCount;
}

/**
 * 今のセーブに入るか（パックは1種類 OWNED_PACK_MAX まで・種類は OWNED_PACK_KINDS_MAX まで、コイン・カードも上限まで）。
 * 入らない贈り物は受け取らない（郵便受けに残す。トロフィーの100個と同じ。失わない）
 */
export function giftFits(d: Pick<SaveData, 'ownedPacks' | 'coins' | 'collection'>, g: Gift): boolean {
  const k = giftKind(g.kind);
  if (!k) return false;
  switch (k.type) {
    case 'pack': {
      const have = d.ownedPacks[k.pack!] ?? 0;
      if (have === 0 && Object.keys(d.ownedPacks).length >= OWNED_PACK_KINDS_MAX) return false;
      return have + g.count <= OWNED_PACK_MAX;
    }
    case 'coins':
      return d.coins + g.count <= COINS_MAX;
    case 'card': {
      const no = cardById(k.card!)!.no;
      return (d.collection[no] ?? 0) + g.count <= OWN_MAX;
    }
    default:
      return false;
  }
}

/**
 * 贈り物をセーブ（の下書き）に入れる。同じ番号はもう入っていれば何もしない（二重にしない）。
 * @returns 入れたら true
 */
export function applyGift(d: Pick<SaveData, 'ownedPacks' | 'giftIds' | 'coins' | 'collection'>, g: Gift): boolean {
  if (!isReceivable(g) || d.giftIds.includes(g.id) || !giftFits(d, g)) return false;
  const k = giftKind(g.kind)!;
  switch (k.type) {
    case 'pack':
      d.ownedPacks[k.pack!] = Math.min(OWNED_PACK_MAX, (d.ownedPacks[k.pack!] ?? 0) + g.count);
      break;
    case 'coins':
      addCoins(d, g.count);
      break;
    case 'card': {
      const no = cardById(k.card!)!.no;
      d.collection[no] = Math.min(OWN_MAX, (d.collection[no] ?? 0) + g.count);
      break;
    }
    default:
      return false;
  }
  d.giftIds = normalizeGiftIds([...d.giftIds, g.id]);
  return true;
}
