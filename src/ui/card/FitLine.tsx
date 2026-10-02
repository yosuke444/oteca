import { useLayoutEffect, useRef, type ReactNode } from 'react';

/**
 * 1行に収まらない時だけ、横に縮めて枠に収める（技表の効果。v2.0 で長い効果が増えたため）。
 * 縮めるのは見た目だけ（transform）。文字は切らない
 */
export function FitLine({ children, className }: { children: ReactNode; className?: string }) {
  const outer = useRef<HTMLSpanElement>(null);
  const inner = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const o = outer.current;
    const i = inner.current;
    if (!o || !i) return;
    const fit = () => {
      i.style.transform = '';
      const room = o.clientWidth;
      const need = i.scrollWidth;
      i.style.transform = need > room && room > 0 ? `scaleX(${Math.max(0.4, room / need)})` : '';
    };
    fit();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(fit);
    ro.observe(o);
    return () => ro.disconnect();
  });
  return (
    <span ref={outer} className={`fit-line ${className ?? ''}`}>
      <span ref={inner} className="fit-line__inner">
        {children}
      </span>
    </span>
  );
}
