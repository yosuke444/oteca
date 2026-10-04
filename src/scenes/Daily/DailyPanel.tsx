import { gsap } from 'gsap';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { audio } from '../../audio/audioManager';
import { DAILY, allClearDone, cycleKeyAt, dailyPack, isDone, missionDef, nextResetAt } from '../../daily/daily';
import { formatCountdown } from '../../economy/rewards';
import { useFx } from '../../fx/fxSettings';
import { useT } from '../../i18n/useT';
import type { DailyMissionId, DailyState } from '../../save/saveData';
import { RoughBox } from '../../ui/rough/RoughBox';
import { RoughButton } from '../../ui/rough/RoughButton';
import { tiltStyle } from '../../ui/rough/seed';
import { PackArt } from '../Gacha/PackArt';
import { ModeGuide } from '../../ui/guide/ModeGuide';
import './daily.css';

/**
 * S17 デイリーミッション（SPEC §7 S17・UPDATE_v2_1 §3）のパネル。メニューの上に重ねる（ノートの紙）。
 * 上に「つぎの こうしんまで 時:分:秒」。その日の3つ＋確定の1つ。達成したら「うけとる」。
 * 受け取り（保存・コインの演出）は呼ぶ側（メニュー）が行う。
 */
export function DailyPanel({
  daily,
  onClaim,
  onClaimAllClear,
  onRoll,
  onClose,
}: {
  daily: DailyState;
  /** ミッションの報酬を受け取る（from はコインが飛び出す場所） */
  onClaim: (id: DailyMissionId, from: HTMLElement) => void;
  /** 確定のミッションの報酬を受け取る（デイリーパックの開封へ） */
  onClaimAllClear: () => void;
  /** 開いている間に12時を過ぎた（入れ替える） */
  onRoll: () => void;
  onClose: () => void;
}) {
  const tr = useT();
  const fx = useFx();
  const D = tr.daily;
  const [now, setNow] = useState(() => Date.now());
  const boxRef = useRef<HTMLDivElement>(null);

  // 1秒ごとに数え直す。12時を過ぎたら入れ替える
  useEffect(() => {
    let id = 0;
    const tick = () => {
      const t = Date.now();
      setNow(t);
      id = window.setTimeout(tick, 1000 - (t % 1000) + 5);
    };
    id = window.setTimeout(tick, 1000 - (Date.now() % 1000) + 5);
    return () => window.clearTimeout(id);
  }, []);
  useEffect(() => {
    if (daily.cycleKey !== cycleKeyAt(now)) onRoll();
  }, [now]);

  // ノートの紙が、ふわっと落ちてくる
  useLayoutEffect(() => {
    if (!boxRef.current) return;
    const t = gsap.fromTo(boxRef.current, { y: -60, rotate: -3, opacity: 0 }, { y: 0, rotate: 0, opacity: 1, duration: fx.reduceFx ? 0.15 : 0.35, ease: 'back.out(1.6)' });
    audio.play('se_page');
    return () => void t.kill();
  }, []);

  const allDone = allClearDone(daily);
  return (
    <div className="daily-panel" onClick={onClose} role="presentation" data-testid="daily-panel">
      <div className="daily-panel__paper" ref={boxRef} onClick={(e) => e.stopPropagation()} role="dialog" aria-label={D.title}>
        <RoughBox seed="daily-panel" paper strokeWidth={2.8} radius={12} className="daily-panel__box">
          <div className="daily-panel__inner">
            <h2 className="daily-panel__title">
              <span className="tilt" style={tiltStyle('daily-title')}>
                {D.title}
              </span>
            </h2>
            <ModeGuide mode="daily" className="daily-panel__guide" />
            <p className="daily-panel__next">
              <span className="pencil">{D.next}</span> <span className="num daily-panel__time">{formatCountdown(nextResetAt(now) - now)}</span>
            </p>
            <ul className="daily-panel__list">
              {daily.missions.map((m) => {
                const def = missionDef(m.id);
                const done = isDone(m);
                return (
                  <li key={m.id} className={`daily-row ${done ? 'is-done' : ''} ${m.claimed ? 'is-claimed' : ''}`} data-testid={`daily-${m.id}`}>
                    <CheckMark done={done} />
                    <span className="daily-row__text">{D.mission[m.id](def.target)}</span>
                    <span className="daily-row__bar" aria-label={D.progress(m.progress, def.target)}>
                      <span className="daily-row__fill" style={{ width: `${(Math.min(m.progress, def.target) / def.target) * 100}%` }} />
                      <span className="daily-row__count num">{D.progress(Math.min(m.progress, def.target), def.target)}</span>
                    </span>
                    <span className="daily-row__reward num">{D.coins(def.coins)}</span>
                    <ClaimButton
                      seed={`daily-claim-${m.id}`}
                      state={m.claimed ? 'claimed' : done ? 'ready' : 'notYet'}
                      onClaim={(el) => onClaim(m.id, el)}
                      testId={`daily-claim-${m.id}`}
                    />
                  </li>
                );
              })}
              <li className={`daily-row daily-row--all ${allDone ? 'is-done' : ''} ${daily.allClearClaimed ? 'is-claimed' : ''}`} data-testid="daily-allClear">
                <CheckMark done={allDone} />
                <span className="daily-row__text">
                  {D.allClear}
                </span>
                <span className="daily-row__pack" aria-hidden>
                  <PackArt pack={dailyPack()} small />
                </span>
                <span className="daily-row__reward daily-row__reward--all num">{D.allClearReward(DAILY.allClear.bags, DAILY.allClear.coins)}</span>
                <ClaimButton
                  seed="daily-claim-all"
                  state={daily.allClearClaimed ? 'claimed' : allDone ? 'ready' : 'notYet'}
                  onClaim={() => onClaimAllClear()}
                  testId="daily-claim-allClear"
                />
              </li>
            </ul>
            <div className="daily-panel__actions">
              <RoughButton seed="daily-close" className="daily-panel__close" onClick={onClose} data-testid="daily-close">
                {tr.common.close}
              </RoughButton>
            </div>
          </div>
        </RoughBox>
      </div>
    </div>
  );
}

