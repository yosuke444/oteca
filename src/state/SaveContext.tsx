import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { newToken, newUserId } from '../save/userId';
import { FxSettingsProvider, prefersReducedMotion } from '../fx/fxSettings';
import {
  type BackupInfo,
  loadBackupInfo,
  saveBackupInfo,
  shouldRemindBackup,
} from '../save/backupReminder';
import { type KeyValueStore, type SaveStorage, browserCookieJar, load, persist, wipe } from '../save/cookieStore';
import { type SaveData, createDefaultSave, normalizeSave } from '../save/saveData';
import { t } from '../i18n';
import { mayWriteSave } from '../tabLock/tabGuard';
import { switchFromTooManySuper } from '../save/collection';

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
/** 練習用の写しの中で、外側の本物のセーブ（写しの外では null） */
const RealSaveContext = createContext<SaveContextValue | null>(null);

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
  return createDefaultSave(prefersReducedMotion());
}

/** ランダムな8バイトの ID（16桁の16進数） */
export function randomId(): string {
  const b = new Uint8Array(8);
  crypto.getRandomValues(b);
  const hex = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return /^0+$/.test(hex) ? randomId() : hex;
}

/** playerId・ユーザーID がまだ無ければ作る（新しいセーブ・古いセーブからの移行・引き継ぎ。ユーザーID は1回だけ。v2.0-J） */
function withPlayerId(data: SaveData): SaveData {
  let d = data.playerId ? data : { ...data, playerId: randomId() };
  if (!d.userId) d = { ...d, userId: newUserId(), userIdRegistered: false };
  // サーバーの合言葉（token）も起動の時に作っておく（登録を送り直しても同じ token になるように。v2.0-J）
  if (!d.ranking.token) d = { ...d, ranking: { ...d.ranking, token: newToken() } };
  return d;
}

/** 起動時の読み込み。無ければ初期データ。起動のたびに保存し直して期限を延ばす（SPEC §12-5） */
function boot(storage: SaveStorage): SaveData {
  const loaded = load(storage) ?? freshSave();
  const data = switchFromTooManySuper(withPlayerId({ ...normalizeSave(loaded), saveCounter: loaded.saveCounter + 1 }));
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
      commit(switchFromTooManySuper(withPlayerId({ ...normalizeSave(data), saveCounter: Math.max(save.saveCounter, data.saveCounter) + 1 })));
    },
    [commit, save.saveCounter],
  );

  const reset = useCallback(() => {
    if (!mayWriteSave()) return; // 止まったタブは消さない（v2.3）
    wipe(storage);
    try {
      storage.local?.removeItem('oteca_backup');
    } catch {
      // 何もしない
    }
    setBackup(loadBackupInfo(storage.local, Date.now()));
    commit(withPlayerId({ ...freshSave(), saveCounter: 1 }));
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
  if (!ctx) throw new Error(t().common.providerMissing('SaveProvider'));
  return ctx;
}

/**
 * 練習用の写し（チュートリアルの見返し。UPDATE_v2_1 §6-3）：いまのセーブの写しを渡し、書き換えても本物には保存しない。
 * コインは減らない（keepCoins の枚数のまま）。中の画面は、ふつうの useSave() のまま使える
 */
export function SandboxSaveProvider({ children, keepCoins }: { children: ReactNode; keepCoins: number }) {
  const real = useRealSave();
  const [save, setSave] = useState<SaveData>(() => ({ ...structuredClone(real.save), coins: keepCoins }));
  const [savedTick, setSavedTick] = useState(0);
  const update = useCallback<SaveContextValue['update']>((fn) => {
    setSave((cur) => {
      const draft = structuredClone(cur);
      fn(draft);
      return { ...normalizeSave(draft), coins: keepCoins, saveCounter: cur.saveCounter + 1 };
    });
    setSavedTick((t) => t + 1);
  }, [keepCoins]);
  const value = useMemo<SaveContextValue>(
    () => ({
      save,
      update,
      savedTick,
      // 写しでは、引き継ぎ・まっさらにする などは何もしない
      replace: () => {},
      reset: () => {},
      markCodeCreated: () => {},
      remindBackup: false,
    }),
    [save, update, savedTick],
  );
  return (
    <RealSaveContext.Provider value={real}>
      <SaveContext.Provider value={value}>{children}</SaveContext.Provider>
    </RealSaveContext.Provider>
  );
}

/** 本物のセーブ（練習用の写しの中でも本物。チュートリアルを終えた印などを書く時に使う） */
export function useRealSave(): SaveContextValue {
  const real = useContext(RealSaveContext);
  const cur = useSave();
  return real ?? cur;
}

/** 練習用の写しの中か（写しの中では、セーブの外の知らせ（localStorage）を書かない） */
export function useIsSandbox(): boolean {
  return useContext(RealSaveContext) !== null;
}
