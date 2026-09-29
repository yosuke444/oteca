import type { CSSProperties, ReactNode } from 'react';
import { RoughBox } from '../rough/RoughBox';
import { tiltStyle } from '../rough/seed';
import './dialog.css';

/**
 * ノートの切れ端のようなダイアログ。舞台（Stage）の上に重ねて出す。
 * ボタンは children か actions に RoughButton を並べる。
 */
export function Dialog({
  seed,
  title,
  children,
  actions,
  onClose,
  width = 620,
  style,
}: {
  seed: string;
  title?: ReactNode;
  children?: ReactNode;
  actions?: ReactNode;
  /** うしろをタップした時に閉じる（省略時は閉じない） */
  onClose?: () => void;
  width?: number;
  style?: CSSProperties;
}) {
  return (
    <div className="dialog-backdrop" onClick={onClose} role="presentation">
      <div className="dialog" style={{ width, ...style }} onClick={(e) => e.stopPropagation()} role="dialog">
        <RoughBox seed={seed} paper strokeWidth={2.8} radius={12} className="dialog__box">
          <div className="dialog__inner">
            {title && (
              <h2 className="dialog__title">
                <span className="tilt" style={tiltStyle(`${seed}-title`)}>
                  {title}
                </span>
              </h2>
            )}
            <div className="dialog__body">{children}</div>
            {actions && <div className="dialog__actions">{actions}</div>}
          </div>
        </RoughBox>
      </div>
    </div>
  );
}
