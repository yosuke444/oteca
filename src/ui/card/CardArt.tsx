import { useState } from 'react';
import type { CardDef } from '../../engine/types';
import { RoughBox } from '../rough/RoughBox';
import './card.css';

/**
 * カードのイラスト。public/cards/<id>.png が無い時は、
 * ペン描きの「?」と名前を描いた仮イラストを出す（SPEC §5-3）。
 */
export function CardArt({ def, seed }: { def: CardDef; seed: string }) {
  const [failed, setFailed] = useState(false);
  const src = `${import.meta.env.BASE_URL}${def.image}`;
  return (
    <RoughBox seed={`${seed}-art`} className="card-art" strokeWidth={1.6} radius={4}>
      {failed || !def.image ? (
        <div className="card-art__placeholder">
          <span className="card-art__q">?</span>
          <span className="card-art__name">{def.name}</span>
        </div>
      ) : (
        <img className="card-art__img" src={src} alt={def.name} draggable={false} onError={() => setFailed(true)} />
      )}
    </RoughBox>
  );
}
