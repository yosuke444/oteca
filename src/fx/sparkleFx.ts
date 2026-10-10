import { gsap } from 'gsap';
import type { Pt } from './paperFx';

/**
 * 黄色いキラキラ（v2.1-K。SPEC §7 S09）。パックガチャ・デイリーパックの演出で使う。
 * layer は舞台（1280×720）の上に重ねた要素。座標は舞台の座標。
 * 「演出をへらす」の時は、呼ぶ側で数を減らし（1/4）、光の筋・降り続けるキラキラは出さない。
 */

/** 星形とひし形（4つのとがり）。手描きらしく、角を少しゆがめる */
const STAR = 'M12 1.5 L14.8 8.6 L22.4 9.1 L16.5 13.9 L18.5 21.4 L12 17.3 L5.6 21.6 L7.4 14 L1.6 9.3 L9.2 8.5 Z';
const DIAMOND = 'M12 0.8 Q13.4 10.4 23.2 12 Q13.6 13.5 12 23.2 Q10.4 13.6 0.8 12 Q10.6 10.5 12 0.8 Z';

/**
 * scale：粒の大きさの倍率（v2.3：数を 1/3 にまとめた時は大きく・明るく。1 より大きいと光も強い spark--big）
 */
function makeSparkle(layer: HTMLElement, size: number, kind: number, scale = 1): HTMLDivElement {
  const el = document.createElement('div');
  el.className = scale > 1 ? 'spark spark--big' : 'spark';
  size *= scale;
  const d = kind % 2 === 0 ? STAR : DIAMOND;
  // 塗りは黄色、縁は金色（ペンの線）。ときどき白い芯
  el.innerHTML = `<svg viewBox="0 0 24 24" width="${size}" height="${size}"><path d="${d}" fill="var(--fx-onom-fill)" stroke="var(--super-gold)" stroke-width="1.6" stroke-linejoin="round"/>${kind % 3 === 0 ? `<circle cx="12" cy="12" r="2.2" fill="var(--paper)"/>` : ''}</svg>`;
  layer.appendChild(el);
  return el;
}

const rnd = (a: number, b: number) => a + Math.random() * (b - a);

/**
 * 袋の口から噴き出す：数十個が放物線を描いて飛び散り、くるくる回りながら落ちて消える
 * @param at 袋の口（真ん中）
 */
export function sparkleFountain(layer: HTMLElement, at: Pt, count = 40, scale = 1): void {
  for (let i = 0; i < count; i++) {
    const size = rnd(14, 34);
    const el = makeSparkle(layer, size, i, scale);
    // 画面の上から出ないように、口の高さに合わせて上がる（低い袋ほど高く上がる）
    const up = rnd(60, Math.max(90, Math.min(300, at.y - 30)));
    const fall = rnd(320, 560);
    const dx = rnd(-480, 480);
    const t1 = rnd(0.35, 0.55);
    const t2 = rnd(0.7, 1.1);
    const delay = Math.random() * 0.18;
    gsap.set(el, { left: at.x + rnd(-30, 30), top: at.y, xPercent: -50, yPercent: -50, scale: 0.2, rotate: rnd(0, 360) });
    gsap.to(el, { scale: rnd(0.8, 1.3), duration: 0.2, delay, ease: 'back.out(3)' });
    gsap.to(el, { x: dx, duration: t1 + t2, delay, ease: 'none' });
    gsap.to(el, { keyframes: [{ y: -up, duration: t1, ease: 'power2.out' }, { y: fall - up, duration: t2, ease: 'power2.in' }], delay });
    gsap.to(el, { rotate: `+=${rnd(360, 900) * (Math.random() < 0.5 ? -1 : 1)}`, duration: t1 + t2, delay, ease: 'none' });
    gsap.to(el, { opacity: 0, duration: 0.35, delay: delay + t1 + t2 - 0.35, onComplete: () => el.remove() });
  }
}

