import { gsap } from 'gsap';
import type { FxEnv } from './env';
import { type Box, type Point, STAGE_CENTER, boxOf, centerOf, rand, spawn, spawnSvg } from './overlay';
import { play, wait } from './timing';

/**
 * 演出の共通パーツ（SPEC §9-1）
 * - 時間はすべて「ふつう速度」で書く。GSAP 全体の速さを演出スピードに合わせているので、自動で短くなる（§9-4）
 * - 「演出をへらす」の時は、画面揺れ・フラッシュ・集中線・粒子を出さない。数字とHPバーの変化は残す
 */

// ---------------------------------------------------------------- ペン描き・蛍光ペン

/** SVG の線を書き順どおりに描く（stroke-dashoffset） */
export async function drawPaths(paths: SVGPathElement[] | NodeListOf<SVGGeometryElement>, seconds: number, stagger = 0): Promise<void> {
  const list = [...paths] as SVGGeometryElement[];
  for (const p of list) {
    const len = p.getTotalLength();
    p.style.strokeDasharray = `${len}`;
    p.style.strokeDashoffset = `${len}`;
  }
  await play(gsap.to(list, { strokeDashoffset: 0, duration: seconds, stagger, ease: 'power1.inOut' }));
}

/**
 * 文字をペンで書いていく（左から右へ少しずつ見えていく＋ペン先の点）
 * @returns 書いた文字の要素（消すのは呼んだ側）
 */
export async function penWrite(env: FxEnv, at: Point, html: string, cls: string, seconds = 0.5): Promise<HTMLElement> {
  const el = spawn(env, `fx-write ${cls}`, at, `<span class="fx-write__text">${html}</span>`);
  const tip = document.createElement('span');
  tip.className = 'fx-write__tip';
  el.appendChild(tip);
  env.sound('se_pen');
  gsap.set(el, { rotate: rand(-3, 3) });
  await play(
    gsap
      .timeline()
      .fromTo(el.firstElementChild, { clipPath: 'inset(-20% 100% -20% 0)' }, { clipPath: 'inset(-20% 0% -20% 0)', duration: seconds, ease: 'none' })
      .fromTo(tip, { left: '0%', opacity: 1 }, { left: '100%', duration: seconds, ease: 'none' }, 0)
      .to(tip, { opacity: 0, duration: 0.1 }),
  );
  tip.remove();
  return el;
}

/** 蛍光ペン：半透明の太線が左から右へ引かれる */
export async function marker(env: FxEnv, box: Box, color = 'var(--marker-yellow)', seconds = 0.3): Promise<HTMLElement> {
  const el = spawn(env, 'fx-marker', { x: box.x, y: box.y });
  Object.assign(el.style, { width: `${box.w}px`, height: `${box.h}px`, background: color, translate: '0 0' });
  await play(gsap.fromTo(el, { scaleX: 0 }, { scaleX: 1, transformOrigin: 'left center', duration: seconds, ease: 'power2.out' }));
  return el;
}

/** 定規で引いたような二重下線 */
export async function rulerUnderline(env: FxEnv, box: Box, color = 'var(--pen-blue)', seconds = 0.35): Promise<SVGSVGElement> {
  const y1 = box.y + box.h + 4;
  const y2 = y1 + 7;
  const svg = spawnSvg(
    env,
    'fx-ruler',
    `<path d="M${box.x - 6} ${y1} L${box.x + box.w + 8} ${y1 - 1}" stroke="${color}" stroke-width="3.2" fill="none" stroke-linecap="round"/>
     <path d="M${box.x} ${y2} L${box.x + box.w + 2} ${y2 + 1}" stroke="${color}" stroke-width="2.6" fill="none" stroke-linecap="round"/>`,
  );
  await drawPaths(svg.querySelectorAll('path'), seconds / 2, seconds / 2);
  return svg;
}

// ---------------------------------------------------------------- 集中線・速度線

