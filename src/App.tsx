import { useMemo, useState, type ComponentType } from 'react';
import { NavContext, type Nav, type RouteId } from './router';
import { Stage } from './ui/common/Stage';
import { RotateHint } from './ui/common/RotateHint';
import { TitleScene } from './scenes/Title/TitleScene';
import { MenuScene } from './scenes/Menu/MenuScene';
import { ComingSoonScene, UnderConstructionScene } from './scenes/Placeholder/PlaceholderScene';

/**
 * ルーター：行き先 → 画面 の対応表。
 * まだ作っていない画面は「つくっている とちゅう」を返す（フェーズ2以降で差し替える）。
 */
const ROUTES: Record<RouteId, ComponentType> = {
  title: TitleScene,
  menu: MenuScene,
  deck: UnderConstructionScene,
  lobby: UnderConstructionScene,
  battle: UnderConstructionScene,
  result: UnderConstructionScene,
  settings: UnderConstructionScene,
  rules: UnderConstructionScene,
  debug: UnderConstructionScene,
  // 🔒 後で実装
  story: ComingSoonScene,
  gacha: ComingSoonScene,
};

export function App() {
  const [route, setRoute] = useState<RouteId>('title');
  const nav = useMemo<Nav>(() => ({ route, go: setRoute }), [route]);
  const Scene = ROUTES[route];

  return (
    <NavContext.Provider value={nav}>
      <Stage>
        <Scene key={route} />
      </Stage>
      <RotateHint />
    </NavContext.Provider>
  );
}
