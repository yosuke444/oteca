import { useCallback, useEffect, useMemo, useState, type ComponentType } from 'react';
import { audio } from './audio/audioManager';
import type { BgmKey } from './audio/soundMap';
import { useSave } from './state/SaveContext';
import { NavContext, type Nav, type RouteId } from './router';
import { Stage } from './ui/common/Stage';
import { RotateHint } from './ui/common/RotateHint';
import { TitleScene } from './scenes/Title/TitleScene';
import { MenuScene } from './scenes/Menu/MenuScene';
import { DeckEditScene } from './scenes/DeckEdit/DeckEditScene';
import { SettingsScene } from './scenes/Settings/SettingsScene';
import { BattleScene } from './scenes/Battle/BattleScene';
import { ResultScene } from './scenes/Result/ResultScene';
import { DebugScene } from './scenes/Debug/DebugScene';
import { LobbyScene } from './scenes/Lobby/LobbyScene';
import { FxTestScene } from './scenes/Debug/FxTestScene';
import { ComingSoonScene, UnderConstructionScene } from './scenes/Placeholder/PlaceholderScene';

/**
 * ルーター：行き先 → 画面 の対応表（SPEC §3、§13-5）
 */
const ROUTES: Record<RouteId, ComponentType> = {
  title: TitleScene,
  menu: MenuScene,
  deck: DeckEditScene,
  lobby: LobbyScene,
  battle: BattleScene,
  result: ResultScene,
  settings: SettingsScene,
  rules: UnderConstructionScene,
  debug: DebugScene,
  fxtest: FxTestScene,
  soundtest: UnderConstructionScene,
  // 🔒 後で実装
  story: ComingSoonScene,
  gacha: ComingSoonScene,
};

/**
 * 画面ごとの BGM（SPEC §10-2）。undefined の画面は、その画面が自分で決める（対戦はピンチで切り替える）
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
  battle: undefined,
  fxtest: undefined,
  result: null,
  soundtest: null,
};

export function App() {
  const [nav, setNav] = useState<{ route: RouteId; payload: unknown; n: number }>({ route: 'title', payload: null, n: 0 });
  const go = useCallback((to: RouteId, payload?: unknown) => setNav((cur) => ({ route: to, payload: payload ?? null, n: cur.n + 1 })), []);
  const value = useMemo<Nav>(() => ({ route: nav.route, payload: nav.payload, go }), [nav, go]);
  const Scene = ROUTES[nav.route];
  const { save } = useSave();

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
      <RotateHint />
    </NavContext.Provider>
  );
}
