import { gsap } from 'gsap';

/**
 * 画面の上に重ねる、紙とペンの演出の部品（v2.0：ログボ・パックガチャ）。
 * layer は舞台（1280×720）の上に重ねた要素。座標は舞台の座標。
 * 「演出をへらす」の時は呼ぶ側で使わない（フラッシュ・揺れ・紙吹雪は出さない。CLAUDE.md 9）。
 */

export type Pt = { x: number; y: number };

const COLORS = ['var(--pen-red)', 'var(--pen-blue)', 'var(--pen-green)', 'var(--super-gold)', 'var(--pen-purple)', 'var(--pen-sky)'];

/** 要素の真ん中（layer の中の座標。舞台の拡大縮小を戻す） */
export function centerIn(layer: HTMLElement, el: Element): Pt {
  const lr = layer.getBoundingClientRect();
  const r = el.getBoundingClientRect();
  const s = lr.width / (layer.offsetWidth || 1);
  return { x: (r.left + r.width / 2 - lr.left) / s, y: (r.top + r.height / 2 - lr.top) / s };
}

/** 画面が一瞬 白く光る */
export function flash(layer: HTMLElement, strength = 0.9, seconds = 0.45): void {
  const f = document.createElement('div');
  f.className = 'paper-flash';
  layer.appendChild(f);
  gsap.fromTo(f, { opacity: strength }, { opacity: 0, duration: seconds, ease: 'power2.out', onComplete: () => f.remove() });
}

/** 星と紙吹雪の落書きが飛び散る。scale：1つの大きさ（v2.3：数を減らした時に大きく） */
export function confetti(layer: HTMLElement, at: Pt, count = 34, spread = 1, scale = 1): void {
  for (let i = 0; i < count; i++) {
    const star = i % 3 === 0;
    const el = document.createElement('div');
    el.className = star ? 'paper-confetti paper-confetti--star' : 'paper-confetti';
    const color = COLORS[i % COLORS.length];
    el.innerHTML = star
      ? `<svg viewBox="0 0 24 24" width="26" height="26"><path d="M12 2 L14.6 9 L22 9.4 L16.2 14 L18.3 21.4 L12 17 L5.7 21.4 L7.8 14 L2 9.4 L9.4 9 Z" fill="none" stroke="${color}" stroke-width="2.2" stroke-linejoin="round"/></svg>`
      : `<span style="background:${color}"></span>`;
    layer.appendChild(el);
    const a = Math.random() * Math.PI * 2;
    const d = (120 + Math.random() * 260) * spread;
    gsap.set(el, { left: at.x, top: at.y, xPercent: -50, yPercent: -50, scale });
    gsap.to(el, {
      x: Math.cos(a) * d,
      y: Math.sin(a) * d * 0.8 + 60,
      rotate: (Math.random() - 0.5) * 720,
      opacity: 0,
      duration: 1 + Math.random() * 0.7,
      ease: 'power2.out',
      onComplete: () => el.remove(),
    });
  }
}

/** 上から紙吹雪が降る（画面全体）。scale：1つの大きさ */
export function confettiRain(layer: HTMLElement, count = 60, scale = 1): void {
  for (let i = 0; i < count; i++) {
    const el = document.createElement('div');
    el.className = 'paper-confetti';
    el.innerHTML = `<span style="background:${COLORS[i % COLORS.length]}"></span>`;
    layer.appendChild(el);
    // 画面のすぐ上から降り始める（遠くから降らせて、見えない時間を長くしない）
    gsap.set(el, { left: Math.random() * 1280, top: -30 - Math.random() * 120, rotate: Math.random() * 360, scale });
    gsap.to(el, { top: 760, x: (Math.random() - 0.5) * 160, rotate: '+=' + (360 + Math.random() * 540), duration: 1.6 + Math.random() * 1.2, ease: 'none', onComplete: () => el.remove() });
  }
}

