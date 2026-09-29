import { useMemo } from 'react';
import { RoughPaths } from './RoughPaths';
import { roughPath, roundRectD } from './roughShapes';
import { seedFrom } from './seed';

/**
 * 手描きのHPバー（SPEC §6-6）
 * 斜線ハッチングで塗る。残り51%以上＝緑、26〜50%＝黄、25%以下＝赤。
 */
export function hpColor(hp: number, max: number): string {
  const r = max > 0 ? hp / max : 0;
  if (r > 0.5) return 'var(--pen-green)';
  if (r > 0.25) return 'var(--pen-yellow)';
  return 'var(--pen-red)';
}

export function RoughHpBar({
  seed,
  hp,
  max,
  width,
  height = 14,
}: {
  seed: string;
  hp: number;
  max: number;
  width: number;
  height?: number;
}) {
  const s = seedFrom(seed);
  const ratio = max > 0 ? Math.max(0, Math.min(1, hp / max)) : 0;
  const frame = useMemo(() => roughPath(roundRectD(2, 2, width - 4, height - 4, 3), { seed: s, strokeWidth: 1.8, roughness: 1.2 }), [s, width, height]);
  const color = hpColor(hp, max);
  const fillW = Math.max(0, (width - 8) * ratio);
  const fill = useMemo(
    () =>
      fillW > 1
        ? roughPath(roundRectD(4, 4, fillW, height - 8, 1), {
            seed: s + 1,
            stroke: 'none',
            fill: color,
            fillStyle: 'hachure',
            hachureGap: 3.2,
            fillWeight: 1.6,
            hachureAngle: -50,
            roughness: 0.8,
          })
        : [],
    [s, fillW, height, color],
  );
  return (
    <svg className="rough-hpbar" width={width} height={height} aria-label={`HP ${hp} / ${max}`}>
      <RoughPaths paths={fill} />
      <RoughPaths paths={frame} />
    </svg>
  );
}
