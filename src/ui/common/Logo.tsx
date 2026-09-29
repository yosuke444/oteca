import type { CSSProperties } from 'react';
import './common.css';

/**
 * 「オテカ」の手書きロゴ。
 * draw=true なら書き順どおりにペンで書かれていく（stroke-dashoffset 方式、SPEC §7 S00）。
 * 各画はおおよその書き順：オ（横→縦はね→左はらい）テ（上横→下横→はらい）カ（横からはね→左はらい）
 */
const STROKES: { d: string; ms: number }[] = [
  // オ
  { d: 'M12 44 Q55 38 104 36', ms: 260 },
  { d: 'M66 10 Q64 60 64 104 Q63 118 48 110', ms: 320 },
  { d: 'M62 46 Q46 84 10 104', ms: 280 },
  // テ
  { d: 'M146 20 Q180 17 214 18', ms: 220 },
  { d: 'M128 52 Q180 47 234 48', ms: 260 },
  { d: 'M182 52 Q184 92 148 116', ms: 280 },
  // カ
  { d: 'M254 44 Q300 40 340 40 Q348 42 346 54 Q340 96 322 112 Q314 118 304 106', ms: 420 },
  { d: 'M300 10 Q298 72 252 114', ms: 300 },
];

/** 画と画の間の間 */
const GAP_MS = 60;

export function Logo({
  draw = false,
  width = 360,
  className,
  style,
}: {
  draw?: boolean;
  width?: number;
  className?: string;
  style?: CSSProperties;
}) {
  let t = 200;
  return (
    <svg
      className={`logo ${draw ? 'logo--draw' : ''} ${className ?? ''}`}
      viewBox="0 0 356 126"
      width={width}
      height={(width * 126) / 356}
      style={style}
      role="img"
      aria-label="オテカ"
    >
      {STROKES.map((s, i) => {
        const delay = t;
        t += s.ms + GAP_MS;
        return (
          <path
            key={i}
            d={s.d}
            pathLength={1}
            style={{ ['--delay' as string]: delay, ['--d' as string]: s.ms }}
          />
        );
      })}
    </svg>
  );
}

/** ロゴを書き終えるまでの時間（ふつう速度, ms） */
export const LOGO_DRAW_MS = 200 + STROKES.reduce((sum, s) => sum + s.ms + GAP_MS, 0);
