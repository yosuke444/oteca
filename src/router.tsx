import { createContext, useContext } from 'react';

/**
 * 画面の行き先（SPEC §3）。
 * story・gacha は 🔒後で実装。今は「じゅんびちゅう」画面を返す（SPEC §13-5）。
 */
export type RouteId =
  | 'title'
  | 'menu'
  | 'deck'
  | 'lobby'
  | 'battle'
  | 'result'
  | 'settings'
  | 'rules'
  | 'story'
  | 'gacha'
  | 'debug';

export type Nav = {
  route: RouteId;
  go: (to: RouteId) => void;
};

export const NavContext = createContext<Nav | null>(null);

export function useNav(): Nav {
  const nav = useContext(NavContext);
  if (!nav) throw new Error('NavContext の外で useNav は使えません');
  return nav;
}

/** URL に ?debug=1 が付いている時だけ true（S99 デバッグ対戦） */
export function isDebugMode(): boolean {
  return new URLSearchParams(window.location.search).get('debug') === '1';
}
