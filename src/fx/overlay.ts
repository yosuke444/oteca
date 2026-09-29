import type { FxEnv } from './env';

/**
 * 演出の層に、その場限りの要素を出す道具。
 * 座標はすべて舞台（1280×720）の座標。画面の拡大縮小はここで打ち消す。
 */

export type Point = { x: number; y: number };
export type Box = { x: number; y: number; w: number; h: number };

/** 舞台の拡大率 */
function stageScale(env: FxEnv): number {
  const r = env.overlay.getBoundingClientRect();
  return r.width / env.overlay.offsetWidth || 1;
}

/** 要素の位置（舞台の座標） */
export function boxOf(env: FxEnv, el: Element | null): Box | null {
  if (!el) return null;
  const o = env.overlay.getBoundingClientRect();
  const r = el.getBoundingClientRect();
  const s = stageScale(env);
  return { x: (r.left - o.left) / s, y: (r.top - o.top) / s, w: r.width / s, h: r.height / s };
}

export function centerOf(env: FxEnv, el: Element | null): Point | null {
  const b = boxOf(env, el);
  return b ? { x: b.x + b.w / 2, y: b.y + b.h / 2 } : null;
}

/** 舞台の中央 */
export const STAGE_CENTER: Point = { x: 640, y: 360 };

/** 演出の層に要素を足す（終わったら remove() する） */
export function spawn(env: FxEnv, className: string, at: Point, html = ''): HTMLElement {
  const el = document.createElement('div');
  el.className = `fx-el ${className}`;
  el.style.left = `${at.x}px`;
  el.style.top = `${at.y}px`;
  el.innerHTML = html;
  env.overlay.appendChild(el);
  return el;
}

/** SVG を足す（全面） */
export function spawnSvg(env: FxEnv, className: string, inner: string): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('class', `fx-svg ${className}`);
  svg.setAttribute('viewBox', '0 0 1280 720');
  svg.setAttribute('width', '1280');
  svg.setAttribute('height', '720');
  svg.innerHTML = inner;
  env.overlay.appendChild(svg);
  return svg;
}

/** 0〜1 の乱数（見た目のばらつき用。エンジンでは使わない） */
export function rand(min = 0, max = 1): number {
  return min + Math.random() * (max - min);
}
