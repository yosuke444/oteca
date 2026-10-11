import { gsap } from 'gsap';
import { useLayoutEffect, useRef, useState } from 'react';
import { audio } from '../../audio/audioManager';
import { useFx } from '../../fx/fxSettings';
import { play, setFxSpeed, wait } from '../../fx/timing';
import { useT } from '../../i18n/useT';
import { imageUrl } from '../imageFiles';
import { flyCoins } from './Coin';
import { centerIn, confetti, flash } from '../../fx/paperFx';
import { sparkleBurst } from '../../fx/sparkleFx';
import './coin.css';

/**
 * ログインボーナスのプレゼントボックス（SPEC §7 S11）。
 * 置いてある間は小さく揺れて光る。押すと：リボンがほどける → ふたが飛ぶ → 光が広がる → コインが噴き出して
 * コイン表示へ飛ぶ → 「+50」。public/images/present.webp があればそれを使う（無ければ手描きの SVG）。
 * @param onOpen 押した瞬間に呼ぶ（ここで保存する。演出の途中で閉じても、もらい損ねない）
 * @param onCoins コインが コイン表示に着いた時（数字のカウントアップを始める合図）
 * @param onDone 演出が終わった時
 * @param appear 残り時間が0になって、空いた箱からリボン付きに戻った時（ポンッと戻ってキラキラ。v2.1-L）
 */
