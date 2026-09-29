import type { CardDef, OtegeCardDef } from '../../engine/types';
import { DiceDoodle, StarDoodle } from '../common/Doodles';
import { Sticky } from '../common/Sticky';
import { RoughBox } from '../rough/RoughBox';
import { CardArt } from './CardArt';
import { effectLabel } from './cardText';
import './card.css';

/** 大きく表示したカード（長押し／右クリックのカード詳細。SPEC §6-6） */
export function CardDetail({ def, seed }: { def: CardDef; seed: string }) {
  if (def.kind === 'item') {
    return (
      <Sticky seed={seed} color={def.color ?? 'yellow'} className="card-detail card-detail--item">
        <span className="card-detail__name">{def.name}</span>
        <span className="card-detail__text">{def.text}</span>
        <span className="card-detail__kind">アイテム（つかいきり）</span>
      </Sticky>
    );
  }
  return <OtegeDetail def={def} seed={seed} />;
}

function OtegeDetail({ def, seed }: { def: OtegeCardDef; seed: string }) {
  const isSuper = def.rarity === 'super';
  return (
    <div className="card-detail-wrap">
      {isSuper && (
        <>
          <StarDoodle seed={`${seed}-star1`} size={34} className="card-detail__star card-detail__star--1" />
          <StarDoodle seed={`${seed}-star2`} size={24} className="card-detail__star card-detail__star--2" />
        </>
      )}
      <RoughBox
        seed={seed}
        className="card-detail"
        paper
        double={isSuper}
        stroke={isSuper ? 'var(--super-gold)' : 'var(--ink)'}
        innerStroke={isSuper ? 'var(--ink)' : undefined}
        strokeWidth={2.8}
        radius={8}
        boil={isSuper}
      >
        <span className="card-tape card-tape--big" aria-hidden />
        {isSuper && <span className="card-stamp card-stamp--big">S</span>}
        <div className="card-detail__head">
          <span className="card-detail__name">{def.name}</span>
          <span className="card-hp card-hp--big">
            <small>HP</small>
            <span className="num">{def.hp}</span>
          </span>
        </div>
        <CardArt def={def} seed={seed} />
        <ul className="card-moves card-moves--big">
          {def.moves.map((m, i) => (
            <li key={i} className="card-moves__row">
              <span className="card-moves__dice">
                {m.faces.map((f) => (
                  <DiceDoodle key={f} seed={`${seed}-m${i}-${f}`} size={24} face={f} />
                ))}
              </span>
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
        {def.flavor && <p className="card-detail__flavor">{def.flavor}</p>}
      </RoughBox>
    </div>
  );
}