/** 集中線：画面の中心へ向かうペンの線を放射状に描く（「演出をへらす」では出さない） */
export function focusLines(env: FxEnv, center: Point = STAGE_CENTER, seconds = 0.6, color = 'var(--ink)'): Promise<void> {
  if (env.reduce()) return Promise.resolve();
  const lines: string[] = [];
  const n = 46;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rand(-0.04, 0.04);
    const r0 = rand(250, 340);
    const r1 = 900;
    const w = rand(1.5, 5);
    const x0 = center.x + Math.cos(a) * r0;
    const y0 = center.y + Math.sin(a) * r0;
    const x1 = center.x + Math.cos(a) * r1;
    const y1 = center.y + Math.sin(a) * r1;
    // 先が細い三角形
    const nx = -Math.sin(a) * w;
    const ny = Math.cos(a) * w;
    lines.push(`<path d="M${x0} ${y0} L${x1 + nx} ${y1 + ny} L${x1 - nx} ${y1 - ny} Z" fill="${color}"/>`);
  }
  const svg = spawnSvg(env, 'fx-focus', lines.join(''));
  return play(
    gsap
      .timeline({ onComplete: () => svg.remove() })
      .fromTo(svg, { opacity: 0, scale: 1.15, transformOrigin: `${center.x}px ${center.y}px` }, { opacity: 0.85, scale: 1, duration: 0.12 })
      .to(svg, { opacity: 0, duration: seconds * 0.5 }, seconds * 0.5),
  );
}

/** 速度線：動いた向きの後ろに引く線 */
export function speedLines(env: FxEnv, from: Point, to: Point): void {
  if (env.reduce()) return;
  const a = Math.atan2(to.y - from.y, to.x - from.x);
  const nx = -Math.sin(a);
  const ny = Math.cos(a);
  const paths: string[] = [];
  for (let i = -3; i <= 3; i++) {
    const off = i * 14 + rand(-4, 4);
    const len = rand(80, 160);
    const sx = to.x - Math.cos(a) * rand(30, 60) + nx * off;
    const sy = to.y - Math.sin(a) * rand(30, 60) + ny * off;
    paths.push(`<path d="M${sx} ${sy} L${sx - Math.cos(a) * len} ${sy - Math.sin(a) * len}" stroke="var(--ink)" stroke-width="${rand(1.5, 3)}" stroke-linecap="round"/>`);
  }
  const svg = spawnSvg(env, 'fx-speed', paths.join(''));
  gsap.fromTo(svg, { opacity: 0.9 }, { opacity: 0, duration: 0.35, delay: 0.1, onComplete: () => svg.remove() });
}

// ---------------------------------------------------------------- 擬音・はんこ・文字

/** 擬音文字（太いペン文字＋黒フチ、ランダムに傾く） */
export function onomatopoeia(env: FxEnv, at: Point, text: string, big = false): Promise<void> {
  const el = spawn(env, `fx-onom ${big ? 'fx-onom--big' : ''}`, { x: at.x + rand(-30, 30), y: at.y + rand(-50, -20) }, text);
  const rot = rand(-16, 16);
  return play(
    gsap
      .timeline({ onComplete: () => el.remove() })
      .fromTo(el, { scale: 0.2, rotate: rot - 20, opacity: 0 }, { scale: 1, rotate: rot, opacity: 1, duration: 0.16, ease: 'back.out(3)' })
      .to(el, { scale: 1.08, duration: 0.25, ease: 'sine.inOut', yoyo: true, repeat: 1 })
      .to(el, { opacity: 0, y: '-=20', duration: 0.25 }),
  );
}

/** はんこ（上から大きく押される） */
export async function stamp(env: FxEnv, at: Point, text: string, cls = '', keepMs = 500): Promise<void> {
  const el = spawn(env, `fx-stamp ${cls}`, at, text);
  const rot = rand(-14, -4);
  await play(gsap.fromTo(el, { scale: 2.6, rotate: rot - 10, opacity: 0 }, { scale: 1, rotate: rot, opacity: 1, duration: 0.2, ease: 'power4.in' }));
  env.sound('se_stamp');
  shake(env, false);
  inkBurst(env, at, ['var(--pen-red)'], 14, 0.6);
  await wait(keepMs);
  await play(gsap.to(el, { opacity: 0, scale: 1.1, duration: 0.25 }));
  el.remove();
}

