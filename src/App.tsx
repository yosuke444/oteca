import { useCallback, useMemo, useState, type ComponentType } from 'react';
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
  soundtest: UnderConstructionScene,
  // 🔒 後で実装
  story: ComingSoonScene,
  gacha: ComingSoonScene,
};

export function App() {
  const [nav, setNav] = useState<{ route: RouteId; payload: unknown; n: number }>({ route: 'title', payload: null, n: 0 });
  const go = useCallback((to: RouteId, payload?: unknown) => setNav((cur) => ({ route: to, payload: payload ?? null, n: cur.n + 1 })), []);
  const value = useMemo<Nav>(() => ({ route: nav.route, payload: nav.payload, go }), [nav, go]);
  const Scene = ROUTES[nav.route];

  return (
    <NavContext.Provider value={value}>
      <Stage>
        <Scene key={`${nav.route}-${nav.n}`} />
      </Stage>
      <RotateHint />
    </NavContext.Provider>
  );
}
