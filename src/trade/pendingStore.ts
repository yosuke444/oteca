import type { PendingTrade } from '../net/tradeSession';
import { mayWriteSave } from '../tabLock/tabGuard';

/**
 * とちゅうの交換（最終確認で commit を送ったが、まだ交換を保存していないもの。UPDATE_v2 §9-4）を、この端末に覚えておく。
 * セーブの形式は変えない（処理済みの交換IDはセーブの trade.doneIds）。
 * 次に同じ相手と同じ部屋に入った時に、相手の記録で仕上げる・取り消す（TradeSession の resume）。
 */
const KEY = 'oteca.tradePending';

export function loadPendingTrade(store: Pick<Storage, 'getItem'> | null = safeStorage()): PendingTrade | null {
  try {
    const raw = store?.getItem(KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as PendingTrade;
    if (!p || typeof p.tradeId !== 'string' || typeof p.oppPlayerId !== 'string' || typeof p.room !== 'string' || typeof p.give !== 'object' || typeof p.get !== 'object') return null;
    return p;
  } catch {
    return null;
  }
}

export function savePendingTrade(p: PendingTrade | null, store: Pick<Storage, 'setItem' | 'removeItem'> | null = safeStorage()): void {
  if (!mayWriteSave()) return; // 止まったタブは書かない（v2.3）
  try {
    if (p) store?.setItem(KEY, JSON.stringify(p));
    else store?.removeItem(KEY);
  } catch {
    // 保存できない環境（プライベートモードなど）では覚えない
  }
}

function safeStorage(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}
