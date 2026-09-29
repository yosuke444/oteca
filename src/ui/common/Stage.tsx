import { useEffect, useState, type ReactNode } from 'react';
import './common.css';

/** 基準解像度（SPEC §6-2） */
export const STAGE_W = 1280;
export const STAGE_H = 720;

/**
 * 1280×720 の舞台を、画面サイズに合わせて拡大縮小して中央に置く。
 * 方眼は body に敷いてあるので、余白にも方眼が続く（黒帯なし）。
 */
export function Stage({ children }: { children: ReactNode }) {
  const [box, setBox] = useState(calc);

  useEffect(() => {
    const onResize = () => setBox(calc());
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
    };
  }, []);

  return (
    <div
      className="stage"
      style={{
        width: STAGE_W,
        height: STAGE_H,
        left: box.left,
        top: box.top,
        transform: `scale(${box.scale})`,
      }}
    >
      {children}
    </div>
  );
}

function calc() {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const scale = Math.min(vw / STAGE_W, vh / STAGE_H);
  return { scale, left: (vw - STAGE_W * scale) / 2, top: (vh - STAGE_H * scale) / 2 };
}
