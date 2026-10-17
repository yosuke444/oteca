import giftsJson from '../../../src/data/gifts.json';
import { isUserId } from '../../../src/save/userId';

/**
 * 贈り物（v2.7。SPEC §7 S20）の決まり。Cloudflare に関係しない、ふつうの処理だけ（テストしやすいように）。
 * 種類は src/data/gifts.json（ゲームと同じもの）
 */

/** 一度にまとめて贈れる人数 */
export const GIFT_BATCH_MAX = 100;

type Kind = { id: string; type: string; defaultCount: number; maxCount: number };
const KINDS = (giftsJson as { kinds: Kind[] }).kinds;

/** 贈れる種類（トロフィあげは番号の決まりがあるので、ここでは扱わない） */
export function giftKindOf(id: unknown): Kind | null {
  const k = KINDS.find((x) => x.id === id);
  return k && k.type !== 'trophy' ? k : null;
}

/** 1人に贈る数（1〜maxCount の整数でなければ null） */
export function giftCount(kind: Kind, n: unknown): number | null {
  return Number.isInteger(n) && (n as number) >= 1 && (n as number) <= kind.maxCount ? (n as number) : null;
}

/**
 * まとめて入れたユーザーID を読む：改行・カンマ・スペース（全角も）で区切り、5-5-5 の - は無視。
 * @returns ids：形の正しいID（同じIDは1つ・入れた順）、bad：形の正しくないもの
 */
export function parseUserIds(input: unknown): { ids: string[]; bad: string[] } {
  const parts = Array.isArray(input) ? input.map(String) : typeof input === 'string' ? input.split(/[\s,、，　]+/) : [];
  const ids: string[] = [];
  const bad: string[] = [];
  for (const p of parts) {
    const raw = p.trim();
    if (!raw) continue;
    const id = raw.replace(/[-ー－‐]/g, '').replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
    if (isUserId(id)) {
      if (!ids.includes(id)) ids.push(id);
    } else if (!bad.includes(raw)) bad.push(raw);
  }
  return { ids, bad };
}

/**
 * トロフィーの番号を、start から順に空いている番号で配る（使われている番号は飛ばす）。
 * @returns 人ごとの番号（足りなければ、その人は null）
 */
export function assignTrophyNumbers(count: number, start: number, used: Set<number>, max: number): (number | null)[] {
  const out: (number | null)[] = [];
  let n = Math.max(1, start);
  for (let i = 0; i < count; i++) {
    while (n <= max && used.has(n)) n++;
    out.push(n <= max ? n : null);
    if (n <= max) used.add(n);
  }
  return out;
}
