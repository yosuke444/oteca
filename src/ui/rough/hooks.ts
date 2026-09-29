import { useEffect, useLayoutEffect, useRef, useState } from 'react';

/** 要素の大きさ（拡大縮小の transform の影響を受けない素の px）を測る */
export function useElementSize<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      setSize((s) => (s.w === w && s.h === h ? s : { w, h }));
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, size] as const;
}

/** 手描きの線を震わせる数（SPEC §6-5） */
export const BOIL_FRAMES = 3;
const BOIL_FPS = 8;

/**
 * ラインボイル：active の間、0〜2 を 1秒に8回切り替える。
 * 使ってよいのは「選択中」「スーパーおてあげ」「押せるボタンにマウスを乗せた時」だけ。
 */
export function useBoil(active: boolean): number {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    if (!active) {
      setFrame(0);
      return;
    }
    const id = window.setInterval(() => setFrame((f) => (f + 1) % BOIL_FRAMES), 1000 / BOIL_FPS);
    return () => window.clearInterval(id);
  }, [active]);
  return frame;
}
