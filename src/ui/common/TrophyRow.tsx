import { useT } from '../../i18n/useT';
import { TrophyDoodle } from '../card/CardArt';
import { trophyDisplay } from './trophyBadge';
import './common.css';

/** トロフィあげの数（絵を5個まで並べ、6個目からは「+1」…。0個なら何も出さない。v2.2） */
export function TrophyRow({ count, className = '' }: { count: number; className?: string }) {
  const tr = useT();
  const { icons, more } = trophyDisplay(count);
  if (icons === 0) return null;
  return (
    <span className={`trophy-row ${className}`} aria-label={tr.battle.trophyCount(count)} data-testid="trophy-row" data-count={count}>
      {Array.from({ length: icons }, (_, i) => (
        <TrophyDoodle key={i} className="trophy-row__icon" />
      ))}
      {more > 0 && <span className="trophy-row__more num">{tr.battle.trophyMore(more)}</span>}
    </span>
  );
}