/** 数字を書いて、赤ペンの爆発線で囲む（ダメージ） */
export async function burstNumber(env: FxEnv, at: Point, text: string, big: boolean): Promise<void> {
  const spikes: string[] = [];
  const n = big ? 16 : 12;
  const R = big ? 86 : 64;
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2;
    const a1 = ((i + 0.5) / n) * Math.PI * 2;
    const ro = R * rand(0.95, 1.25);
    const ri = R * 0.62;
    spikes.push(`${i === 0 ? 'M' : 'L'}${Math.cos(a0) * ro} ${Math.sin(a0) * ro} L${Math.cos(a1) * ri} ${Math.sin(a1) * ri}`);
  }
  const box = spawn(env, `fx-burst ${big ? 'fx-burst--big' : ''}`, at, `<svg viewBox="-${R * 1.4} -${R * 1.4} ${R * 2.8} ${R * 2.8}" width="${R * 2.8}" height="${R * 2.8}"><path d="${spikes.join(' ')} Z" fill="var(--paper)" stroke="var(--pen-red)" stroke-width="4" stroke-linejoin="round"/></svg><span class="fx-burst__num">${text}</span>`);
  const path = box.querySelector('path')!;
  gsap.set(box, { rotate: rand(-10, 10) });
  const num = box.querySelector('.fx-burst__num')!;
  await Promise.all([
    drawPaths([path as SVGPathElement], 0.22),
    play(gsap.fromTo(num, { clipPath: 'inset(0 100% 0 0)', scale: 1.4 }, { clipPath: 'inset(0 0% 0 0)', scale: 1, duration: 0.25, ease: 'none' })),
  ]);
  await wait(big ? 650 : 450);
  await play(gsap.to(box, { opacity: 0, y: '-=24', duration: 0.25 }));
  box.remove();
}

// ---------------------------------------------------------------- 揺れ・ヒットストップ・フラッシュ

/** 画面揺れ（小：6px 200ms／大：14px 400ms）。「演出をへらす」では揺らさない */
export function shake(env: FxEnv, big: boolean): Promise<void> {
  if (env.reduce()) return Promise.resolve();
  const amp = big ? 14 : 6;
  const total = big ? 0.4 : 0.2;
  const steps = big ? 10 : 6;
  const tl = gsap.timeline({ onComplete: () => gsap.set(env.root, { clearProps: 'x,y' }) });
  for (let i = 0; i < steps; i++) {
    const k = 1 - i / steps;
    tl.to(env.root, { x: rand(-amp, amp) * k, y: rand(-amp, amp) * k, duration: total / steps, ease: 'none' });
  }
  tl.to(env.root, { x: 0, y: 0, duration: 0.02 });
  return play(tl);
}

/** ヒットストップ：当たった瞬間に全体を止める（小：60ms／大：140ms） */
export function hitStop(env: FxEnv, big: boolean): Promise<void> {
  const ms = (big ? 140 : 60) / env.speed();
  gsap.globalTimeline.pause();
  env.particles?.pause(true);
  return new Promise((resolve) =>
    setTimeout(() => {
      gsap.globalTimeline.resume();
      env.particles?.pause(false);
      resolve();
    }, ms),
  );
}

/** 画面が一瞬白く光る（「演出をへらす」では出さない） */
export function flash(env: FxEnv, seconds = 0.35, peak = 0.85): Promise<void> {
  if (env.reduce()) return Promise.resolve();
  const el = spawn(env, 'fx-flash', { x: 0, y: 0 });
  return play(
    gsap
      .timeline({ onComplete: () => el.remove() })
      .fromTo(el, { opacity: 0 }, { opacity: peak, duration: seconds * 0.2 })
      .to(el, { opacity: 0, duration: seconds * 0.8 }),
  );
}

// ---------------------------------------------------------------- 粒子

/** インク飛び（ペン色の点と滴） */
export function inkBurst(env: FxEnv, at: Point, colors: string[], count = 24, power = 1): void {
  const p = env.reduce() ? null : env.particles;
  if (!p) return;
  p.burst({ kind: 'ink', x: at.x, y: at.y, count, colors, speed: [150 * power, 520 * power], size: [2, 6], life: [0.4, 0.9], gravity: 700 });
  p.burst({ kind: 'drop', x: at.x, y: at.y, count: Math.round(count / 2), colors, speed: [250 * power, 700 * power], size: [3, 7], life: [0.4, 0.8], gravity: 900 });
}

