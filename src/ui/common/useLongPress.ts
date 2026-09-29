import { useRef, type MouseEvent, type PointerEvent } from 'react';

const LONG_PRESS_MS = 450;

/**
 * 長押し／右クリックで onLongPress、ふつうのタップで onTap。
 * 長押しした直後のクリックは onTap にしない。
 */
export function useLongPress(onTap: () => void, onLongPress: () => void) {
  const timer = useRef<number | null>(null);
  const fired = useRef(false);

  const cancel = () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
  };

  return {
    onPointerDown: (e: PointerEvent) => {
      if (e.button !== 0) return;
      fired.current = false;
      cancel();
      timer.current = window.setTimeout(() => {
        fired.current = true;
        onLongPress();
      }, LONG_PRESS_MS);
    },
    onPointerUp: cancel,
    onPointerLeave: cancel,
    onPointerCancel: cancel,
    onContextMenu: (e: MouseEvent) => {
      e.preventDefault();
      cancel();
      fired.current = true;
      onLongPress();
    },
    onClick: () => {
      if (fired.current) {
        fired.current = false;
        return;
      }
      onTap();
    },
  };
}