/** 「うけとる」（達成した時だけ押せる。蛍光ペンで塗って揺れる）／「うけとった」（はんこ）／「まだ」 */
function ClaimButton({ seed, state, onClaim, testId }: { seed: string; state: 'ready' | 'claimed' | 'notYet'; onClaim: (el: HTMLElement) => void; testId: string }) {
  const tr = useT();
  const ref = useRef<HTMLSpanElement>(null);
  if (state === 'claimed') {
    return (
      <span className="daily-row__stamp" data-testid={`${testId}-done`}>
        {tr.daily.claimed}
      </span>
    );
  }
  return (
    <span className={`daily-row__claim ${state === 'ready' ? 'is-ready' : ''}`} ref={ref}>
      <RoughButton seed={seed} highlight={state === 'ready'} disabled={state !== 'ready'} onClick={() => ref.current && onClaim(ref.current)} data-testid={testId}>
        {state === 'ready' ? tr.daily.claim : tr.daily.notYet}
      </RoughButton>
    </span>
  );
}

/** 手描きのチェック（達成したら赤ペンのチェック） */
function CheckMark({ done }: { done: boolean }) {
  return (
    <svg className="daily-row__check" viewBox="0 0 40 40" width="40" height="40" aria-hidden>
      <path d="M6 7 L34 6 L35 34 L7 35 Z" fill="var(--paper)" stroke="var(--ink)" strokeWidth="2.4" strokeLinejoin="round" />
      {done && <path d="M10 20 L18 29 L36 4" fill="none" stroke="var(--pen-red)" strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round" />}
    </svg>
  );
}

/** メニューのアイコン：手描きのチェックリスト（public/images/daily.png があればそれを使う） */
export function DailyIcon({ img }: { img: string | null }) {
  if (img) return <img src={img} alt="" className="daily-icon__img" draggable={false} />;
  return (
    <svg viewBox="0 0 48 48" width="40" height="40" aria-hidden className="daily-icon__svg">
      <path d="M9 5 L39 4 L40 44 L8 44 Z" fill="var(--paper)" stroke="var(--ink)" strokeWidth="2.6" strokeLinejoin="round" />
      <path d="M18 2 L30 2 L30 8 L18 8 Z" fill="var(--note-yellow)" stroke="var(--ink)" strokeWidth="2" />
      {[14, 24, 34].map((y, i) => (
        <g key={y}>
          <path d={`M13 ${y} L17 ${y + 4} L22 ${y - 4}`} fill="none" stroke={i < 2 ? 'var(--pen-red)' : 'var(--pencil)'} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
          <path d={`M25 ${y} L35 ${y}`} stroke="var(--ink)" strokeWidth="2.2" strokeLinecap="round" />
        </g>
      ))}
    </svg>
  );
}