/** 紙吹雪（方眼紙の切れ端） */
export function confetti(env: FxEnv, count: number, from: Point = { x: 640, y: -20 }, spread = Math.PI / 3, angle = Math.PI / 2): void {
  const p = env.reduce() ? null : env.particles;
  if (!p) return;
  p.burst({
    kind: 'paper',
    x: from.x,
    y: from.y,
    count,
    colors: ['var(--marker-pink)', 'var(--marker-yellow)', 'var(--pen-blue)', 'var(--pen-green)', 'var(--pen-red)'],
    angle,
    spread,
    speed: [250, 700],
    size: [5, 10],
    life: [1.8, 3.2],
    gravity: 260,
    drag: 0.3,
    area: 120,
  });
}

/** 粒子を出す（「演出をへらす」では出さない） */
export function particles(env: FxEnv, o: Parameters<NonNullable<FxEnv['particles']>['burst']>[0]): void {
  if (env.reduce() || !env.particles) return;
  env.particles.burst(o);
}

// ---------------------------------------------------------------- 落書き

/** 小さな土ぼこりの落書き（着地の足もと） */
export function dust(env: FxEnv, at: Point, width = 120): void {
  const html = `<svg viewBox="-60 -24 120 36" width="${width}" height="${width * 0.3}"><g fill="none" stroke="var(--pencil)" stroke-width="2.4" stroke-linecap="round">
    <path d="M-50 6 q-8 -10 2 -16 q8 -6 14 2"/><path d="M50 6 q8 -10 -2 -16 q-8 -6 -14 2"/><path d="M-26 10 q-4 -8 4 -10"/><path d="M26 10 q4 -8 -4 -10"/></g></svg>`;
  const el = spawn(env, 'fx-dust', at, html);
  gsap
    .timeline({ onComplete: () => el.remove() })
    .fromTo(el, { scale: 0.4, opacity: 0 }, { scale: 1.1, opacity: 1, duration: 0.18, ease: 'power2.out' })
    .to(el, { opacity: 0, y: '-=10', duration: 0.35, delay: 0.15 });
  particles(env, { kind: 'dust', x: at.x, y: at.y, count: 8, colors: ['var(--pencil)'], angle: -Math.PI / 2, spread: Math.PI / 2, speed: [60, 160], size: [4, 8], life: [0.4, 0.7], gravity: 0, area: width / 3 });
}

/** マスキングテープを「ペタッ」と貼る */
export async function tape(env: FxEnv, card: Box): Promise<void> {
  const el = spawn(env, 'fx-tape', { x: card.x + card.w / 2, y: card.y + 2 });
  env.sound('se_tape');
  await play(gsap.fromTo(el, { scaleX: 0.2, scaleY: 1.6, rotate: rand(-10, 10), opacity: 0 }, { scaleX: 1, scaleY: 1, rotate: rand(-4, 4), opacity: 1, duration: 0.14, ease: 'back.out(2.5)' }));
  const label = spawn(env, 'fx-sfx-text', { x: card.x + card.w + 26, y: card.y + 6 }, 'ペタッ');
  gsap.fromTo(label, { scale: 0.4, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.12 });
  await wait(260);
  gsap.to([el, label], { opacity: 0, duration: 0.3, onComplete: () => (el.remove(), label.remove()) });
}

/** 交代の矢印の落書き「⇄」 */
export async function swapArrow(env: FxEnv, a: Point, b: Point): Promise<void> {
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const html = `<svg viewBox="0 0 120 70" width="120" height="70"><g fill="none" stroke="var(--pen-blue)" stroke-width="4" stroke-linecap="round" stroke-linejoin="round">
    <path d="M12 24 Q60 6 106 22"/><path d="M92 10 L107 22 L92 32"/><path d="M108 48 Q60 64 14 50"/><path d="M28 38 L13 50 L28 60"/></g></svg>`;
  const el = spawn(env, 'fx-arrow', mid, html);
  await drawPaths(el.querySelectorAll('path'), 0.3, 0.05);
  await wait(300);
  gsap.to(el, { opacity: 0, duration: 0.25, onComplete: () => el.remove() });
}

// ---------------------------------------------------------------- カードに重ねる

