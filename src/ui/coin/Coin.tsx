import { gsap } from 'gsap';
import { useEffect, useRef, useState } from 'react';
import { audio } from '../../audio/audioManager';
import { useFx } from '../../fx/fxSettings';
import { useT } from '../../i18n/useT';
import { imageUrl } from '../imageFiles';
import './coin.css';

/**
 * おてあげコイン（SPEC §7 S11）。丸いコインに白旗を手描きした SVG。
 * public/images/coin.png があればそれを使う（無ければ SVG）。飛ばすコインも同じ絵
 */
export function CoinIcon({ size = 30, className }: { size?: number; className?: string }) {
  const url = imageUrl('images/coin.png');
  if (url) return <img src={url} width={size} height={size} alt="" className={`coin-icon coin-icon--img ${className ?? ''}`} draggable={false} />;
  return (
    <svg className={`coin-icon ${className ?? ''}`} viewBox="0 0 40 40" width={size} height={size} aria-hidden>
      <circle cx="20" cy="20" r="17" fill="var(--super-gold)" stroke="var(--ink)" strokeWidth="2.2" />
      <circle cx="20" cy="20" r="13" fill="none" stroke="var(--ink)" strokeWidth="1.1" strokeDasharray="2.5 2" opacity="0.6" />
      {/* 白旗：棒と、ゆれる旗 */}
      <path d="M15 29 L15 11" stroke="var(--ink)" strokeWidth="2" strokeLinecap="round" />
      <path d="M15.5 11.5 Q20 9.5 24 12 Q27 13.5 29 12.2 L28.4 20 Q25.6 21.4 22.6 19.6 Q19 17.6 15.5 19.4 Z" fill="var(--paper)" stroke="var(--ink)" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M8.5 15 Q10 10.5 14 8.5" stroke="var(--paper)" strokeWidth="1.6" strokeLinecap="round" fill="none" opacity="0.7" />
    </svg>
  );
}

/**
 * コインの枚数（右上に常に出す）。value が増えると、数字がカウントアップしてはねる。
 * data-coin-target：飛んでくるコインの行き先
 */
export function CoinCounter({ value, className }: { value: number; className?: string }) {
  const fx = useFx();
  const tr = useT();
  const [shown, setShown] = useState(value);
  const shownRef = useRef(value);
  const numRef = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const from = shownRef.current;
    if (value === from) return;
    if (value < from || fx.reduceFx) {
      // 減る時（ガチャ）・演出をへらす時は、すぐに変える
      shownRef.current = value;
      setShown(value);
      return;
    }
    const o = { n: from };
    const tween = gsap.to(o, {
      n: value,
      duration: Math.min(1.2, 0.3 + (value - from) / 120),
      ease: 'power1.out',
      onUpdate: () => {
        const n = Math.round(o.n);
        shownRef.current = n;
        setShown(n);
      },
      onComplete: () => {
        shownRef.current = value;
        setShown(value);
        if (numRef.current) gsap.fromTo(numRef.current, { scale: 1.45 }, { scale: 1, duration: 0.3, ease: 'back.out(3)' });
      },
    });
    return () => {
      tween.kill();
    };
  }, [value, fx.reduceFx]);
  return (
    <div className={`coin-counter ${className ?? ''}`} data-coin-target data-testid="coin-counter" role="status" aria-label={tr.coin.aria(value)}>
      <CoinIcon size={32} />
      <span ref={numRef} className="num coin-counter__num">
        {shown.toLocaleString('en-US')}
      </span>
    </div>
  );
}

type Pt = { x: number; y: number };

/** 要素の真ん中（layer の中の座標。舞台の拡大縮小を戻す） */
export function centerIn(layer: HTMLElement, el: Element): Pt {
  const lr = layer.getBoundingClientRect();
  const r = el.getBoundingClientRect();
  const s = lr.width / (layer.offsetWidth || 1);
  return { x: (r.left + r.width / 2 - lr.left) / s, y: (r.top + r.height / 2 - lr.top) / s };
}

/**
 * コインを飛ばす（SPEC §7 S11）：from から噴き出して、コイン表示（data-coin-target）へ吸い込まれる。
 * 演出スピードに従い、演出をへらす時は枚数を減らして まっすぐ飛ばす。
 */
export async function flyCoins(layer: HTMLElement, from: Pt, count: number, opts: { reduce: boolean; burst?: boolean; alive?: () => boolean }): Promise<void> {
  const alive = opts.alive ?? (() => layer.isConnected);
  const target = document.querySelector('[data-coin-target]');
  const to = target ? centerIn(layer, target) : { x: 1150, y: 40 };
  const n = opts.reduce ? Math.min(3, count) : count;
  const coins: Promise<void>[] = [];
  let landed = 0;
  for (let i = 0; i < n; i++) {
    const el = document.createElement('div');
    el.className = 'coin-fly';
    const url = imageUrl('images/coin.png');
    el.innerHTML = url ? `<img src="${url}" width="30" height="30" alt="">` : COIN_SVG;
    layer.appendChild(el);
    gsap.set(el, { left: from.x, top: from.y, xPercent: -50, yPercent: -50, scale: 0.4, rotate: 0 });
    const a = -Math.PI / 2 + (Math.random() - 0.5) * (opts.burst ? 2.6 : 1.4);
    const dist = opts.burst ? 110 + Math.random() * 120 : 50 + Math.random() * 50;
    const mid = { x: from.x + Math.cos(a) * dist, y: from.y + Math.sin(a) * dist };
    const tl = gsap.timeline({ delay: (i * (opts.burst ? 0.035 : 0.07)) });
    if (!opts.reduce) {
      tl.to(el, { left: mid.x, top: mid.y, scale: 1, rotate: 360 * (Math.random() > 0.5 ? 1 : -1), duration: 0.38, ease: 'power2.out' });
      tl.to(el, { duration: 0.08 + Math.random() * 0.12 });
    }
    tl.to(el, { left: to.x, top: to.y, scale: 0.55, rotate: '+=180', duration: 0.42, ease: 'power2.in' });
    coins.push(
      new Promise((resolve) => {
        tl.eventCallback('onComplete', () => {
          el.remove();
          landed += 1;
          // 画面を出た後は鳴らさない
          if (!alive()) {
            resolve();
            return;
          }
          // 鳴らしすぎないよう、3枚に1回
          if (landed % 3 === 1 || n <= 3) audio.play('se_coin');
          resolve();
        });
      }),
    );
  }
  await Promise.all(coins);
}

/** 飛ばす用のコイン（SVG の文字列。React の外で作るため） */
const COIN_SVG = `<svg viewBox="0 0 40 40" width="30" height="30" aria-hidden="true"><circle cx="20" cy="20" r="17" fill="var(--super-gold)" stroke="var(--ink)" stroke-width="2.2"/><path d="M15 29 L15 11" stroke="var(--ink)" stroke-width="2" stroke-linecap="round"/><path d="M15.5 11.5 Q20 9.5 24 12 Q27 13.5 29 12.2 L28.4 20 Q25.6 21.4 22.6 19.6 Q19 17.6 15.5 19.4 Z" fill="var(--paper)" stroke="var(--ink)" stroke-width="1.6"/></svg>`;