/** 花火の落書き：ペンの線が丸く広がって消える */
export function fireworks(layer: HTMLElement, at: Pt, count = 3): void {
  for (let k = 0; k < count; k++) {
    const c = { x: at.x + (Math.random() - 0.5) * 700, y: at.y - 120 + (Math.random() - 0.5) * 240 };
    const color = COLORS[(k * 2) % COLORS.length];
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'paper-firework');
    svg.setAttribute('viewBox', '-60 -60 120 120');
    svg.setAttribute('width', '160');
    svg.setAttribute('height', '160');
    let paths = '';
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      paths += `<path d="M${Math.cos(a) * 14} ${Math.sin(a) * 14} L${Math.cos(a) * 52} ${Math.sin(a) * 52}" stroke="${color}" stroke-width="5" stroke-linecap="round"/>`;
    }
    svg.innerHTML = paths;
    layer.appendChild(svg);
    gsap.set(svg, { left: c.x, top: c.y, xPercent: -50, yPercent: -50, scale: 0.1, opacity: 1 });
    gsap.to(svg, { scale: 1.3, rotate: 25, duration: 0.6, delay: k * 0.22, ease: 'power2.out' });
    gsap.to(svg, { opacity: 0, duration: 0.4, delay: k * 0.22 + 0.45, onComplete: () => svg.remove() });
  }
}

/**
 * 放射状の線（ペンの集中線・虹色の蛍光ペン）。lines 本を中心から外へ引く。
 * @returns 消す関数
 */
export function radialLines(layer: HTMLElement, at: Pt, opts: { colors: string[]; lines?: number; width?: number; inner?: number; outer?: number; seconds?: number }): () => void {
  const n = opts.lines ?? 24;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'paper-radial');
  svg.setAttribute('viewBox', '0 0 1280 720');
  svg.setAttribute('width', '1280');
  svg.setAttribute('height', '720');
  const inner = opts.inner ?? 120;
  const outer = opts.outer ?? 900;
  let paths = '';
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + Math.random() * 0.1;
    const r0 = inner + Math.random() * 40;
    const color = opts.colors[i % opts.colors.length];
    paths += `<path d="M${at.x + Math.cos(a) * r0} ${at.y + Math.sin(a) * r0} L${at.x + Math.cos(a) * outer} ${at.y + Math.sin(a) * outer}" stroke="${color}" stroke-width="${opts.width ?? 14}" stroke-linecap="round" opacity="0.75" pathLength="1" stroke-dasharray="1" stroke-dashoffset="1"/>`;
  }
  svg.innerHTML = paths;
  layer.appendChild(svg);
  gsap.to(svg.querySelectorAll('path'), { strokeDashoffset: 0, duration: opts.seconds ?? 0.45, stagger: 0.01, ease: 'power2.out' });
  return () => {
    gsap.to(svg, { opacity: 0, duration: 0.3, onComplete: () => svg.remove() });
  };
}

/** 大きな文字（はんこ・特大文字）を出す。消す関数を返す */
export function bigText(layer: HTMLElement, at: Pt, text: string, className: string, rotate = -8): () => void {
  const el = document.createElement('div');
  el.className = `paper-bigtext ${className}`;
  el.textContent = text;
  layer.appendChild(el);
  gsap.set(el, { left: at.x, top: at.y, xPercent: -50, yPercent: -50, rotate });
  gsap.fromTo(el, { scale: 3, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.32, ease: 'back.out(2.2)' });
  return () => {
    gsap.to(el, { opacity: 0, scale: 0.9, duration: 0.3, onComplete: () => el.remove() });
  };
}

/** 要素を揺らす（画面揺れ） */
export function shake(el: HTMLElement, strength = 12, times = 6): Promise<void> {
  return new Promise((resolve) => {
    gsap.fromTo(el, { x: -strength }, { x: strength, duration: 0.04, yoyo: true, repeat: times, ease: 'none', clearProps: 'x', onComplete: () => resolve() });
  });
}

/** 紙くずが飛ぶ（袋を破った時） */
export function paperScraps(layer: HTMLElement, at: Pt, count = 10): void {
  for (let i = 0; i < count; i++) {
    const el = document.createElement('div');
    el.className = 'paper-scrap';
    layer.appendChild(el);
    const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.4;
    const d = 60 + Math.random() * 120;
    gsap.set(el, { left: at.x + (Math.random() - 0.5) * 60, top: at.y, rotate: Math.random() * 360 });
    gsap.to(el, { x: Math.cos(a) * d, y: Math.sin(a) * d + 120, rotate: '+=' + (180 + Math.random() * 360), opacity: 0, duration: 0.8 + Math.random() * 0.4, ease: 'power1.out', onComplete: () => el.remove() });
  }
}
