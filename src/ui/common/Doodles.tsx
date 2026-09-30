import { useMemo, type CSSProperties } from 'react';
import { roughPath, roundRectD } from '../rough/roughShapes';
import { RoughPaths } from '../rough/RoughPaths';
import { seedFrom } from '../rough/seed';
import './common.css';

/**
 * 余白の落書き（星・サイコロ）。おてあげは絵（OtegeArt.tsx）。
 * 画面をまたいで使い回す。float=true でゆっくり上下に動く。
 */

type DoodleProps = { seed: string; size?: number; float?: boolean; className?: string; style?: CSSProperties };

function floatClass(float?: boolean) {
  return float ? 'doodle--float' : '';
}

/** 星の形 */
const STAR_D = 'M30 4 L37 22 L56 23 L41 35 L47 54 L30 43 L13 54 L19 35 L4 23 L23 22 Z';

/** 星 */
export function StarDoodle({ seed, size = 60, float, className, style }: DoodleProps) {
  const s = seedFrom(seed);
  const paths = useMemo(() => roughPath(STAR_D, { seed: s, strokeWidth: 2.2 }), [s]);
  return (
    <svg className={`doodle ${floatClass(float)} ${className ?? ''}`} viewBox="0 0 60 60" width={size} height={size} style={style} aria-hidden>
      {/* 塗り用（rough.js の線は細切れなので、塗りは普通の星の形で行う） */}
      <path d={STAR_D} className="doodle__fill" />
      <RoughPaths paths={paths} />
    </svg>
  );
}

/** サイコロの目の位置（1〜6） */
const PIPS: Record<number, [number, number][]> = {
  1: [[0.5, 0.5]],
  2: [[0.28, 0.28], [0.72, 0.72]],
  3: [[0.28, 0.28], [0.5, 0.5], [0.72, 0.72]],
  4: [[0.28, 0.28], [0.72, 0.28], [0.28, 0.72], [0.72, 0.72]],
  5: [[0.28, 0.28], [0.72, 0.28], [0.5, 0.5], [0.28, 0.72], [0.72, 0.72]],
  6: [[0.28, 0.25], [0.72, 0.25], [0.28, 0.5], [0.72, 0.5], [0.28, 0.75], [0.72, 0.75]],
};

/** 手描きサイコロ（目 1〜6） */
export function DiceDoodle({ seed, size = 56, face = 5, float, className, style }: DoodleProps & { face?: number }) {
  const s = seedFrom(seed);
  const frame = useMemo(() => roughPath(roundRectD(4, 4, 52, 52, 9), { seed: s, strokeWidth: 2.4 }), [s]);
  return (
    <svg className={`doodle ${floatClass(float)} ${className ?? ''}`} viewBox="0 0 60 60" width={size} height={size} style={style} aria-hidden>
      <RoughPaths paths={frame} />
      {(PIPS[face] ?? PIPS[1]).map(([x, y], i) => (
        <circle key={i} cx={4 + x * 52} cy={4 + y * 52} r={face === 1 ? 6 : 4.2} className="doodle__dot" />
      ))}
    </svg>
  );
}
