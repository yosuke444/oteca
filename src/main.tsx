import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { audio } from './audio/audioManager';
import { setLang } from './i18n';
import { endOnline, endSpectator } from './net/online';
import { isDebugMode } from './router';
import { browserCookieJar, load, persist } from './save/cookieStore';
import { SaveProvider } from './state/SaveContext';
import { TabBlockedScreen } from './tabLock/TabBlockedScreen';
import { type TabState, browserTabEnv, tabGuard } from './tabLock/tabGuard';
import './ui/theme.css';

const root = createRoot(document.getElementById('root')!);

/** セーブを読むだけの道具（止まったタブで言語を知る・確認用の書き込み） */
function saveStorage() {
  let local: Storage | null = null;
  try {
    local = window.localStorage;
  } catch {
    local = null;
  }
  return { jar: browserCookieJar(), local, secure: window.location.protocol === 'https:' };
}

/**
 * 複数のタブ（v2.3）：動いてよいタブだけアプリを動かす。
 * 止まったタブはアプリを外し（画面ごとの通信・タイマーは片付けで止まる）、部屋の通信と音も止める
 */
function render(state: TabState) {
  if (state === 'active') {
    audio.setHalted(false);
    root.render(
      <StrictMode>
        <SaveProvider>
          <App />
        </SaveProvider>
      </StrictMode>,
    );
    return;
  }
  audio.setHalted(true);
  if (state === 'stolen') {
    endOnline();
    endSpectator();
  }
  if (state === 'checking' || state === 'off') {
    root.render(null);
    return;
  }
  // 画面の言葉は、セーブの設定を読むだけで決める（書かない）
  setLang(load(saveStorage())?.settings.lang ?? 'hira');
  root.render(
    <TabBlockedScreen
      key={state}
      kind={state === 'blocked' ? 'other' : 'stolen'}
      otherInBattle={() => tabGuard.otherInBattle()}
      onPlayHere={() => tabGuard.takeOver()}
    />,
  );
}

tabGuard.subscribe(render);
render('checking');
void tabGuard.start(browserTabEnv());

// 確認用（?debug=1）：止まったタブから「あとでセーブを書こうとした」ことを再現する（scripts/tabs-e2e.mjs）
if (isDebugMode()) {
  const w = window as unknown as { __otecaTab?: unknown };
  w.__otecaTab = {
    state: () => tabGuard.state,
    lateWrite: (coins: number) => {
      const s = saveStorage();
      const cur = load(s);
      if (cur) persist(s, { ...cur, coins, saveCounter: cur.saveCounter + 1000 });
    },
  };
}
