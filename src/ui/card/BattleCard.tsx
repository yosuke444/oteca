import type { HTMLAttributes } from 'react';
import { moveDamage } from '../../engine/effects';
import type { CardDef, CardInstance, GameState, OtegeCardDef } from '../../engine/types';
import { DiceDoodle, StarDoodle } from '../common/Doodles';
import { Sticky } from '../common/Sticky';
import { RoughBox } from '../rough/RoughBox';
import { RoughHpBar } from '../rough/RoughHpBar';
import { tiltFrom } from '../rough/seed';
import { CardArt } from './CardArt';
import { effectLabel, faceLabel } from './cardText';
import './card.css';

/** 大きさ（SPEC §6-6）：バトル場 150×210／ベンチ 120×168／手札 110×154 */
export const CARD_SIZE = {
  active: { w: 150, h: 210 },
  bench: { w: 120, h: 168 },
  hand: { w: 110, h: 154 },
} as const;

export type CardSize = keyof typeof CARD_SIZE;

export type BattleCardProps = {
  def: CardDef;
  card: CardInstance;
  size: CardSize;
  /** 表示中の状態（取り消し線の数値計算に使う） */
  view: GameState;
  /** 場に出ている（HPバーを出す） */
  onField?: boolean;
  /** 「このターン出る数値」を取り消し線方式で出す */
  preview?: boolean;
  /** いま出来る操作（黄色の蛍光ペン） */
  highlight?: boolean;
  /** 選択中（ラインボイル） */
  selected?: boolean;
  /** 使えない（えんぴつ色） */
  dim?: boolean;
  /** 技表の何行目に蛍光ペンを引くか（サイコロの演出） */
  markedMove?: number | null;
} & Omit<HTMLAttributes<HTMLDivElement>, 'children'>;

/** 対戦画面のカード */
export function BattleCard({
  def,
  card,
  size,
  view,
  onField = false,
  preview = false,
  highlight = false,
  selected = false,
  dim = false,
  markedMove = null,
  className,
  style,
  ...rest
}: BattleCardProps) {
  const { w, h } = CARD_SIZE[size];
  const classes = `battle-card battle-card--${size} ${highlight ? 'is-highlight' : ''} ${selected ? 'is-selected' : ''} ${dim ? 'is-dim' : ''} ${className ?? ''}`;

  if (def.kind === 'item') {
    return (
      <div className={classes} style={{ width: w, height: h, ...style }} data-uid={card.uid} {...rest}>
        <Sticky seed={`note-${card.uid}`} color={def.color ?? 'yellow'} angle={tiltFrom(card.uid, 3)} className="battle-card__note">
          <span className="battle-card__name">{def.name}</span>
          <span className="battle-card__text">{def.text}</span>
        </Sticky>
        {highlight && <span className="battle-card__marker" aria-hidden />}
      </div>
    );
  }
  return (
    <div className={classes} style={{ width: w, height: h, ...style }} data-uid={card.uid} {...rest}>
      <OtegeFace def={def} card={card} size={size} view={view} onField={onField} preview={preview} selected={selected} dim={dim} highlight={highlight} markedMove={markedMove} />
    </div>
  );
}

function OtegeFace({
  def,
  card,
  size,
  view,
  onField,
  preview,
  selected,
  dim,
  highlight,
  markedMove,
}: {
  def: OtegeCardDef;
  card: CardInstance;
  size: CardSize;
  view: GameState;
  onField: boolean;
  preview: boolean;
  selected: boolean;
  dim: boolean;
  highlight: boolean;
  markedMove: number | null;
}) {
  const isSuper = def.rarity === 'super';
  const { w } = CARD_SIZE[size];
  // 使えない時もスーパーの金の縁と星は残す（§6-6）。えんぴつ色は透明度で表す
  const stroke = isSuper ? 'var(--super-gold)' : dim ? 'var(--pencil)' : selected ? 'var(--pen-blue)' : 'var(--ink)';
  return (
    <>
      {isSuper && (
        <>
          <StarDoodle seed={`${card.uid}-s1`} size={size === 'active' ? 26 : 18} className="battle-card__star battle-card__star--1" />
          <StarDoodle seed={`${card.uid}-s2`} size={size === 'active' ? 18 : 13} className="battle-card__star battle-card__star--2" />
        </>
      )}
      <RoughBox
        seed={`card-${card.uid}-${size}`}
        className="battle-card__frame"
        paper
        double={isSuper}
        stroke={stroke}
        innerStroke={isSuper ? 'var(--ink)' : undefined}
        strokeWidth={selected ? 3.2 : 2.4}
        radius={6}
        fill={highlight ? 'var(--marker-yellow)' : undefined}
        fillStyle="solid"
        boil={isSuper || selected}
      >
        <span className="card-tape" aria-hidden />
        {isSuper && <span className="card-stamp">S</span>}
        <div className="battle-card__head">
          <span className={`battle-card__name ${[...def.name].length >= 7 ? 'is-long' : ''}`}>{def.name}</span>
        </div>
        <div className="battle-card__art">
          <CardArt def={def} seed={`${card.uid}-${size}`} />
          <span className="card-hp battle-card__hp">
            <small>HP</small>
            <span className="num">{onField ? card.hp : def.hp}</span>
          </span>
        </div>
        <ul className="card-moves battle-card__moves">
          {def.moves.map((m, i) => (
            <li key={i} className={`card-moves__row ${markedMove === i ? 'is-marked' : ''}`} data-move={i}>
              {size !== 'hand' && <DiceDoodle seed={`${card.uid}-d${i}`} size={size === 'active' ? 18 : 14} face={m.faces[0]} />}
              <span className="card-moves__faces num">{faceLabel(m.faces)}</span>
              {m.effects.map((e, j) => {
                const l = effectLabel(e);
                if (e.type === 'damage' && preview) {
                  const now = moveDamage(view, card, e.amount);
                  if (now !== e.amount) {
                    return (
                      <span key={j} className="card-moves__effect is-damage">
                        <s className="card-moves__old">{e.amount}</s> <b className="card-moves__new num">{now}</b>ダメ
                      </span>
                    );
                  }
                }
                return (
                  <span key={j} className={`card-moves__effect is-${l.tone}`}>
                    {l.text}
                  </span>
                );
              })}
            </li>
          ))}
        </ul>
        {onField && (
          <div className="battle-card__hpbar">
            <RoughHpBar seed={`hp-${card.uid}`} hp={card.hp} max={card.maxHp} width={w - 58} height={size === 'active' ? 14 : 12} />
            <span className="battle-card__hpnum num">
              {card.hp}/{card.maxHp}
            </span>
          </div>
        )}
      </RoughBox>
      {/* バフのバッジ（やいば・ドリンク） */}
      {onField && (card.attackAdd > 0 || card.attackOverride !== null) && (
        <div className="battle-card__badges">
          {card.attackOverride !== null && <span className="buff-badge buff-badge--drink">攻{card.attackOverride}</span>}
          {card.attackAdd > 0 && <span className="buff-badge buff-badge--yaiba">+{card.attackAdd}</span>}
        </div>
      )}
      {/* HPが少ない時の汗（§9-3） */}
      {onField && card.hp > 0 && card.hp / card.maxHp <= 0.25 && (
        <svg className="battle-card__sweat" viewBox="0 0 24 32" width="20" height="27" aria-hidden>
          <path d="M12 3 Q4 16 5 21 Q6 29 12 29 Q18 29 19 21 Q20 16 12 3 Z" />
          <path d="M9 20 Q9 24 12 25" className="battle-card__sweat-shine" />
        </svg>
      )}
    </>
  );
}
