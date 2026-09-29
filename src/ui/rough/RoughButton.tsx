import { useState, type CSSProperties, type PointerEvent, type ReactNode } from 'react';
import { audio } from '../../audio/audioManager';
import { RoughBox } from './RoughBox';
import { tiltStyle } from './seed';

export type RoughButtonProps = {
  /** 線の形・文字の傾きを固定する種 */
  seed: string;
  children: ReactNode;
  onClick?: () => void;
  /** 押せない（えんぴつ色の点線枠） */
  disabled?: boolean;
  /** 押せない時に押されたら呼ぶ（理由を一言出す用） */
  onDisabledClick?: () => void;
  /** 「いま出来る操作」として黄色の蛍光ペンで塗っておく */
  highlight?: boolean;
  /** 線の色（CSS変数） */
  stroke?: string;
  strokeWidth?: number;
  radius?: number;
  className?: string;
  style?: CSSProperties;
  ariaLabel?: string;
};

type Ink = { id: number; x: number; y: number };

/**
 * 手描きボタン（SPEC §6-7）
 * - 通常：白地＋黒線
 * - マウスを乗せる：黄色の蛍光ペン塗り＋ラインボイル
 * - 押した瞬間：2px沈む＋インクがにじむ
 * - 押せない：えんぴつ色の点線枠
 * 大きさは className / style の width・height で決める。
 */
export function RoughButton({
  seed,
  children,
  onClick,
  disabled = false,
  onDisabledClick,
  highlight = false,
  stroke = 'var(--ink)',
  strokeWidth = 2.6,
  radius = 14,
  className,
  style,
  ariaLabel,
}: RoughButtonProps) {
  const [hover, setHover] = useState(false);
  const [pressed, setPressed] = useState(false);
  const [inks, setInks] = useState<Ink[]>([]);

  const active = !disabled && (hover || highlight);

  const handlePointerDown = (e: PointerEvent<HTMLButtonElement>) => {
    if (disabled) return;
    setPressed(true);
    const rect = e.currentTarget.getBoundingClientRect();
    // 画面全体の拡大縮小を打ち消して、ボタン内の素の座標にする
    const sx = rect.width / e.currentTarget.offsetWidth || 1;
    const sy = rect.height / e.currentTarget.offsetHeight || 1;
    const ink = { id: Date.now() + Math.random(), x: (e.clientX - rect.left) / sx, y: (e.clientY - rect.top) / sy };
    setInks((list) => [...list.slice(-2), ink]);
  };

  return (
    <button
      type="button"
      className={`rough-btn ${pressed ? 'is-pressed' : ''} ${disabled ? 'is-disabled' : ''} ${className ?? ''}`}
      style={style}
      aria-disabled={disabled}
      aria-label={ariaLabel}
      onPointerEnter={(e) => {
        if (e.pointerType !== 'mouse') return;
        setHover(true);
        if (!disabled) audio.play('se_hover');
      }}
      onPointerLeave={() => {
        setHover(false);
        setPressed(false);
      }}
      onPointerDown={handlePointerDown}
      onPointerUp={() => setPressed(false)}
      onPointerCancel={() => setPressed(false)}
      onClick={() => {
        // 押せない時は小さな「ブブッ」、押せる時はペン先の「カチッ」（SPEC §10-3）
        audio.play(disabled ? 'se_error' : 'se_click');
        if (disabled) onDisabledClick?.();
        else onClick?.();
      }}
    >
      <RoughBox
        seed={seed}
        className="rough-btn__box"
        stroke={disabled ? 'var(--pencil)' : stroke}
        strokeWidth={disabled ? 2 : strokeWidth}
        radius={radius}
        dashed={disabled}
        paper
        fill={active ? 'var(--marker-yellow)' : undefined}
        fillStyle="solid"
        boil={!disabled && hover}
        style={{ background: 'transparent' }}
      >
        <span className="rough-btn__label">
          <span className="tilt" style={tiltStyle(seed)}>
            {children}
          </span>
        </span>
      </RoughBox>
      {inks.map((ink) => (
        <span
          key={ink.id}
          className="rough-btn__ink"
          style={{ left: ink.x, top: ink.y }}
          onAnimationEnd={() => setInks((list) => list.filter((i) => i.id !== ink.id))}
        />
      ))}
    </button>
  );
}
