import type { KeyValueStore } from './cookieStore';

/**
 * 「データを まもろう」ふせんの判定（SPEC §12-6）
 * デッキを保存した後、最後にコードを作ってから7日以上たっていたら表示する。
 * 日時はこの端末だけの情報なので、セーブデータ（コードに入る）には入れず localStorage に置く。
 */

const KEY = 'oteca_backup';
export const REMIND_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

export type BackupInfo = {
  /** この端末で初めて起動した日時（コードをまだ作っていない時の起点） */
  firstSeenAt: number;
  /** 最後にコードを作った日時 */
  lastCodeAt: number | null;
  /** 最後にデッキを保存した日時 */
  deckSavedAt: number | null;
};

export function loadBackupInfo(store: KeyValueStore | null, now: number): BackupInfo {
  try {
    const raw = store?.getItem(KEY);
    if (raw) {
      const v = JSON.parse(raw) as Partial<BackupInfo>;
      if (typeof v.firstSeenAt === 'number') {
        return { firstSeenAt: v.firstSeenAt, lastCodeAt: v.lastCodeAt ?? null, deckSavedAt: v.deckSavedAt ?? null };
      }
    }
  } catch {
    // 壊れていたら作り直す
  }
  const info = { firstSeenAt: now, lastCodeAt: null, deckSavedAt: null };
  saveBackupInfo(store, info);
  return info;
}

export function saveBackupInfo(store: KeyValueStore | null, info: BackupInfo): void {
  try {
    store?.setItem(KEY, JSON.stringify(info));
  } catch {
    // 保存できなくても動作は続ける
  }
}

export function shouldRemindBackup(info: BackupInfo, now: number): boolean {
  if (info.deckSavedAt === null) return false;
  const since = info.lastCodeAt ?? info.firstSeenAt;
  return info.deckSavedAt >= since && now - since >= REMIND_AFTER_MS;
}
