import type { CardDef, OtegeCardDef } from '../../engine/types';
import { DiceDoodle } from '../common/Doodles';
import { Sticky } from '../common/Sticky';
import { useLongPress } from '../common/useLongPress';
import { RoughBox } from '../rough/RoughBox';
import { tiltFrom } from '../rough/seed';
import { effectLabel, faceLabel } from './cardText';
import './card.css';

export type CardMiniProps = {
  def: CardDef;
  /** 線の形・傾きを固定する種 */
  seed: string;
  /** tile＝カード一覧用（技表あり）／slot＝デッキ枠用（名前とHPだけ） */
  variant: 'tile' | 'slot';
  /** 右上に出す枚数（×2 など） */
  count?: number;
  /** えんぴつ色にする（入れられない等） */
  dim?: boolean;
  onTap?: () => void;
  /** 長押し／右クリック → カード詳細 */
  onDetail?: () => void;
};

/** デッキ編集などで使う小さいカード（SPEC §6-6 を小さくしたもの） */
export function CardMini({ def, seed, variant, count, dim = false, onTap, onDetail }: CardMiniProps) {
  const press = useLongPress(
    () => onTap?.(),
    () => onDetail?.(),
  );
  return (
    <button type="button" className={`card-mini card-mini--${variant} ${dim ? 'is-dim' : ''}`} {...press}>
      {def.kind === 'otege' ? <OtegeMini def={def} seed={seed} variant={variant} dim={dim} /> : (
        <Sticky seed={seed} color={def.color ?? 'yellow'} angle={variant === 'tile' ? tiltFrom(seed, 2.5) : 0} className="card-mini__note">
          <span className="card-mini__name">{def.name}</span>
          {variant === 'tile' && <span className="card-mini__text">{def.text}</span>}
        </Sticky>
      )}
      {count !== undefined && count > 0 && <span className="card-mini__count num">×{count}</span>}
    </button>
  );
}

function OtegeMini({ def, seed, variant, dim }: { def: OtegeCardDef; seed: string; variant: 'tile' | 'slot'; dim: boolean }) {
  const isSuper = def.rarity === 'super';
  return (
    <RoughBox
      seed={seed}
      className="card-mini__frame"
      paper
      double={isSuper}
      stroke={dim ? 'var(--pencil)' : isSuper ? 'var(--super-gold)' : 'var(--ink)'}
      innerStroke={isSuper ? 'var(--ink)' : undefined}
      strokeWidth={2.2}
      radius={6}
      boil={isSuper && !dim}
    >
      <span className="card-tape" aria-hidden />
      {isSuper && <span className="card-stamp">S</span>}
      <div className="card-mini__head">
        <span className={`card-mini__name ${[...def.name].length >= 7 ? 'is-long' : ''}`}>{def.name}</span>
        <span className="card-hp">
          <small>HP</small>
          <span className="num">{def.hp}</span>
        </span>
      </div>
      {variant === 'tile' && (
        <ul className="card-moves">
          {def.moves.map((m, i) => (
            <li key={i} className="card-moves__row">
              <DiceDoodle seed={`${seed}-d${i}`} size={18} face={m.faces[0]} />
              <span className="card-moves__faces num">{faceLabel(m.faces)}</span>
              {m.effects.map((e, j) => {
                const l = effectLabel(e);
                return (
                  <span key={j} className={`card-moves__effect is-${l.tone}`}>
                    {l.text}
                  </span>
                );
              })}
            </li>
          ))}
        </ul>
      )}
    </RoughBox>
  );
}