/** カードの周りから弾ける（めくれる瞬間）。w・h はカードの大きさ（舞台の座標） */
export function sparkleBurst(layer: HTMLElement, at: Pt, count = 24, w = 230, h = 320, scale = 1): void {
  for (let i = 0; i < count; i++) {
    const size = rnd(12, 30);
    const el = makeSparkle(layer, size, i + 1, scale);
    const a = (i / count) * Math.PI * 2 + rnd(-0.2, 0.2);
    // カードの縁から外へ
    const sx = Math.cos(a) * w * 0.5;
    const sy = Math.sin(a) * h * 0.5;
    const d = rnd(80, 220);
    gsap.set(el, { left: at.x + sx, top: at.y + sy, xPercent: -50, yPercent: -50, scale: 0, rotate: rnd(0, 360) });
    gsap.to(el, { x: Math.cos(a) * d, y: Math.sin(a) * d + 40, scale: rnd(0.8, 1.4), rotate: `+=${rnd(180, 540)}`, duration: rnd(0.6, 0.9), ease: 'power3.out' });
    gsap.to(el, { opacity: 0, scale: 0.2, duration: 0.3, delay: rnd(0.55, 0.85), onComplete: () => el.remove() });
  }
}

/**
 * 画面の端から差し込む金色の光の筋（スーパーレア・確定の袋・サプライズ）。ゆっくり脈打つ。
 * @returns 消す関数
 */
export function goldBeams(layer: HTMLElement, center: Pt = { x: 640, y: 330 }): () => void {
  const els: HTMLDivElement[] = [];
  // 端の8か所から、真ん中へ向かって
  const from: Pt[] = [
    { x: 0, y: 0 },
    { x: 640, y: -40 },
    { x: 1280, y: 0 },
    { x: 1320, y: 360 },
    { x: 1280, y: 720 },
    { x: 640, y: 760 },
    { x: 0, y: 720 },
    { x: -40, y: 360 },
  ];
  from.forEach((p, i) => {
    const el = document.createElement('div');
    el.className = 'spark-beam';
    layer.appendChild(el);
    const ang = (Math.atan2(center.y - p.y, center.x - p.x) * 180) / Math.PI;
    const len = Math.hypot(center.x - p.x, center.y - p.y) * 0.9;
    gsap.set(el, { left: p.x, top: p.y, width: len, yPercent: -50, rotate: ang + rnd(-6, 6), transformOrigin: '0% 50%', scaleX: 0, opacity: 0 });
    gsap.to(el, { scaleX: 1, opacity: 0.85, duration: 0.5, delay: i * 0.04, ease: 'power2.out' });
    gsap.to(el, { opacity: 0.35, duration: rnd(0.6, 1), delay: 0.6 + i * 0.04, yoyo: true, repeat: -1, ease: 'sine.inOut' });
    els.push(el);
  });
  return () => {
    for (const el of els) {
      gsap.killTweensOf(el);
      gsap.to(el, { opacity: 0, duration: 0.3, onComplete: () => el.remove() });
    }
  };
}

/**
 * 画面全体にキラキラが降り続ける（止めるまで）。
 * @returns 止める関数（降っている分は、そのまま落ちて消える）
 */
export function sparkleRain(layer: HTMLElement, perSecond = 18, scale = 1): () => void {
  let n = 0;
  const spawn = () => {
    const el = makeSparkle(layer, rnd(12, 28), n++, scale);
    const dur = rnd(2.2, 3.6);
    gsap.set(el, { left: rnd(0, 1280), top: -30, xPercent: -50, yPercent: -50, rotate: rnd(0, 360), opacity: rnd(0.7, 1) });
    gsap.to(el, { top: 760, x: rnd(-120, 120), rotate: `+=${rnd(360, 720)}`, duration: dur, ease: 'none', onComplete: () => el.remove() });
    // ゆらゆら光る
    gsap.to(el, { scale: rnd(0.5, 0.8), duration: rnd(0.3, 0.5), yoyo: true, repeat: Math.ceil(dur / 0.4), ease: 'sine.inOut' });
  };
  // 演出スピードに合わせるため、gsap の時計で回す
  let next: gsap.core.Tween | null = null;
  const tick = () => {
    spawn();
    next = gsap.delayedCall(1 / perSecond, tick);
  };
  tick();
  return () => {
    next?.kill();
    next = null;
  };
}
