import { useMemo, type CSSProperties } from 'react';
import { roughEllipse, roughPath, roundRectD } from '../rough/roughShapes';
import { RoughPaths } from '../rough/RoughPaths';
import { seedFrom } from '../rough/seed';
import './common.css';

/**
 * 余白の落書き（おてあげ・星・サイコロ）。
 * 画面をまたいで使い回す。float=true でゆっくり上下に動く。
 */

type DoodleProps = { seed: string; size?: number; float?: boolean; className?: string; style?: CSSProperties };

function floatClass(float?: boolean) {
  return float ? 'doodle--float' : '';
}

/** おてあげ（両手を上げ下げする） */
export function OteageDoodle({ seed, size = 120, float, wave = true, className, style }: DoodleProps & { wave?: boolean }) {
  const s = seedFrom(seed);
  const body = useMemo(
    () => [
      ...roughEllipse(60, 74, 58, 58, { seed: s, strokeWidth: 2.6 }),
      ...roughPath('M48 102 L42 124 M72 102 L78 124', { seed: s + 1, strokeWidth: 2.4 }),
    ],
    [s],
  );
  const armL = useMemo(() => roughPath('M34 66 L12 34', { seed: s + 2, strokeWidth: 2.4 }), [s]);
  const armR = useMemo(() => roughPath('M86 66 L108 34', { seed: s + 3, strokeWidth: 2.4 }), [s]);
  return (
    <svg
      className={`doodle ${floatClass(float)} ${wave ? 'oteage--wave' : ''} ${className ?? ''}`}
      viewBox="0 0 120 130"
      width={size}
      height={(size * 130) / 120}
      style={style}
      aria-hidden
    >
      <RoughPaths paths={body} />
      {/* 顔 */}
      <circle cx="50" cy="70" r="3" className="doodle__dot" />
      <circle cx="70" cy="70" r="3" className="doodle__dot" />
      <path d="M52 84 Q60 91 68 84" className="doodle__line" />
      <g className="oteage__arm oteage__arm--l">
        <RoughPaths paths={armL} />
        <circle cx="11" cy="31" r="5" className="doodle__line" />
      </g>
      <g className="oteage__arm oteage__arm--r">
        <RoughPaths paths={armR} />
        <circle cx="109" cy="31" r="5" className="doodle__line" />
      </g>
    </svg>
  );
}

/** 星 */
export function StarDoodle({ seed, size = 60, float, className, style }: DoodleProps) {
  const s = seedFrom(seed);
  const paths = useMemo(
    () => roughPath('M30 4 L37 22 L56 23 L41 35 L47 54 L30 43 L13 54 L19 35 L4 23 L23 22 Z', { seed: s, strokeWidth: 2.2 }),
    [s],
  );
  return (
    <svg className={`doodle ${floatClass(float)} ${className ?? ''}`} viewBox="0 0 60 60" width={size} height={size} style={style} aria-hidden>
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
