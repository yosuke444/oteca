import { gsap } from 'gsap';
import { Particles } from './particles';
import { rand } from './overlay';
import { play, wait } from './timing';

/**
 * リザルトの演出（SPEC §9-2 勝利・敗北）
 * - 勝ち：「かち！」が特大で書かれ、ピンクと黄色の蛍光ペンでなぞられる → 紙吹雪（方眼紙の切れ端 150個）
 *         ＋星と花火の落書きが3回打ち上がる → MVPカードが中央でくるっと1回転
 * - 負け：「まけ…」をえんぴつで書き、上に雨雲の落書き → 雨の線が降る → 最後に小さく「つぎは かてる！」
 * 時間は GSAP 全体の速さ（演出スピード）で短くなる。「演出をへらす」では紙吹雪・花火の線を出さない。
 */

export type ResultFxTargets = {
  root: HTMLElement;
  overlay: HTMLElement;
  canvas: HTMLCanvasElement;
  title: HTMLElement;
  /** 勝った時だけ */
  mvp: HTMLElement | null;
  /** 負けた時の「つぎは かてる！」 */
  next: HTMLElement | null;
  speed: () => number;
  reduce: () => boolean;
  sound: (key: string) => void;
  /** 粒子（「へらす」の時は null） */
  particles: Particles | null;
};

/** ページめくり（0.5秒）が終わってから始める */
const START_DELAY_MS = 500;

function add(parent: HTMLElement, cls: string, x: number, y: number, html = ''): HTMLElement {
  const el = document.createElement('div');
  el.className = `fx-el ${cls}`;
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
  el.innerHTML = html;
  parent.appendChild(el);
  return el;
}

/** 舞台の座標での要素の箱 */
function box(t: ResultFxTargets, el: Element) {
  const o = t.overlay.getBoundingClientRect();
  const r = el.getBoundingClientRect();
  const s = o.width / t.overlay.offsetWidth || 1;
  return { x: (r.left - o.left) / s, y: (r.top - o.top) / s, w: r.width / s, h: r.height / s };
}

/** 文字を左から書いていく（ペン先の点つき） */
async function writeIn(t: ResultFxTargets, el: HTMLElement, seconds: number, pencil = false): Promise<void> {
  const b = box(t, el);
  const tip = add(t.overlay, pencil ? 'fx-rtip fx-rtip--pencil' : 'fx-rtip', b.x, b.y + b.h * 0.7);
  t.sound('se_pen');
  await play(
    gsap
      .timeline()
      .fromTo(el, { clipPath: 'inset(-20% 100% -20% -5%)' }, { clipPath: 'inset(-20% -5% -20% -5%)', duration: seconds, ease: 'none' })
      .fromTo(tip, { left: b.x }, { left: b.x + b.w, duration: seconds, ease: 'none' }, 0)
      .to(tip, { opacity: 0, duration: 0.1 }),
  );
  tip.remove();
}

/** 星の落書き（ペン描き） */
const STAR = '<svg viewBox="-50 -50 100 100" width="70" height="70"><path d="M0 -42 L11 -13 L42 -12 L17 7 L26 38 L0 20 L-26 38 L-17 7 L-42 -12 L-11 -13 Z" fill="var(--marker-yellow)" stroke="var(--ink)" stroke-width="4" stroke-linejoin="round"/></svg>';

