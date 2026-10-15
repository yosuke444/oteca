import type { CardDef, OtegeCardDef } from '../../engine/types';
import { DiceDoodle, StarDoodle } from '../common/Doodles';
import { Sticky } from '../common/Sticky';
import { RoughBox } from '../rough/RoughBox';
import { CardArt } from './CardArt';
import { ItemArt, itemArtUrl } from './ItemArt';
import { effectLabel, sortedEffects } from './cardText';
import { local } from '../../i18n';
import { useLang, useT } from '../../i18n/useT';
import './card.css';

/** 大きく表示したカード（長押し／右クリックのカード詳細。SPEC §6-6） */
export function CardDetail({ def, seed }: { def: CardDef; seed: string }) {
  const tr = useT();
  const lang = useLang();
  if (def.kind === 'item') {
    const art = itemArtUrl(def);
    return (
      <Sticky seed={seed} color={def.color ?? 'yellow'} className={`card-detail card-detail--item ${art ? 'has-art' : ''}`}>
        <span className="card-detail__name">{def.name}</span>
        {art && <ItemArt url={art} className="card-detail__item-art" />}
        <span className="card-detail__text">{local(def.text, lang)}</span>
        <span className="card-detail__kind">{tr.card.itemKind}</span>
      </Sticky>
    );
  }
  return <OtegeDetail def={def} seed={seed} />;
}

function OtegeDetail({ def, seed }: { def: OtegeCardDef; seed: string }) {
  const isSuper = def.rarity === 'super';
  /** 金の縁：スーパーとトロフィー（v2.0-J） */
  const gold = isSuper || def.trophy !== undefined;
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
        double={gold}
        stroke={gold ? 'var(--super-gold)' : 'var(--ink)'}
        innerStroke={gold ? 'var(--ink)' : undefined}
        strokeWidth={2.8}
        radius={8}
        boil={gold}
      >
        <span className="card-tape card-tape--big" aria-hidden />
        {isSuper && <span className="card-stamp card-stamp--big">S</span>}
        <div className="card-detail__head">
          {/* トロフィあげ（番号）は長いので小さめ（v2.7。1行に収める） */}
          <span className={`card-detail__name ${def.trophy !== undefined ? 'card-detail__name--long' : ''}`}>{def.name}</span>
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
              <span className="card-moves__effects card-moves__effects--wrap">
                {sortedEffects(m.effects).map((e, j) => {
                  const l = effectLabel(e);
                  return (
                    <span key={j} className={`card-moves__effect is-${l.tone}`}>
                      {l.text}
                    </span>
                  );
                })}
              </span>
            </li>
          ))}
        </ul>
        <LastingNotes def={def} />
        {def.trophy !== undefined && <TrophyNote />}
        {def.flavor && <p className="card-detail__flavor">{def.flavor}</p>}
      </RoughBox>
    </div>
  );
}

/** トロフィあげ の説明（v2.7：大会の賞品の限定カード） */
function TrophyNote() {
  const tr = useT();
  return (
    <p className="card-detail__note" data-testid="card-trophy-note">
      {tr.card.trophyNote}
    </p>
  );
}

/** あとから くる こうかの ちゅうい（技に「+」・ばくだん・あとから ひく カードが ある おてあげだけ。v2.5） */
function LastingNotes({ def }: { def: OtegeCardDef }) {
  const tr = useT();
  const effects = def.moves.flatMap((m) => m.effects);
  const later = effects.some((e) => (e.type === 'damage' || e.type === 'heal' || e.type === 'selfDamage') && (e.then ?? []).some((n) => n > 0));
  const bomb = effects.some((e) => e.type === 'faintLater');
  const draw = effects.some((e) => e.type === 'draw' && (e.then ?? []).some((n) => n > 0));
  const notes = [later && tr.card.lastingNote, bomb && tr.card.bombNote, draw && tr.card.drawLaterNote].filter((x): x is string => !!x);
  if (notes.length === 0) return null;
  return (
    <p className="card-detail__note" data-testid="card-lasting-note">
      {notes.join(' ')}
    </p>
  );
}