/** 被弾カードに赤い斜線ハッチングが一瞬かかる */
export function hatchFlash(env: FxEnv, card: Element | null, color = 'var(--pen-red)'): Promise<void> {
  const b = boxOf(env, card);
  if (!b) return Promise.resolve();
  const el = spawn(env, 'fx-hatch', { x: b.x, y: b.y });
  Object.assign(el.style, { width: `${b.w}px`, height: `${b.h}px`, translate: '0 0', color });
  return play(
    gsap
      .timeline({ onComplete: () => el.remove() })
      .fromTo(el, { opacity: 0 }, { opacity: 0.9, duration: 0.05 })
      .to(el, { opacity: 0, duration: 0.3, delay: 0.08 }),
  );
}

/**
 * HPバーの変化（§9-2）
 * ダメージ：減った分が赤いハッチングで残り、消しゴムで消されるように右から消える（消しかすが散る）
 * 回復：増えた分を緑ペンで左から塗り足す（ペン先が走る）
 * 表示は先に新しいHPになっている前提で、その上に「差の部分」を重ねて動かす。
 */
export async function hpBarChange(env: FxEnv, uid: string, before: number, after: number, max: number, mode: 'damage' | 'heal' | 'big', color?: string): Promise<void> {
  const bar = env.cardEl(uid)?.querySelector('.rough-hpbar');
  const b = boxOf(env, bar ?? null);
  if (!b || max <= 0 || before === after) return;
  // RoughHpBar の塗りは、SVG の中で x=4 から (幅-8) まで
  const svgW = (bar as SVGSVGElement).width.baseVal.value || b.w;
  const k = b.w / svgW;
  const inner = { x: b.x + 4 * k, w: (svgW - 8) * k };
  const x0 = inner.x + inner.w * Math.max(0, Math.min(1, Math.min(before, after) / max));
  const x1 = inner.x + inner.w * Math.max(0, Math.min(1, Math.max(before, after) / max));
  if (x1 - x0 < 1) return;
  const seg = spawn(env, `fx-hpseg ${mode === 'damage' ? 'fx-hpseg--lost' : 'fx-hpseg--gain'}`, { x: x0, y: b.y + 3 });
  Object.assign(seg.style, { width: `${x1 - x0}px`, height: `${b.h - 6}px`, translate: '0 0' });
  if (color) seg.style.color = color;
  if (mode === 'damage') {
    const eraser = spawn(env, 'fx-eraser', { x: x1, y: b.y + b.h / 2 });
    const tl = gsap.timeline({ onComplete: () => (seg.remove(), eraser.remove()) });
    tl.to({}, { duration: 0.12 });
    tl.to(seg, { clipPath: 'inset(0 100% 0 0)', duration: 0.45, ease: 'power1.inOut' });
    tl.fromTo(eraser, { left: x1, rotate: -20 }, { left: x0, rotate: 10, duration: 0.45, ease: 'power1.inOut' }, '<');
    tl.to(eraser, { opacity: 0, duration: 0.15 });
    particles(env, { kind: 'crumb', x: (x0 + x1) / 2, y: b.y + b.h, count: 10, colors: ['#e7b8b8', '#c9c9c9'], angle: Math.PI / 2, spread: Math.PI / 3, speed: [40, 140], size: [1.5, 3], life: [0.5, 0.9], gravity: 500, area: (x1 - x0) / 2 });
    await play(tl);
  } else {
    const pen = spawn(env, 'fx-pentip', { x: x0, y: b.y + b.h / 2 });
    const tl = gsap.timeline({ onComplete: () => (seg.remove(), pen.remove()) });
    tl.fromTo(seg, { clipPath: 'inset(0 100% 0 0)' }, { clipPath: 'inset(0 0% 0 0)', duration: mode === 'big' ? 0.7 : 0.45, ease: 'power1.inOut' });
    tl.fromTo(pen, { left: x0 }, { left: x1, duration: mode === 'big' ? 0.7 : 0.45, ease: 'power1.inOut' }, '<');
    tl.to([seg, pen], { opacity: 0, duration: 0.2 });
    await play(tl);
  }
}

/** カードの中心 */
export function cardCenter(env: FxEnv, uid: string): Point {
  return centerOf(env, env.cardEl(uid)) ?? STAGE_CENTER;
}
