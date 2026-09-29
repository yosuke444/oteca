import type { CSSProperties } from 'react';
import { RoughBox } from '../rough/RoughBox';
import './card.css';

/** カードの裏面：方眼ノートを四つ折りにした絵＋「オテカ」の手書きロゴ（SPEC §6-6） */
export function CardBack({
  seed,
  width,
  height,
  className,
  style,
}: {
  seed: string;
  width: number;
  height: number;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <RoughBox seed={seed} className={`card-back ${className ?? ''}`} paper radius={6} strokeWidth={2.2} style={{ width, height, ...style }}>
      <div className="card-back__grid" />
      {/* 四つ折りの折り目 */}
      <span className="card-back__fold card-back__fold--v" />
      <span className="card-back__fold card-back__fold--h" />
      <span className="card-back__corner" />
      <span className="card-back__logo" style={{ fontSize: Math.round(width * 0.24) }}>
        オテカ
      </span>
    </RoughBox>
  );
}