export function PresentBox({
  amount,
  layer,
  onOpen,
  onCoins,
  onDone,
  appear = false,
}: {
  amount: number;
  layer: () => HTMLElement | null;
  onOpen: () => void;
  onCoins: () => void;
  onDone: () => void;
  appear?: boolean;
}) {
  const tr = useT();
  const fx = useFx();
  const [opening, setOpening] = useState(false);
  /** 押したか（同じ瞬間に2回押されても1回だけ開く） */
  const pressed = useRef(false);
  const root = useRef<HTMLButtonElement>(null);
  const bowL = useRef<SVGPathElement>(null);
  const bowR = useRef<SVGPathElement>(null);
  const ribbonV = useRef<SVGPathElement>(null);
  const lid = useRef<SVGGElement>(null);
  const rays = useRef<SVGGElement>(null);
  const img = imageUrl('images/present.webp');

  // 24時間たって、空いた箱がリボン付きに戻る：ポンッと跳ねて戻り、まわりにキラキラ。
  // 揺れの CSS アニメ（transform）が GSAP の動きを打ち消すので、戻る間は is-appearing で揺れを止める
  const [appearing, setAppearing] = useState(appear);
  const sparkleTimer = useRef(0);
  useLayoutEffect(() => {
    if (!appear) return;
    const el = root.current!;
    const reduce = fx.reduceFx;
    setFxSpeed(fx.speed);
    // 音とキラキラは少し待ってから（開発時の StrictMode で効果が2回走っても、1回目は後始末で消える）
    sparkleTimer.current = window.setTimeout(() => {
      if (!el.isConnected || pressed.current) return;
      audio.play('se_sparkle');
      const L = layer();
      if (L && !reduce) sparkleBurst(L, centerIn(L, el), 24, 120, 120);
    }, fx.dur(200));
    const tween = reduce
      ? gsap.fromTo(el, { opacity: 0 }, { opacity: 1, duration: 0.2, onComplete: () => setAppearing(false) })
      : gsap.fromTo(el, { scale: 0.2, rotate: -40, opacity: 0 }, { scale: 1, rotate: 0, opacity: 1, duration: 0.6, ease: 'back.out(3)', clearProps: 'transform,opacity', onComplete: () => setAppearing(false) });
    return () => {
      window.clearTimeout(sparkleTimer.current);
      tween.kill();
    };
  }, []);

  const open = async () => {
    if (pressed.current) return;
    pressed.current = true;
    window.clearTimeout(sparkleTimer.current);
    setOpening(true);
    onOpen();
    setFxSpeed(fx.speed);
    const reduce = fx.reduceFx;
    const el = root.current!;
    const L = layer();
    gsap.killTweensOf(el);
    // 1. 箱が画面のまんなかへ跳んで、大きくなる（演出をへらす時は その場で）
    if (L && !reduce) {
      const at = centerIn(L, el);
      const s0 = L.getBoundingClientRect().width / (L.offsetWidth || 1);
      const scaleNow = el.getBoundingClientRect().width / s0 / el.offsetWidth || 1;
      await play(gsap.to(el, { x: (640 - at.x) / scaleNow, y: (330 - at.y) / scaleNow, scale: 2.4, duration: 0.42, ease: 'back.out(1.6)' }));
    }
    audio.play('se_present');
    // 2. ぶるぶる震える（だんだん強く）
    if (!reduce) {
      await play(gsap.fromTo(el, { rotate: -4 }, { rotate: 4, duration: 0.05, yoyo: true, repeat: 5, ease: 'none' }));
      await play(gsap.fromTo(el, { rotate: -9 }, { rotate: 9, duration: 0.04, yoyo: true, repeat: 5, ease: 'none' }));
    }
    gsap.set(el, { rotate: 0 });
    // 3. リボンがほどける（ちょうちょ結びが左右に飛ぶ・縦のリボンがほどけて落ちる）
    if (bowL.current && bowR.current && ribbonV.current) {
      await Promise.all([
        play(gsap.to(bowL.current, { x: -70, y: -50, rotate: -160, opacity: 0, transformOrigin: '50% 50%', duration: 0.35, ease: 'power2.out' })),
        play(gsap.to(bowR.current, { x: 70, y: -50, rotate: 160, opacity: 0, transformOrigin: '50% 50%', duration: 0.35, ease: 'power2.out' })),
        play(gsap.to(ribbonV.current, { scaleY: 0, transformOrigin: '50% 100%', duration: 0.3, ease: 'power1.in' })),
      ]);
    }
    // 4. ふたが「ポンッ」と飛び、画面が白く光る
    if (lid.current) gsap.to(lid.current, { y: -140, x: 50, rotate: 200, opacity: 0, transformOrigin: '50% 50%', duration: 0.6, ease: 'power2.out' });
    if (L && !reduce) flash(L);
    // 5. 光が広がって回り、星と紙吹雪の落書きが飛び、コインが噴き出す
    if (rays.current && !reduce) {
      gsap.fromTo(rays.current, { scale: 0.2, opacity: 0 }, { scale: 2, opacity: 1, duration: 0.5, ease: 'power2.out', transformOrigin: '50% 60%' });
      gsap.to(rays.current, { rotate: 120, duration: 2.4, ease: 'none', transformOrigin: '50% 60%' });
    }
    audio.play('se_coin_burst');
    if (L) {
      const from = centerIn(L, el);
      if (!reduce) confetti(L, from);
      const plus = document.createElement('div');
      plus.className = 'coin-plus num';
      plus.textContent = tr.coin.plus(amount);
      L.appendChild(plus);
      gsap.set(plus, { left: from.x, top: from.y - 70, xPercent: -50, yPercent: -50 });
      gsap.fromTo(plus, { scale: 0.2, opacity: 0, rotate: -12 }, { scale: reduce ? 1 : 1.6, opacity: 1, rotate: -4, y: -50, duration: 0.55, ease: 'back.out(3)' });
      await flyCoins(L, from, reduce ? 3 : 32, { reduce, burst: true, alive: () => el.isConnected });
      onCoins();
      await wait(450);
      await play(gsap.to(plus, { opacity: 0, y: -90, duration: 0.35 }));
      plus.remove();
    } else {
      onCoins();
    }
    if (rays.current) gsap.to(rays.current, { opacity: 0, duration: 0.3 });
    await play(gsap.to(el, { opacity: 0, scale: reduce ? 0.6 : 1.2, duration: 0.35 }));
    onDone();
  };

  return (
    <button ref={root} type="button" className={`present-box ${opening ? 'is-opening' : ''} ${appearing ? 'is-appearing' : ''}`} onClick={open} aria-label={tr.coin.presentAria} data-testid="present-box">
      {img ? (
        <img src={img} alt="" className="present-box__img" draggable={false} />
      ) : (
        <svg viewBox="0 0 120 120" width="120" height="120" aria-hidden className="present-box__svg">
          <g ref={rays} className="present-box__rays" opacity="0">
            {Array.from({ length: 12 }, (_, i) => {
              const a = (i / 12) * Math.PI * 2;
              return <path key={i} d={`M60 72 L${60 + Math.cos(a) * 58} ${72 + Math.sin(a) * 58}`} stroke="var(--fx-onom-fill)" strokeWidth="7" strokeLinecap="round" />;
            })}
          </g>
          {/* 箱 */}
          <path d="M22 58 L98 57 L96 110 L24 111 Z" fill="var(--note-red)" stroke="var(--ink)" strokeWidth="3" strokeLinejoin="round" />
          <path d="M30 70 L36 64 M44 92 L52 84 M76 100 L84 92 M70 70 L76 64" stroke="var(--pen-red)" strokeWidth="2" strokeLinecap="round" opacity="0.6" />
          <path ref={ribbonV} d="M54 58 L66 58 L66 110 L54 110 Z" fill="var(--super-gold)" stroke="var(--ink)" strokeWidth="2.2" />
          {/* ふた */}
          <g ref={lid}>
            <path d="M16 44 L104 43 L103 59 L17 60 Z" fill="var(--note-red)" stroke="var(--ink)" strokeWidth="3" strokeLinejoin="round" />
            <path d="M54 43 L66 43 L66 59 L54 59 Z" fill="var(--super-gold)" stroke="var(--ink)" strokeWidth="2.2" />
            {/* ちょうちょ結び */}
            <path ref={bowL} d="M60 42 Q40 22 32 34 Q30 44 60 42 Z" fill="var(--super-gold)" stroke="var(--ink)" strokeWidth="2.4" strokeLinejoin="round" />
            <path ref={bowR} d="M60 42 Q80 22 88 34 Q90 44 60 42 Z" fill="var(--super-gold)" stroke="var(--ink)" strokeWidth="2.4" strokeLinejoin="round" />
            <circle cx="60" cy="42" r="5" fill="var(--super-gold)" stroke="var(--ink)" strokeWidth="2.2" />
          </g>
        </svg>
      )}
      <span className="present-box__label">{tr.coin.present}</span>
    </button>
  );
}

