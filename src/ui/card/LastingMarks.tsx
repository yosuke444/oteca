import type { GameState, Lasting, Side } from '../../engine/types';
import { useT } from '../../i18n/useT';
import './lasting.css';

/**
 * 持続効果の印（SPEC §8-5・UPDATE_v2 §4-2 ⑥）。カードの上に手描きの小さな印で見せる。
 * - どく（持続ダメージ）：紫のしずく「10 ×3」（次に10、あと3回）
 * - あとから回復：緑の「+10 つぎ」（2回以上後なら「+30 あと2」）
 * - あとから自分へのダメージ：赤の「-50 つぎ」
 * - ばくだん：黒いばくだんの落書きと残り回数（導火線が短くなる）
 * 発動する時は、印が光る（is-fire。演出の LastingFired で付ける）
 */
export function LastingMarks({ view, uid }: { view: GameState; uid: string }) {
  const tr = useT();
  const L = tr.battle.lasting;
  const mine = view.lasting.filter((l) => l.targetUid === uid);
  if (mine.length === 0) return null;
  const of = (kind: Lasting['kind']) => mine.filter((l) => l.kind === kind).sort((a, b) => a.skip - b.skip);
  const poison = of('damage');
  const heal = of('heal');
  const self = of('selfDamage');
  const bomb = of('faint');
  const when = (l: Lasting, next: (n: number) => string, later: (n: number, after: number) => string) =>
    l.skip === 0 ? next(l.amount) : later(l.amount, l.skip + 1);
  return (
    <div className="lasting-marks" data-lasting={uid}>
      {poison.length > 0 && (
        <span className="lasting-mark lasting-mark--poison" data-kind="damage" aria-label={L.poisonAria(poison[0].amount, poison.length)}>
          <Drop />
          <span className="num">{L.poison(poison[0].amount, poison.length)}</span>
        </span>
      )}
      {heal.length > 0 && (
        <span className="lasting-mark lasting-mark--heal" data-kind="heal">
          <span className="num">{when(heal[0], L.healNext, L.healLater)}</span>
        </span>
      )}
      {self.length > 0 && (
        <span className="lasting-mark lasting-mark--self" data-kind="selfDamage">
          <span className="num">{when(self[0], L.selfNext, L.selfLater)}</span>
        </span>
      )}
      {bomb.length > 0 && (
        <span className="lasting-mark lasting-mark--bomb" data-kind="faint" aria-label={L.bombAria(bomb[0].skip + 1)}>
          <Bomb left={bomb[0].skip + 1} />
          <span className="num lasting-mark__count">{bomb[0].skip + 1}</span>
        </span>
      )}
    </div>
  );
}

/** あとからドロー（プレイヤーに付く）：山札の横に「+4まい あと9」 */
export function DrawMarks({ view, side }: { view: GameState; side: Side }) {
  const tr = useT();
  const draws = view.lasting.filter((l) => l.kind === 'draw' && l.targetUid === null && l.owner === side).sort((a, b) => a.skip - b.skip);
  if (draws.length === 0) return null;
  return (
    <div className="lasting-draws" data-lasting={`${side}-draw`}>
      {draws.slice(0, 2).map((l, i) => (
        <span key={i} className="lasting-mark lasting-mark--draw" data-kind="draw">
          <span className="num">{tr.battle.lasting.draw(l.amount, l.skip + 1)}</span>
        </span>
      ))}
    </div>
  );
}

function Drop() {
  return (
    <svg className="lasting-mark__icon" viewBox="0 0 20 26" width="16" height="21" aria-hidden>
      <path d="M10 2 Q3 13 4 17 Q5 24 10 24 Q15 24 16 17 Q17 13 10 2 Z" fill="var(--pen-purple)" stroke="var(--ink)" strokeWidth="1.4" />
    </svg>
  );
}

/** ばくだん：残り回数が減るほど導火線が短い（3 → 2 → 1） */
function Bomb({ left }: { left: number }) {
  const fuse = Math.max(1, Math.min(3, left));
  const end = { 3: 'M17 7 Q21 1 26 3', 2: 'M17 7 Q20 3 23 3', 1: 'M17 7 Q18 5 20 4' }[fuse as 1 | 2 | 3];
  const tip = { 3: [26, 3], 2: [23, 3], 1: [20, 4] }[fuse as 1 | 2 | 3];
  return (
    <svg className="lasting-mark__icon lasting-mark__icon--bomb" viewBox="0 0 30 30" width="30" height="30" aria-hidden>
      <circle cx="12" cy="17" r="9" fill="var(--ink)" />
      <circle cx="9" cy="14" r="2.2" fill="var(--paper)" opacity="0.6" />
      <path d={end} fill="none" stroke="var(--ink)" strokeWidth="1.8" strokeLinecap="round" />
      <circle className="lasting-mark__spark" cx={tip[0]} cy={tip[1]} r="2.4" fill="var(--pen-red)" />
    </svg>
  );
}
