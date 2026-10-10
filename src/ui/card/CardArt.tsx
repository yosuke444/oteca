import { useState } from 'react';
import type { CardDef } from '../../engine/types';
import { RoughBox } from '../rough/RoughBox';
import './card.css';

/**
 * カードのイラスト。public/cards/<id>.png が無い時は、
 * ペン描きの「?」と名前を描いた仮イラストを出す（SPEC §5-3）。
 * トロフィーのカード（v2.0-J）は、いつも金色のトロフィーの手描き（v2.3：絵が置いてあっても読み込まない。仮の絵のまま）。番号を大きく重ねる
 */
export function CardArt({ def, seed }: { def: CardDef; seed: string }) {
  const [failed, setFailed] = useState(false);
  const src = `${import.meta.env.BASE_URL}${def.image}`;
  const trophy = def.kind === 'otege' ? def.trophy : undefined;
  return (
    <RoughBox seed={`${seed}-art`} className={`card-art ${trophy ? 'card-art--trophy' : ''}`} strokeWidth={1.6} radius={4}>
      {failed || !def.image || trophy ? (
        trophy ? (
          <div className="card-art__placeholder card-art__placeholder--trophy">
            <TrophyDoodle />
          </div>
        ) : (
          <div className="card-art__placeholder">
            <span className="card-art__q">?</span>
            <span className="card-art__name">{def.name}</span>
          </div>
        )
      ) : (
        <img className="card-art__img" src={src} alt={def.name} draggable={false} onError={() => setFailed(true)} />
      )}
      {trophy && (
        <span className="card-art__trophy-no num" data-testid="trophy-no">
          {trophy}
        </span>
      )}
    </RoughBox>
  );
}

/** 金色のトロフィーの手描き（仮の絵） */
export function TrophyDoodle({ className }: { className?: string }) {
  return (
    <svg className={`trophy-doodle ${className ?? ''}`} viewBox="0 0 64 64" aria-hidden>
      <path className="trophy-doodle__cup" d="M18 9 C26 8.4 38 8.6 46 9.2 C46.5 22 43 33 32.4 36.6 C21.5 33.5 17.6 22.4 18 9 Z" />
      <path className="trophy-doodle__handle" d="M18.5 13 C10 12.4 8.8 23 19.6 25.4 M45.6 13 C54 12.6 55.4 23.2 44.4 25.6" />
      <path className="trophy-doodle__stem" d="M29.5 36.4 C29.8 41 29.4 45 28.6 47.6 L35.8 47.8 C34.8 45 34.6 41 34.8 36.2" />
      <path className="trophy-doodle__base" d="M21 48 C28 47.4 37 47.4 43.4 48.2 L44 55.6 C36 56.2 28 56 20.4 55.4 Z" />
      <path className="trophy-doodle__shine" d="M24.5 13.5 C24.4 19 25.6 24 28.4 27.6" />
    </svg>
  );
}
