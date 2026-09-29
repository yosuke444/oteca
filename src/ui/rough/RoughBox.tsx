import { useMemo, type CSSProperties, type ReactNode } from 'react';
import { useBoil, useElementSize, BOIL_FRAMES } from './hooks';
import { roughPath, roundRectD, type RoughPath } from './roughShapes';
import { RoughPaths } from './RoughPaths';
import { seedFrom } from './seed';
import './rough.css';

export type RoughBoxProps = {
  /** 線の形を固定する種。画面内で要素ごとに違う文字列を渡す */
  seed: string | number;
  children?: ReactNode;
  /** 線の色（CSS変数で指定。例 'var(--pen-blue)'） */
  stroke?: string;
  strokeWidth?: number;
  roughness?: number;
  /** 角の丸み(px) */
  radius?: number;
  /** 塗りの色（CSS変数で指定）。無しなら塗らない */
  fill?: string;
  /** 'hachure'＝斜線ハッチング／'solid'＝蛍光ペン風のベタ */
  fillStyle?: 'hachure' | 'solid' | 'zigzag' | 'cross-hatch';
  /** 点線（押せない物など） */
  dashed?: boolean;
  /** 紙の白で下塗りする（下の方眼を隠す） */
  paper?: boolean;
  /** 二重線（スーパーおてあげ等） */
  double?: boolean;
  /** 二重線の内側の色（省略時は stroke と同じ） */
  innerStroke?: string;
  /** ラインボイル（選択中・スーパー・ホバー時だけ使う） */
  boil?: boolean;
  className?: string;
  style?: CSSProperties;
};

/** 線が要素の外へはみ出す分の余白 */
const BLEED = 8;

/**
 * 手描きの枠。中身の大きさを測って、rough.js の四角をうしろに描く。
 * 大きさは CSS（className / style）で決める。
 */
export function RoughBox({
  seed,
  children,
  stroke = 'var(--ink)',
  strokeWidth = 2.4,
  roughness = 1.5,
  radius = 10,
  fill,
  fillStyle = 'hachure',
  dashed = false,
  paper = false,
  double = false,
  innerStroke,
  boil = false,
  className,
  style,
}: RoughBoxProps) {
  const [ref, { w, h }] = useElementSize<HTMLDivElement>();
  const frame = useBoil(boil);
  const baseSeed = seedFrom(seed);

  // ボイル用に3パターンをまとめて作っておく（同じ引数なら再計算しない）
  const variants = useMemo(() => {
    if (w === 0 || h === 0) return [] as RoughPath[][];
    const count = boil ? BOIL_FRAMES : 1;
    const list: RoughPath[][] = [];
    for (let i = 0; i < count; i++) {
      const s = baseSeed + i * 7919;
      const paths: RoughPath[] = [];
      if (paper) {
        paths.push(
          ...roughPath(roundRectD(BLEED + 1, BLEED + 1, w - 2, h - 2, radius), {
            seed: s + 3,
            stroke: 'none',
            fill: 'var(--paper)',
            fillStyle: 'solid',
            roughness: roughness * 0.5,
          }),
        );
      }
      if (fill) {
        paths.push(
          ...roughPath(roundRectD(BLEED + 3, BLEED + 3, w - 6, h - 6, radius), {
            seed: s + 1,
            stroke: 'none',
            fill,
            fillStyle,
            roughness: roughness * 0.8,
          }),
        );
      }
      paths.push(
        ...roughPath(roundRectD(BLEED, BLEED, w, h, radius), {
          seed: s,
          stroke,
          strokeWidth,
          roughness,
          strokeLineDash: dashed ? [7, 7] : undefined,
          disableMultiStroke: dashed,
        }),
      );
      if (double) {
        paths.push(
          ...roughPath(roundRectD(BLEED + 5, BLEED + 5, w - 10, h - 10, Math.max(0, radius - 4)), {
            seed: s + 2,
            stroke: innerStroke ?? stroke,
            strokeWidth: strokeWidth * 0.7,
            roughness,
            disableMultiStroke: true,
          }),
        );
      }
      list.push(paths);
    }
    return list;
  }, [w, h, baseSeed, boil, stroke, strokeWidth, roughness, radius, fill, fillStyle, dashed, paper, double, innerStroke]);

  const paths = variants[boil ? frame % variants.length : 0] ?? [];

  return (
    <div ref={ref} className={`rough-box ${className ?? ''}`} style={style}>
      {w > 0 && (
        <svg
          className="rough-box__svg"
          width={w + BLEED * 2}
          height={h + BLEED * 2}
          style={{ left: -BLEED, top: -BLEED }}
          aria-hidden
        >
          <RoughPaths paths={paths} />
        </svg>
      )}
      <div className="rough-box__content">{children}</div>
    </div>
  );
}
