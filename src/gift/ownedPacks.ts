import { DAILY } from '../daily/daily';
import { PACK_DATA, type PackDef } from '../data/packs';
import { type Bag, type PullResult, type Rand, applyBags, drawBags } from '../gacha/gacha';
import type { SaveData } from '../save/saveData';

/**
 * もっている パック（v2.7。贈り物で届いた大会パックなど）。ガチャ画面から好きな時に開ける（期限なし）。
 * 開け方はデイリーパックと同じ：袋の数（daily.json の allClear.bags）・光らない（売らないパック）・被りの決まり（applyBags）
 */

/** 1つ開けた時の袋の数（デイリーパックと同じ） */
export const OWNED_PACK_BAGS: number = DAILY.allClear.bags;

/** もっている パック（packs.json にあるものだけ。並びは packs.json の順） */
export function ownedPackList(save: Pick<SaveData, 'ownedPacks'>): { pack: PackDef; count: number }[] {
  return PACK_DATA.packs.filter((p) => (save.ownedPacks[p.id] ?? 0) > 0).map((pack) => ({ pack, count: save.ownedPacks[pack.id] }));
}

/** 1つ開ける袋を引く（保存はしない。画面は引いてから consumeOwnedPack で1回の保存にする） */
export function drawOwnedPack(pack: PackDef, rand: Rand): Bag[] {
  return drawBags(pack, OWNED_PACK_BAGS, rand);
}

/**
 * もっている パックを1つ減らし、引いた袋のカードを所持数に足す（同じ下書きに1回で）。もっていなければ null（何もしない）
 */
export function consumeOwnedPack(d: Pick<SaveData, 'ownedPacks' | 'collection'>, packId: string, bags: Bag[]): PullResult[] | null {
  const n = d.ownedPacks[packId] ?? 0;
  if (n <= 0) return null;
  if (n === 1) delete d.ownedPacks[packId];
  else d.ownedPacks[packId] = n - 1;
  return applyBags(d, bags);
}
