import { useState } from 'react';
import type { GameState, Lasting, Side } from '../../engine/types';
import { useT } from '../../i18n/useT';
import { benchBombs, drawTags, lastingRows, rowFit } from './lastingLayout';
import './lasting.css';

/**
 * 持続効果の見た目（SPEC §8-5・UPDATE_v2 §4-2 ⑥。v2.5 で作り直し）
 * - バトル場のおてあげの横に、ターンごとの行で札を並べる表（LastingTable）
 *   1行目＝次に来る持ち主のターンの終わりに発動するもの、2行目＝その次、3行目＝さらにその次（3ターン先まで）。
 *   同じ行の中は、古く受けたものが左、新しいものが右（発動は右から）。
 *   持続ダメージは赤い丸、持続回復は緑の四角、ばくだんは黒いばくだんの札。
 * - ベンチのおてあげは、ばくだんの札だけを小さく（BenchBomb）
 * - 遅延ドローは、山札の上に青い札「+4まい / あと 9」（DrawTags）。古いものが左
 * 並べ方は lastingLayout.ts。演出は札の data-seq（受けた順番）で探す（fx/presets/lasting.ts）。
 */

const isRed = (l: Lasting) => l.kind === 'damage' || l.kind === 'selfDamage';
/** 手描きの傾き（受けた順番で決める。毎回同じ） */
const tilt = (seq: number) => ((seq * 37) % 9) - 4;

/** popup：「+N」で開いた窓の中の写し（演出は data-seq で札を探すので、写しには付けない） */
function Tag({ l, size, small, popup }: { l: Lasting; size: number; small?: boolean; popup?: boolean }) {
  const tr = useT();
  const L = tr.battle.lasting;
  const kind = l.kind === 'faint' ? 'bomb' : isRed(l) ? 'damage' : 'heal';
  const label = l.kind === 'faint' ? L.bombAria(l.turns) : isRed(l) ? L.damageAria(l.amount, l.turns) : L.healAria(l.amount, l.turns);
  const font = Math.round(size * (String(l.amount).length >= 3 ? 0.42 : 0.55));
  return (
    <span
      className={`lasting-tag lasting-tag--${kind} ${small ? 'lasting-tag--small' : ''}`}
      data-seq={popup ? undefined : l.seq}
      data-popup-seq={popup ? l.seq : undefined}
      data-kind={l.kind}
      aria-label={label}
      style={{ width: size, height: size, fontSize: font, rotate: `${tilt(l.seq)}deg` }}
    >
      {l.kind === 'faint' ? <BombIcon size={Math.round(size * 0.8)} /> : <span className="num">{l.amount}</span>}
    </span>
  );
}

/** バトル場のおてあげの横の表（持続効果が1つも無ければ出さない） */
export function LastingTable({ view, side, mine }: { view: GameState; side: Side; mine: boolean }) {
  const tr = useT();
  const [open, setOpen] = useState(false);
  const uid = view.players[side].active;
  const rows = lastingRows(view, uid);
  if (rows.every((r) => r.length === 0)) return null;
  // ベンチのカードなどにかぶっても、札はいつも はっきり、上に出す（v2.7。半透明にはしない）
  return (
    <div className={`lasting-table lasting-table--${mine ? 'me' : 'opp'}`} data-lasting-table={side} data-lasting-uid={uid ?? ''}>
      {rows.map((row, i) => {
        if (row.length === 0) return <div key={i} className="lasting-row lasting-row--empty" data-row={i + 1} />;
        const fit = rowFit(row.length);
        const hidden = row.length - fit.shown;
        return (
          <div key={i} className={`lasting-row ${i === 0 ? 'lasting-row--next' : ''}`} data-row={i + 1}>
            {row.slice(0, fit.shown).map((l) => (
              <Tag key={l.seq} l={l} size={fit.size} />
            ))}
            {hidden > 0 && (
              <button type="button" className="lasting-more num" data-more-row={i + 1} aria-label={tr.battle.lasting.moreAria(hidden)} onClick={() => setOpen(true)}>
                {tr.battle.lasting.more(hidden)}
              </button>
            )}
          </div>
        );
      })}
      {open && (
        <div className="lasting-all" role="dialog" aria-label={tr.battle.lasting.allTitle} onClick={() => setOpen(false)}>
          <p className="lasting-all__title">{tr.battle.lasting.allTitle}</p>
          {rows.map((row, i) =>
            row.length === 0 ? null : (
              <div key={i} className="lasting-all__row">
                <span className="lasting-all__when pencil">{tr.battle.lasting.rowLabel(i + 1)}</span>
                {row.map((l) => (
                  <Tag key={l.seq} l={l} size={40} popup />
                ))}
              </div>
            ),
          )}
          <p className="lasting-all__close pencil">{tr.battle.lasting.close}</p>
        </div>
      )}
    </div>
  );
}

/** ベンチのおてあげ：ばくだんの札だけを小さく（あと何ターンかの数字つき） */
export function BenchBomb({ view, uid }: { view: GameState; uid: string }) {
  const bombs = benchBombs(view, uid);
  if (bombs.length === 0) return null;
  return (
    <div className="lasting-bench" data-lasting-bench={uid}>
      {bombs.map((l) => (
        <span key={l.seq} className="lasting-bench__bomb">
          <Tag l={l} size={34} small />
          <span className="lasting-bench__left num">{l.turns}</span>
        </span>
      ))}
    </div>
  );
}

/** 遅延ドロー（プレイヤーに付く）：山札の上に青い札「+4まい / あと 9」。古いものが左 */
export function DrawTags({ view, side }: { view: GameState; side: Side }) {
  const tr = useT();
  const L = tr.battle.lasting;
  const draws = drawTags(view, side);
  if (draws.length === 0) return null;
  return (
    <div className={`lasting-draws ${draws.length >= 2 ? 'lasting-draws--many' : ''}`} data-lasting-draws={side}>
      {draws.map((l) => (
        <span key={l.seq} className="lasting-draw" data-seq={l.seq} data-kind="draw" aria-label={L.drawAria(l.amount, l.turns)} style={{ rotate: `${tilt(l.seq)}deg` }}>
          <b className="lasting-draw__count num">{L.drawCount(l.amount)}</b>
          <span className="lasting-draw__left">
            {L.drawLeft}
            <span className="num" data-left>
              {Math.max(0, l.turns)}
            </span>
          </span>
        </span>
      ))}
    </div>
  );
}

/** 黒いばくだん（導火線の先に赤い火花） */
export function BombIcon({ size = 30 }: { size?: number }) {
  return (
    <svg className="lasting-bomb" viewBox="0 0 30 30" width={size} height={size} aria-hidden>
      <circle cx="13" cy="18" r="9.5" fill="var(--ink)" />
      <circle cx="9.5" cy="14.5" r="2.4" fill="var(--paper)" opacity="0.6" />
      <path d="M18 9 Q21 3 26 4" fill="none" stroke="var(--ink)" strokeWidth="1.9" strokeLinecap="round" />
      <circle className="lasting-bomb__spark" cx="26" cy="4" r="2.6" fill="var(--pen-red)" />
    </svg>
  );
}
