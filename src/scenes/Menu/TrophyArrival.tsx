import { gsap } from 'gsap';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { audio } from '../../audio/audioManager';
import { trophyDef } from '../../data/cards';
import { useFx } from '../../fx/fxSettings';
import { useT } from '../../i18n/useT';
import { arrivedTrophies, clearArrived, onArrived } from '../../online/mailbox';
import { CardDetail } from '../../ui/card/CardDetail';
import { TrophyDoodle } from '../../ui/card/CardArt';
import { RoughButton } from '../../ui/rough/RoughButton';
import './trophy.css';

/** 降ってくるトロフィーの数（演出をへらす時は少なく） */
const RAIN = 22;
const RAIN_REDUCED = 5;

/**
 * トロフィーが届いた（v2.0-J。SPEC §7 S20）：メニューの上に、トロフィーが降ってくる豪華な演出で受け取る。
 * 演出の長さは「えんしゅつ スピード」、数と揺れは「えんしゅつを へらす」に従う。演出の途中でセーブは書き換えない（受け取りは郵便受けで済んでいる）
 */
export function TrophyArrival() {
  const tr = useT();
  const fx = useFx();
  const [numbers, setNumbers] = useState<number[]>(() => arrivedTrophies());
  const rainRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  useEffect(() => onArrived(() => setNumbers(arrivedTrophies())), []);

  const shown = numbers[0];
  useLayoutEffect(() => {
    if (shown === undefined) return;
    audio.play('se_super_shine');
    const ctx = gsap.context(() => {
      const drops = rainRef.current?.querySelectorAll<HTMLElement>('.trophy-rain__drop') ?? [];
      drops.forEach((el, i) => {
        gsap.fromTo(
          el,
          { y: -140, rotate: -30 + (i % 7) * 10, opacity: 1 },
          {
            y: 820,
            rotate: fx.reduceFx ? 0 : 200 - (i % 5) * 80,
            duration: fx.dur(1600 + (i % 6) * 220) / 1000,
            delay: fx.dur(i * 90) / 1000,
            ease: 'power1.in',
            repeat: fx.reduceFx ? 0 : 1,
          },
        );
      });
      if (cardRef.current)
        gsap.fromTo(cardRef.current, { scale: 0.2, rotate: -12, opacity: 0 }, { scale: 1, rotate: 0, opacity: 1, duration: fx.dur(700) / 1000, delay: fx.dur(500) / 1000, ease: fx.reduceFx ? 'none' : 'back.out(2.2)' });
    });
    const id = window.setTimeout(() => audio.play('se_coin_burst'), fx.dur(600));
    return () => {
      ctx.revert();
      window.clearTimeout(id);
    };
  }, [shown]);

  if (shown === undefined) return null;
  const count = fx.reduceFx ? RAIN_REDUCED : RAIN;
  const next = () => {
    const rest = numbers.slice(1);
    setNumbers(rest);
    if (!rest.length) clearArrived();
  };
  return (
    <div className="trophy-arrival" data-testid="trophy-arrival">
      <div className="trophy-rain" ref={rainRef} aria-hidden>
        {Array.from({ length: count }, (_, i) => (
          <span key={`${shown}-${i}`} className="trophy-rain__drop" style={{ left: `${(i * 37) % 100}%` }}>
            <TrophyDoodle />
          </span>
        ))}
      </div>
      <div className="trophy-arrival__panel">
        <h2 className="trophy-arrival__title">{tr.trophyGet.title}</h2>
        <div className="trophy-arrival__card" ref={cardRef}>
          <CardDetail def={trophyDef(shown)} seed={`trophy-get-${shown}`} />
        </div>
        <p className="trophy-arrival__text">{tr.trophyGet.text(shown)}</p>
        <RoughButton seed="trophy-get-ok" className="trophy-arrival__ok" highlight onClick={next} data-testid="trophy-get-ok">
          {tr.trophyGet.ok}
        </RoughButton>
      </div>
    </div>
  );
}
