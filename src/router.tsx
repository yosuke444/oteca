import { createContext, useContext } from 'react';

/**
 * 画面の行き先（SPEC §3）。
 * story は 🔒後で実装。今は「じゅんびちゅう」画面を返す（SPEC §13-5）。gacha は v2.0-E で作った。
 * tutorial（S13）と name（S12 なまえ）は v2.0-T で作った。
 */
export type RouteId =
  | 'title'
  | 'menu'
  | 'deck'
  | 'lobby'
  | 'cpu'
  | 'battle'
  | 'result'
  | 'settings'
  | 'rules'
  | 'story'
  | 'gacha'
  | 'tutorial'
  | 'name'
  | 'lang'
  | 'online'
  | 'trade'
  | 'ranking'
  | 'rate'
  /** 管理者メニュー（v2.0-J。S20） */
  | 'admin'
  /** 観戦（v2.0-J。管理者メニューの「大会閲覧」） */
  | 'spectate'
  | 'debug'
  | 'fxtest'
  | 'soundtest'
  | 'cardlab';

export type Nav = {
  route: RouteId;
  /** 画面を切り替える。payload は次の画面に渡すデータ（対戦の設定・結果など） */
  go: (to: RouteId, payload?: unknown) => void;
  /** 今の画面に渡されたデータ */
  payload: unknown;
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
