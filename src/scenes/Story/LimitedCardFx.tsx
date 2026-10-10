import { gsap } from 'gsap';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { audio } from '../../audio/audioManager';
import { CARD_DB } from '../../data/cards';
import { useFx } from '../../fx/fxSettings';
import { bigText, confetti, confettiRain, fireworks, flash, radialLines } from '../../fx/paperFx';
import { play, wait } from '../../fx/timing';
import { useT } from '../../i18n/useT';
import { PrizeCard } from '../../ui/card/PrizeCard';

/**
 * 限定カードを手に入れた時の特別演出（SPEC §7 S08・UPDATE_v2 §7-2「カードがゆっくり回転して所持に入る」）。迷ったら3倍豪華に：
 * 暗くなる → 光の粒が集まる → カードが小さく現れ、ゆっくり回りながら大きくなる → 白く光る → 虹色の光線 →
 * 「げんてい カード ゲット！」のはんこ → 紙吹雪と花火 → カードが小さくなって手元（所持）へ飛んでいく。
 * タップで飛ばせる（少し見せてから）。演出スピード・演出をへらす に従う。
 */
export function LimitedCardFx({ cardNo, onDone }: { cardNo: number; onDone: () => void }) {
  const tr = useT();
  const fx = useFx();
  const def = CARD_DB[cardNo];
  const rootRef = useRef<HTMLDivElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const noteRef = useRef<HTMLParagraphElement>(null);
  const [canSkip, setCanSkip] = useState(false);
  const done = useRef(false);
  /** ジングルを止める（飛ばした時・画面を出た時） */
  const stopJingle = useRef<() => void>(() => {});
  const finish = () => {
    if (done.current) return;
    done.current = true;
    stopJingle.current();
    onDone();
  };
  // キーボードでも飛ばせる（Enter・スペース・Esc）
  useEffect(() => {
    if (!canSkip) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'Escape') {
        e.preventDefault();
        finish();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [canSkip]);

  useLayoutEffect(() => {
    let alive = true;
    const cleanups: (() => void)[] = [];
    const reduce = fx.reduceFx;
    const L = layerRef.current!;
    const center = { x: 640, y: 320 };
    const run = async () => {
      stopJingle.current = audio.play('jingle_limited');
      gsap.set(noteRef.current, { opacity: 0 });
      await play(gsap.fromTo(rootRef.current, { opacity: 0 }, { opacity: 1, duration: 0.3 }));
      if (!alive) return;
      // 光の粒が集まってくる
      if (!reduce) confetti(L, center, 40, 0.6);
      // カードがゆっくり回りながら大きくなる
      await play(
        gsap.fromTo(
          cardRef.current,
          { scale: 0.1, rotationY: reduce ? 0 : -900, opacity: 0 },
          { scale: 1, rotationY: 0, opacity: 1, duration: reduce ? 0.3 : 2.2, ease: 'power2.out' },
        ),
      );
      if (!alive) return;
      setCanSkip(true);
      if (!reduce) {
        flash(L, 1, 0.5);
        cleanups.push(
          radialLines(L, center, {
            colors: ['var(--pen-red)', 'var(--super-gold)', 'var(--pen-green)', 'var(--pen-sky)', 'var(--pen-blue)', 'var(--pen-purple)', 'var(--fx-onom-fill)'],
            lines: 40,
            width: 18,
            inner: 190,
            seconds: 0.6,
          }),
        );
        confettiRain(L, 90);
        fireworks(L, { x: 300, y: 220 }, 3);
        fireworks(L, { x: 980, y: 220 }, 3);
      }
      cleanups.push(bigText(L, { x: 640, y: 92 }, tr.story.limitedGet, 'limited-stamp', -6));
      await play(gsap.fromTo(noteRef.current, { opacity: 0, y: 20 }, { opacity: 1, y: 0, duration: 0.3 }));
      if (!alive) return;
      await wait(1800);
      if (!alive) return;
      // 所持に入る：カードが小さくなって右下へ飛んでいく
      audio.play('se_card_place');
      await play(gsap.to(cardRef.current, { x: 460, y: 300, scale: 0.15, rotate: 20, opacity: 0, duration: reduce ? 0.2 : 0.7, ease: 'power2.in' }));
      if (!alive) return;
      await play(gsap.to(rootRef.current, { opacity: 0, duration: 0.3 }));
      if (alive) finish();
    };
    void run();
    return () => {
      alive = false;
      stopJingle.current();
      for (const c of cleanups) c();
    };
  }, []);

  return (
    <div className="limited-fx" ref={rootRef} data-testid="limited-fx" onClick={() => canSkip && finish()}>
      <div className="limited-fx__glow" aria-hidden />
      <div className="limited-fx__card" ref={cardRef}>
        <PrizeCard def={def} seed={`limited-${cardNo}`} width={230} />
      </div>
      <p className="limited-fx__note" ref={noteRef}>
        {tr.story.limitedNote(def.name)}
      </p>
      <div className="limited-fx__layer" ref={layerRef} aria-hidden />
      {canSkip && <p className="limited-fx__skip pencil">{tr.story.tapSkip}</p>}
    </div>
  );
}
