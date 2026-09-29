import { useRef, type PointerEvent as RPointerEvent, type MouseEvent as RMouseEvent } from 'react';

/** これ以上動いたらドラッグ（舞台の座標で px） */
const DRAG_START = 10;
const LONG_PRESS_MS = 450;

export type DragInfo = {
  uid: string;
  /** 画面上の指の位置（clientX/Y） */
  clientX: number;
  clientY: number;
};

export type GestureHandlers = {
  onTap: (uid: string) => void;
  onLongPress: (uid: string) => void;
  /** ドラッグしてよいカードか */
  canDrag: (uid: string) => boolean;
  onDragStart: (uid: string, el: HTMLElement) => void;
  onDragMove: (info: DragInfo) => void;
  /** 指を離した場所の「置ける場所」キー（無ければ null） */
  onDrop: (uid: string, dropKey: string | null) => void;
};

/**
 * カードの操作：タップ／長押し・右クリック／ドラッグ＆ドロップ（SPEC §8-2）
 * ドロップ先は data-drop 属性を持つ要素。
 */
export function useCardGesture(h: GestureHandlers) {
  const st = useRef<{
    uid: string;
    el: HTMLElement;
    x: number;
    y: number;
    dragging: boolean;
    longFired: boolean;
    timer: number | null;
    pointerId: number;
  } | null>(null);
  const handlers = useRef(h);
  handlers.current = h;

  const clear = () => {
    if (st.current?.timer) window.clearTimeout(st.current.timer);
    st.current = null;
  };

  const dropKeyAt = (x: number, y: number): string | null => {
    for (const el of document.elementsFromPoint(x, y)) {
      const target = (el as HTMLElement).closest?.('[data-drop]') as HTMLElement | null;
      if (target) return target.dataset.drop ?? null;
    }
    return null;
  };

  return (uid: string) => ({
    onPointerDown: (e: RPointerEvent<HTMLElement>) => {
      if (e.button !== 0) return;
      clear();
      const el = e.currentTarget;
      const timer = window.setTimeout(() => {
        if (st.current && !st.current.dragging) {
          st.current.longFired = true;
          handlers.current.onLongPress(uid);
        }
      }, LONG_PRESS_MS);
      st.current = { uid, el, x: e.clientX, y: e.clientY, dragging: false, longFired: false, timer, pointerId: e.pointerId };
      el.setPointerCapture?.(e.pointerId);
    },
    onPointerMove: (e: RPointerEvent<HTMLElement>) => {
      const s = st.current;
      if (!s || s.uid !== uid || s.longFired) return;
      const scale = s.el.getBoundingClientRect().width / (s.el.offsetWidth || 1) || 1;
      const moved = Math.hypot(e.clientX - s.x, e.clientY - s.y) / scale;
      if (!s.dragging && moved > DRAG_START && handlers.current.canDrag(uid)) {
        s.dragging = true;
        if (s.timer) window.clearTimeout(s.timer);
        handlers.current.onDragStart(uid, s.el);
      }
      if (s.dragging) handlers.current.onDragMove({ uid, clientX: e.clientX, clientY: e.clientY });
    },
    onPointerUp: (e: RPointerEvent<HTMLElement>) => {
      const s = st.current;
      if (!s || s.uid !== uid) return;
      if (s.dragging) handlers.current.onDrop(uid, dropKeyAt(e.clientX, e.clientY));
      else if (!s.longFired) handlers.current.onTap(uid);
      clear();
    },
    onPointerCancel: () => {
      const s = st.current;
      if (s?.dragging) handlers.current.onDrop(s.uid, null);
      clear();
    },
    onContextMenu: (e: RMouseEvent) => {
      e.preventDefault();
      clear();
      handlers.current.onLongPress(uid);
    },
  });
}