/** 花火の落書き：放射状の線がペンで伸びる＋星がポンと出る */
async function firework(t: ResultFxTargets, x: number, y: number, parts: Particles | null): Promise<void> {
  t.sound('se_stamp_chat');
  const colors = ['var(--pen-red)', 'var(--pen-blue)', 'var(--pen-green)', 'var(--super-gold)'];
  if (!t.reduce()) {
    const n = 14;
    const lines = Array.from({ length: n }, (_, i) => {
      const a = (i / n) * Math.PI * 2;
      const r0 = 18;
      const r1 = rand(80, 120);
      return `<path d="M${Math.cos(a) * r0} ${Math.sin(a) * r0} L${Math.cos(a) * r1} ${Math.sin(a) * r1}" stroke="${colors[i % colors.length]}" stroke-width="5" stroke-linecap="round"/>`;
    }).join('');
    const svg = add(t.overlay, 'fx-firework', x, y, `<svg viewBox="-130 -130 260 260" width="260" height="260">${lines}</svg>`);
    const paths = [...svg.querySelectorAll('path')];
    for (const p of paths) {
      const len = p.getTotalLength();
      p.style.strokeDasharray = `${len}`;
      p.style.strokeDashoffset = `${len}`;
    }
    gsap
      .timeline({ onComplete: () => svg.remove() })
      .to(paths, { strokeDashoffset: 0, duration: 0.35, ease: 'power2.out' })
      .to(svg, { opacity: 0, scale: 1.2, duration: 0.5 }, '+=0.25');
    parts?.burst({ kind: 'spark', x, y, count: 22, colors, speed: [150, 420], size: [6, 11], life: [0.6, 1.1], gravity: 200 });
  }
  const stars = Array.from({ length: 3 }, (_, i) => add(t.overlay, 'fx-rstar', x + (i - 1) * 70 + rand(-10, 10), y + rand(-60, 60), STAR));
  await play(gsap.fromTo(stars, { scale: 0, rotate: -120 }, { scale: () => rand(0.6, 1.1), rotate: 0, duration: 0.35, stagger: 0.08, ease: 'back.out(3)' }));
  gsap.to(stars, { opacity: 0, y: '-=30', duration: 0.6, delay: 0.5, onComplete: () => stars.forEach((s) => s.remove()) });
}

export async function playWin(t: ResultFxTargets): Promise<void> {
  const parts = t.reduce() ? null : t.particles;
  const span = t.title.querySelector('span') as HTMLElement | null;
  const text = span ?? t.title;
  gsap.set(text, { clipPath: 'inset(-20% 100% -20% -5%)' });
  if (t.mvp) gsap.set(t.mvp, { opacity: 0 });
  await wait(START_DELAY_MS);
  t.sound('jingle_win');
  // 「かち！」が特大で書かれる
  await writeIn(t, text, 0.6);
  // ピンクと黄色の蛍光ペンでなぞる
  const b = box(t, text);
  const hb = box(t, t.title);
  const pink = add(t.title, 'fx-rmarker fx-rmarker--pink', b.x - hb.x - 10, b.y - hb.y + b.h * 0.58);
  const yellow = add(t.title, 'fx-rmarker fx-rmarker--yellow', b.x - hb.x - 4, b.y - hb.y + b.h * 0.7);
  for (const [m, w] of [
    [pink, b.w + 20],
    [yellow, b.w + 8],
  ] as const) {
    m.style.width = `${w}px`;
    m.style.height = `${b.h * 0.24}px`;
  }
  await play(gsap.fromTo(pink, { scaleX: 0 }, { scaleX: 1, transformOrigin: 'left center', duration: 0.28, ease: 'power2.out' }));
  await play(gsap.fromTo(yellow, { scaleX: 0 }, { scaleX: 1, transformOrigin: 'left center', duration: 0.28, ease: 'power2.out' }));
  // 紙吹雪 150個 ＋ 星と花火が3回
  parts?.burst({
    kind: 'paper',
    x: 640,
    y: -30,
    count: 150,
    colors: ['var(--marker-pink)', 'var(--marker-yellow)', 'var(--pen-blue)', 'var(--pen-green)', 'var(--pen-red)'],
    angle: Math.PI / 2,
    spread: Math.PI / 2.4,
    speed: [180, 560],
    size: [5, 10],
    life: [2.4, 3.8],
    gravity: 230,
    drag: 0.35,
    area: 640,
  });
  // 題の文字を隠さないよう、題の左・右・右下で打ち上げる
  const spots = [
    [150, 170],
    [1130, 160],
    [1110, 430],
  ];
  for (const [x, y] of spots) {
    void firework(t, x, y, parts);
    await wait(380);
  }
  // MVPカードが中央でくるっと1回転してから、元の場所へ
  if (t.mvp) {
    const mb = box(t, t.mvp);
    // .result__mvp には CSS の scale が付いていて、GSAP の移動もその倍率で大きくなるので割っておく
    const k = parseFloat(getComputedStyle(t.mvp).scale) || 1;
    const dx = (640 - (mb.x + mb.w / 2)) / k;
    const dy = (380 - (mb.y + mb.h / 2)) / k;
    gsap.set(t.mvp, { transformPerspective: 900 });
    t.sound('se_card_place');
    await play(gsap.fromTo(t.mvp, { opacity: 0, x: dx, y: dy, scale: 0.4 }, { opacity: 1, scale: 1.3, duration: 0.25, ease: 'back.out(2)' }));
    await play(gsap.to(t.mvp, { rotateY: 360, duration: 0.8, ease: 'power2.inOut' }));
    t.sound('se_stamp');
    await play(gsap.to(t.mvp, { x: 0, y: 0, scale: 1, duration: 0.4, ease: 'power2.inOut', clearProps: 'transform' }));
  }
}

