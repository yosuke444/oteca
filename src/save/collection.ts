import { features } from '../config/features';
import type { SaveData } from './saveData';

/**
 * 所持カードの窓口（SPEC §13-2）
 * デッキ編集は、カードを使えるかどうかを必ずここ経由で調べる。
 * 今は unlockAll が true なので常に「無制限」。ガチャを作る時はこの中身だけ変える。
 */
export function getOwnedCount(save: SaveData, no: number): number {
  if (!features.collection || save.unlockAll) return Infinity;
  return save.collection.find((c) => c.no === no)?.qty ?? 0;
}
