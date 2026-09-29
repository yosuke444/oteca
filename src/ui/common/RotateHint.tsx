import './common.css';

/** スマホ縦向きの時だけ重ねて出す「よこむきにしてね」（SPEC §6-2） */
export function RotateHint() {
  return (
    <div className="rotate-hint" role="alert">
      <svg className="rotate-hint__svg" viewBox="0 0 200 160" aria-hidden>
        <g className="rotate-hint__phone">
          <rect x="70" y="20" width="60" height="110" rx="10" />
          <line x1="92" y1="120" x2="108" y2="120" />
        </g>
        <path className="rotate-hint__arrow" d="M150 40 Q185 75 160 120" />
        <path className="rotate-hint__arrow" d="M150 112 L160 121 L168 108" />
      </svg>
      <p className="rotate-hint__text">よこむきに してね</p>
    </div>
  );
}
