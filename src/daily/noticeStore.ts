import type { DailyCarry } from './daily';
import { mayWriteSave } from '../tabLock/tabGuard';

/**
 * 「きのうの ミッションの ほうしゅうを うけとったよ」の知らせ（SPEC §7 S17・v2.1-M）。
 * 自動で受け取るのは、メニュー・リザルト・ガチャのどこでも起きるので、次にメニューを開いた時に見せるまで localStorage に置く。
 * セーブには入れない（知らせだけ。消えても報酬はセーブに入っている）。
 */
const KEY = 'oteca.dailyCarry';

/** 知らせを足す（まだ見せていない分があれば合わせる） */
export function addDailyNotice(c: DailyCarry): void {
  if (!mayWriteSave()) return; // 止まったタブは書かない（v2.3）
  try {
    const old = peekDailyNotice();
    const next: DailyCarry = old ? { coins: old.coins + c.coins, cards: [...old.cards, ...c.cards] } : c;
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // localStorage が使えない時は知らせを出さない（報酬はセーブに入っている）
  }
}

export function peekDailyNotice(): DailyCarry | null {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as DailyCarry;
    if (typeof v?.coins !== 'number' || !Array.isArray(v.cards)) return null;
    return { coins: v.coins, cards: v.cards.filter((n) => Number.isInteger(n)) };
  } catch {
    return null;
  }
}

export function clearDailyNotice(): void {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    // 何もしない
  }
}
