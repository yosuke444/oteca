import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { starterDeckNos } from '../data/starterDeck';
import { FxSettingsProvider, prefersReducedMotion } from '../fx/fxSettings';
import {
  type BackupInfo,
  loadBackupInfo,
  saveBackupInfo,
  shouldRemindBackup,
} from '../save/backupReminder';
import { type KeyValueStore, type SaveStorage, browserCookieJar, load, persist, wipe } from '../save/cookieStore';
import { type SaveData, createDefaultSave, normalizeSave } from '../save/saveData';

/**
 * 画面からセーブデータを使う窓口。
 * update() で書き換えると、その場で Cookie と localStorage に自動保存する（SPEC §7 S02「変更は自動保存」）。
 */

type UpdateOptions = {
  /** デッキを変えた（「データを まもろう」の判定に使う） */
  deck?: boolean;
};

type SaveContextValue = {
  save: SaveData;
  /** 下書きを書き換える関数を渡す。保存回数 +1 して保存する */
  update: (fn: (draft: SaveData) => void, opts?: UpdateOptions) => void;
  /** 保存するたびに増える数（「ほぞんしたよ ✓」を出す合図） */
  savedTick: number;
  /** 引き継ぎコードから復元したデータで、まるごと置き換える */
  replace: (data: SaveData) => void;
  /** データを けす：初期状態に戻す */
  reset: () => void;
  /** 引き継ぎコードを作ったことを記録する */
  markCodeCreated: () => void;
  /** メニューに「データを まもろう」を出すか */
  remindBackup: boolean;
};

const SaveContext = createContext<SaveContextValue | null>(null);

function safeLocalStorage(): KeyValueStore | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function makeStorage(): SaveStorage {
  return { jar: browserCookieJar(), local: safeLocalStorage(), secure: window.location.protocol === 'https:' };
}

function freshSave(): SaveData {
  return createDefaultSave(starterDeckNos(), prefersReducedMotion());
}

/** 起動時の読み込み。無ければ初期データ。起動のたびに保存し直して期限を延ばす（SPEC §12-5） */
function boot(storage: SaveStorage): SaveData {
  const loaded = load(storage) ?? freshSave();
  const data = { ...normalizeSave(loaded), saveCounter: loaded.saveCounter + 1 };
  persist(storage, data);
  return data;
}

export function SaveProvider({ children }: { children: ReactNode }) {
  const [storage] = useState(makeStorage);
  const [save, setSave] = useState<SaveData>(() => boot(storage));
  const [savedTick, setSavedTick] = useState(0);
  const [backup, setBackup] = useState<BackupInfo>(() => loadBackupInfo(storage.local, Date.now()));

  const commit = useCallback(
    (next: SaveData) => {
      persist(storage, next);
      setSave(next);
      setSavedTick((t) => t + 1);
    },
    [storage],
  );

  const updateBackup = useCallback(
    (patch: Partial<BackupInfo>) => {
      setBackup((cur) => {
        const next = { ...cur, ...patch };
        saveBackupInfo(storage.local, next);
        return next;
      });
    },
    [storage],
  );

  const update = useCallback<SaveContextValue['update']>(
    (fn, opts) => {
      setSave((cur) => {
        const draft = structuredClone(cur);
        fn(draft);
        const next = { ...normalizeSave(draft), saveCounter: cur.saveCounter + 1 };
        persist(storage, next);
        return next;
      });
      setSavedTick((t) => t + 1);
      if (opts?.deck) updateBackup({ deckSavedAt: Date.now() });
    },
    [storage, updateBackup],
  );

  const replace = useCallback(
    (data: SaveData) => {
      // 復元したデータの保存回数が小さくても、次の読み込みで古い方に負けないようにする
      commit({ ...normalizeSave(data), saveCounter: Math.max(save.saveCounter, data.saveCounter) + 1 });
    },
    [commit, save.saveCounter],
  );

  const reset = useCallback(() => {
    wipe(storage);
    try {
      storage.local?.removeItem('oteca_backup');
    } catch {
      // 何もしない
    }
    setBackup(loadBackupInfo(storage.local, Date.now()));
    commit({ ...freshSave(), saveCounter: 1 });
  }, [commit, storage]);

  const value = useMemo<SaveContextValue>(
    () => ({
      save,
      update,
      savedTick,
      replace,
      reset,
      markCodeCreated: () => updateBackup({ lastCodeAt: Date.now() }),
      remindBackup: shouldRemindBackup(backup, Date.now()),
    }),
    [save, update, savedTick, replace, reset, updateBackup, backup],
  );

  return (
    <SaveContext.Provider value={value}>
      <FxSettingsProvider fxSpeed={save.settings.fxSpeed} reduceFx={save.settings.reduceFx}>
        {children}
      </FxSettingsProvider>
    </SaveContext.Provider>
  );
}

export function useSave(): SaveContextValue {
  const ctx = useContext(SaveContext);
  if (!ctx) throw new Error('SaveProvider の外で useSave は使えません');
  return ctx;
}
