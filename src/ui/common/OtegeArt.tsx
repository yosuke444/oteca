import { useState, type CSSProperties } from 'react';
import './common.css';

/** おてあげの絵の縦横（public/images/otege_up.png。scripts/prepare-art.mjs で余白を切り取ったもの） */
const W = 304;
const H = 327;

/**
 * おてあげの絵（SPEC §7 S00）。タイトル・メニュー・よこむきにしてね・リザルトなどで使う。
 * 止まった1枚の絵として置く（揺れ・跳ね・線の震えを付けない）。白い所は乗算で表示して方眼を透かす。
 * 画像が無い時は、同じ大きさの空きにする（まわりの並びがくずれないように）。
 */
export function OtegeArt({ width, className, style }: { width: number; className?: string; style?: CSSProperties }) {
  const [missing, setMissing] = useState(false);
  return (
    <img
      className={`otege-art ${missing ? 'is-missing' : ''} ${className ?? ''}`}
      src={`${import.meta.env.BASE_URL}images/otege_up.png`}
      width={width}
      height={Math.round((width * H) / W)}
      style={style}
      alt=""
      aria-hidden
      draggable={false}
      onError={() => setMissing(true)}
    />
  );
}
