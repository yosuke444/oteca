import type { CardDef, OtegeCardDef } from '../../engine/types';
import { DiceDoodle } from '../common/Doodles';
import { Sticky } from '../common/Sticky';
import { useLongPress } from '../common/useLongPress';
import { RoughBox } from '../rough/RoughBox';
import { tiltFrom } from '../rough/seed';
import { effectLabel, faceLabel, sortedEffects } from './cardText';
import { FitLine } from './FitLine';
import { FitText, ItemArt, itemArtUrl } from './ItemArt';
import { local } from '../../i18n';
import { useLang, useT } from '../../i18n/useT';
import './card.css';

export type CardMiniProps = {
  def: CardDef;
  /** 線の形・傾きを固定する種 */
  seed: string;
  /** tile＝カード一覧用（技表あり）／slot＝デッキ枠用（名前とHPだけ） */
  variant: 'tile' | 'slot';
  /** 右下に出す枚数（×2 など。所持数が無制限の時の、デッキに入れた枚数） */
  count?: number;
  /** 所持数（右下に「×3」。v2.0-B） */
  owned?: number;
  /** このデッキに入れた分を引いた残り（「のこり 1」） */
  left?: number;
  /** 持っていない：えんぴつ色のシルエットと「？」（名前と効果は読める） */
  unowned?: boolean;
  /** えんぴつ色にする（入れられない等） */
  dim?: boolean;
  /** 初めて手に入れたカードの「NEW」の印（チュートリアルのデッキ編集。v2.1-P） */
  isNew?: boolean;
  onTap?: () => void;
  /** 長押し／右クリック → カード詳細 */
  onDetail?: () => void;
};

/** デッキ編集などで使う小さいカード（SPEC §6-6 を小さくしたもの） */
export function CardMini({ def, seed, variant, count, owned, left, unowned = false, dim = false, isNew = false, onTap, onDetail }: CardMiniProps) {
  const lang = useLang();
  const tr = useT();
  const art = itemArtUrl(def);
  const press = useLongPress(
    () => onTap?.(),
    () => onDetail?.(),
  );
  return (
    <button
      type="button"
      className={`card-mini card-mini--${variant} ${dim ? 'is-dim' : ''} ${unowned ? 'is-unowned' : ''}`}
      aria-label={unowned ? tr.deck.unownedAria(def.name) : undefined}
      {...press}
    >
      {def.kind === 'otege' ? <OtegeMini def={def} seed={seed} variant={variant} dim={dim} /> : art ? (
        // 絵のあるアイテム（v2.3）：1行目に名前と絵を並べ、効果の文は下の残りに収める（絵と文字を重ねない）
        <Sticky seed={seed} color={def.color ?? 'yellow'} angle={variant === 'tile' ? tiltFrom(seed, 2.5) : 0} className="card-mini__note has-art">
          <span className="card-mini__note-head">
            <span className="card-mini__name">{def.name}</span>
            <ItemArt url={art} className="card-mini__art" />
          </span>
          {variant === 'tile' && <FitText className="card-mini__text">{local(def.text, lang)}</FitText>}
        </Sticky>
      ) : (
        <Sticky seed={seed} color={def.color ?? 'yellow'} angle={variant === 'tile' ? tiltFrom(seed, 2.5) : 0} className="card-mini__note">
          <span className="card-mini__name">{def.name}</span>
          {variant === 'tile' && <span className="card-mini__text">{local(def.text, lang)}</span>}
        </Sticky>
      )}
      {unowned && <span className="card-mini__unknown" aria-hidden>{tr.deck.unknownMark}</span>}
      {isNew && <span className="card-mini__new">{tr.gacha.newTag}</span>}
      {owned !== undefined && !unowned && <span className="card-mini__count num">{tr.deck.owned(owned)}</span>}
      {left !== undefined && !unowned && <span className={`card-mini__left ${left === 0 ? 'is-zero' : ''}`}>{tr.deck.left(left)}</span>}
      {owned === undefined && count !== undefined && count > 0 && <span className="card-mini__count num">×{count}</span>}
    </button>
  );
}

function OtegeMini({ def, seed, variant, dim }: { def: OtegeCardDef; seed: string; variant: 'tile' | 'slot'; dim: boolean }) {
  const isSuper = def.rarity === 'super';
  /** 金の縁：スーパーとトロフィー（v2.0-J） */
  const gold = isSuper || def.trophy !== undefined;
  return (
    <RoughBox
      seed={seed}
      className={`card-mini__frame ${def.trophy !== undefined ? 'is-trophy' : ''}`}
      paper
      double={gold}
      stroke={dim ? 'var(--pencil)' : gold ? 'var(--super-gold)' : 'var(--ink)'}
      innerStroke={gold ? 'var(--ink)' : undefined}
      strokeWidth={2.2}
      radius={6}
      boil={gold && !dim}
    >
      {def.trophy !== undefined && (
        <span className="card-mini__trophy-no num" aria-hidden>
          {def.trophy}
        </span>
      )}
      <span className="card-tape" aria-hidden />
      {isSuper && <span className="card-stamp">S</span>}
      <div className="card-mini__head">
        <span
          className={`card-mini__name ${[...def.name].length >= 7 ? 'is-long' : ''} ${[...def.name].length >= 10 ? 'is-longer' : ''}`}
          // デッキ枠（幅100）では長い名前（7文字以上）を枠に収まる大きさまで小さくする
          style={variant === 'slot' && [...def.name].length >= 7 ? { fontSize: `${Math.floor(86 / [...def.name].length)}px` } : undefined}
        >
          {def.name}
        </span>
        <span className="card-hp">
          <small>HP</small>
          <span className="num">{def.hp}</span>
        </span>
      </div>
      {variant === 'tile' && (
        <ul className={`card-moves ${def.moves.length >= 4 ? 'is-many' : ''}`}>
          {def.moves.map((m, i) => (
            <li key={i} className="card-moves__row">
              <DiceDoodle seed={`${seed}-d${i}`} size={18} face={m.faces[0]} />
              <span className="card-moves__faces num">{faceLabel(m.faces)}</span>
              <FitLine className="card-moves__effects">
              {sortedEffects(m.effects).map((e, j) => {
                const l = effectLabel(e, true);
                return (
                  <span key={j} className={`card-moves__effect is-${l.tone}`}>
                    {l.text}
                  </span>
                );
              })}
              </FitLine>
            </li>
          ))}
        </ul>
      )}
    </RoughBox>
  );
}