const CLOUD =
  '<svg viewBox="0 0 220 110" width="220" height="110"><path d="M40 90 Q8 90 12 64 Q14 42 40 44 Q44 14 80 18 Q100 -2 130 14 Q160 4 172 34 Q208 34 206 64 Q206 92 176 90 Z" fill="var(--paper)" stroke="var(--pencil)" stroke-width="4" stroke-linejoin="round"/><path d="M60 62 q10 -8 20 0 M120 58 q10 -8 20 0" fill="none" stroke="var(--pencil)" stroke-width="3" stroke-linecap="round"/></svg>';

export async function playLose(t: ResultFxTargets): Promise<void> {
  const span = t.title.querySelector('span') as HTMLElement | null;
  const text = span ?? t.title;
  gsap.set(text, { clipPath: 'inset(-20% 100% -20% -5%)' });
  if (t.next) gsap.set(t.next, { opacity: 0 });
  await wait(START_DELAY_MS);
  t.sound('jingle_lose');
  // 「まけ…」をえんぴつで書く（ゆっくり）
  await writeIn(t, text, 1.0, true);
  // 上に雨雲の落書き
  const b = box(t, text);
  const cloud = add(t.overlay, 'fx-cloud', b.x + b.w / 2, b.y + 14, CLOUD);
  const paths = [...cloud.querySelectorAll('path')];
  for (const p of paths) {
    const len = p.getTotalLength();
    p.style.strokeDasharray = `${len}`;
    p.style.strokeDashoffset = `${len}`;
  }
  t.sound('se_pen');
  await play(gsap.to(paths, { strokeDashoffset: 0, duration: 0.6, stagger: 0.1, ease: 'power1.inOut' }));
  // 雨の線が降る
  const drops = Array.from({ length: 22 }, () => add(t.overlay, 'fx-rain', b.x + b.w / 2 + rand(-70, 70), b.y + 10));
  const rain = gsap.timeline({ repeat: 2 });
  drops.forEach((d) => {
    rain.fromTo(d, { y: 0, opacity: 0 }, { y: rand(90, 140), opacity: 1, duration: rand(0.45, 0.7), ease: 'power1.in' }, rand(0, 0.5));
  });
  await play(rain);
  gsap.to(drops, { opacity: 0, duration: 0.3, onComplete: () => drops.forEach((d) => d.remove()) });
  // 最後に小さく「つぎは かてる！」
  if (t.next) await play(gsap.fromTo(t.next, { opacity: 0, y: 10, rotate: -6 }, { opacity: 1, y: 0, rotate: -3, duration: 0.35, ease: 'back.out(2)' }));
}

/** 途中で画面を離れた時：動きを止め、出した落書きを消す */
export function stopResultFx(t: ResultFxTargets): void {
  const els = [t.title, ...t.title.querySelectorAll('*'), ...t.overlay.querySelectorAll('*'), ...(t.mvp ? [t.mvp] : []), ...(t.next ? [t.next] : [])];
  gsap.killTweensOf(els);
  t.overlay.replaceChildren();
  t.title.querySelectorAll('.fx-rmarker').forEach((e) => e.remove());
  t.particles?.clear();
}
