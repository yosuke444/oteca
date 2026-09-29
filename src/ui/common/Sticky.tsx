import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react';
import { useFx } from '../../fx/fxSettings';
import { tiltFrom } from '../rough/seed';
import './common.css';

export type StickyColor = 'yellow' | 'green' | 'red' | 'purple' | 'blue';

export type StickyProps = {
  children: ReactNode;
  /** 傾きを固定する種 */
  seed: string;
  color?: StickyColor;
  /** 傾きの大きさ（度）。省略時は ±6° の範囲で seed から決める */
  angle?: number;
  /** この数が変わるたびに「プルッ」と揺れる */
  shake?: number;
  className?: string;
  style?: CSSProperties;
};

/**
 * ふせん（SPEC §6-6 アイテムカード・§7 じゅんびちゅう）
 * 少し傾いた四角＋上端に粘着部分の影。
 */
export function Sticky({ children, seed, color = 'yellow', angle, shake = 0, className, style }: StickyProps) {
  const ref = useRef<HTMLDivElement>(null);
  const { dur } = useFx();
  const deg = angle ?? tiltFrom(seed, 6);

  useEffect(() => {
    if (shake === 0 || !ref.current) return;
    // 上端（のり）を軸に、プルッと揺れる
    ref.current.animate(
      [
        { transform: `rotate(${deg}deg)` },
        { transform: `rotate(${deg + 9}deg)` },
        { transform: `rotate(${deg - 7}deg)` },
        { transform: `rotate(${deg + 4}deg)` },
        { transform: `rotate(${deg - 2}deg)` },
        { transform: `rotate(${deg}deg)` },
      ],
      { duration: dur(520), easing: 'ease-out' },
    );
    // 揺れの合図（shake）が変わった時だけ動かす
  }, [shake]);

  return (
    <div
      ref={ref}
      className={`sticky sticky--${color} ${className ?? ''}`}
      style={{ transform: `rotate(${deg}deg)`, ...style }}
    >
      {children}
    </div>
  );
}
