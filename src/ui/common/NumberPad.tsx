import { RoughButton } from '../rough/RoughButton';

/**
 * 大きな手描きテンキー（SPEC §7 S03。スマホでも押しやすいように大きく）
 * 1 2 3 / 4 5 6 / 7 8 9 / けす 0 ぜんぶ
 */
export function NumberPad({
  value,
  maxLength,
  onChange,
  className,
}: {
  value: string;
  maxLength: number;
  onChange: (v: string) => void;
  className?: string;
}) {
  const push = (d: string) => {
    if (value.length < maxLength) onChange(value + d);
  };
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];
  return (
    <div className={`numpad ${className ?? ''}`}>
      {keys.map((k) => (
        <RoughButton key={k} seed={`numpad-${k}`} className="numpad__key" disabled={value.length >= maxLength} onClick={() => push(k)} ariaLabel={k}>
          <span className="num">{k}</span>
        </RoughButton>
      ))}
      <RoughButton seed="numpad-back" className="numpad__key numpad__key--word" disabled={value.length === 0} onClick={() => onChange(value.slice(0, -1))}>
        けす
      </RoughButton>
      <RoughButton seed="numpad-0" className="numpad__key" disabled={value.length >= maxLength} onClick={() => push('0')} ariaLabel="0">
        <span className="num">0</span>
      </RoughButton>
      <RoughButton seed="numpad-clear" className="numpad__key numpad__key--word" disabled={value.length === 0} onClick={() => onChange('')}>
        ぜんぶ
      </RoughButton>
    </div>
  );
}
