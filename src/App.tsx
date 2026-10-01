import { useCallback, useEffect, useMemo, useState, type ComponentType } from 'react';
import { audio } from './audio/audioManager';
import type { BgmKey } from './audio/soundMap';
import { useSave } from './state/SaveContext';
import { NavContext, type Nav, type RouteId } from './router';
import { Stage } from './ui/common/Stage';
import { RotateHint } from './ui/common/RotateHint';
import { PageTurn, turnPage } from './ui/common/PageTurn';
import { TitleScene } from './scenes/Title/TitleScene';
import { MenuScene } from './scenes/Menu/MenuScene';
import { DeckEditScene } from './scenes/DeckEdit/DeckEditScene';
import { SettingsScene } from './scenes/Settings/SettingsScene';
import { BattleScene } from './scenes/Battle/BattleScene';
import { ResultScene } from './scenes/Result/ResultScene';
import { DebugScene } from './scenes/Debug/DebugScene';
import { LobbyScene } from './scenes/Lobby/LobbyScene';
import { CpuScene } from './scenes/Cpu/CpuScene';
import { FxTestScene } from './scenes/Debug/FxTestScene';
import { SoundTestScene } from './scenes/Debug/SoundTestScene';
import { RulesScene } from './scenes/Rules/RulesScene';
import { ComingSoonScene } from './scenes/Placeholder/PlaceholderScene';

/**
 * ルーター：行き先 → 画面 の対応表（SPEC §3、§13-5）
 */
const ROUTES: Record<RouteId, ComponentType> = {
  title: TitleScene,
  menu: MenuScene,
  deck: DeckEditScene,
  lobby: LobbyScene,
  cpu: CpuScene,
  battle: BattleScene,
  result: ResultScene,
  settings: SettingsScene,
  rules: RulesScene,
  debug: DebugScene,
  fxtest: FxTestScene,
  soundtest: SoundTestScene,
  // 🔒 後で実装
  story: ComingSoonScene,
  gacha: ComingSoonScene,
};

/**
 * 画面ごとの BGM（SPEC §10-2）。undefined の画面は、その画面が自分で決める。
 * 対戦は戦闘曲（battle フォルダの曲をシャッフル）。リザルトは止める（ジングルを聞かせるため）
 */
const ROUTE_BGM: Record<RouteId, BgmKey | null | undefined> = {
  title: 'bgm_title',
  menu: 'bgm_title',
  story: 'bgm_title',
  gacha: 'bgm_title',
  debug: 'bgm_title',
  deck: 'bgm_deck',
  settings: 'bgm_deck',
  rules: 'bgm_deck',
  lobby: 'bgm_lobby',
  cpu: 'bgm_lobby',
  battle: 'battle',
  fxtest: undefined,
  result: null,
  soundtest: null,
};

export function App() {
  const [nav, setNav] = useState<{ route: RouteId; payload: unknown; n: number }>({ route: 'title', payload: null, n: 0 });
  const go = useCallback((to: RouteId, payload?: unknown) => {
    // ノートのページが右下からめくれる（いまの画面を写し取ってからめくる）
    turnPage(document.querySelector<HTMLElement>('.stage'));
    setNav((cur) => ({ route: to, payload: payload ?? null, n: cur.n + 1 }));
  }, []);
  const value = useMemo<Nav>(() => ({ route: nav.route, payload: nav.payload, go }), [nav, go]);
  const Scene = ROUTES[nav.route];
  const { save } = useSave();

  // 画面に触ったら、いつでも音を有効にし直す（スマホで裏に回して戻った時など）
  useEffect(() => {
    // iPhone は touchend・click でないと再開を許さないことがあるので、いくつかの操作で試す
    const on = () => audio.unlock();
    const kinds = ['pointerdown', 'touchend', 'click', 'keydown'] as const;
    kinds.forEach((k) => document.addEventListener(k, on, { capture: true, passive: true }));
    // アプリを切り替えて戻った時（画面が見えるようになった時）も再開を試す（だめでも次に触れば再開する）
    const onVisible = () => {
      if (document.visibilityState === 'visible') audio.unlock();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      kinds.forEach((k) => document.removeEventListener(k, on, { capture: true }));
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  // 音量は設定の値（0〜10）
  useEffect(() => audio.setVolumes(save.settings.bgm, save.settings.se), [save.settings.bgm, save.settings.se]);
  // 画面が変わったら BGM を切り替える（0.8秒のクロスフェード）
  useEffect(() => {
    const bgm = ROUTE_BGM[nav.route];
    if (bgm !== undefined) audio.playBgm(bgm);
  }, [nav.route]);

  return (
    <NavContext.Provider value={value}>
      <Stage>
        <Scene key={`${nav.route}-${nav.n}`} />
      </Stage>
      <PageTurn />
      <RotateHint />
    </NavContext.Provider>
  );
}
