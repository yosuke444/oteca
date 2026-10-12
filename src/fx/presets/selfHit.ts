import { gsap } from 'gsap';
import type { GameEvent } from '../../engine/types';
import type { FxEnv } from '../env';
import { type Box, type Point, STAGE_CENTER, boxOf, rand, spawn } from '../overlay';
import { flash, focusLines, hatchFlash, inkBurst, onomatopoeia, particles, shake } from '../parts';
import { play, wait } from '../timing';
import { t } from '../../i18n';

/**
 * 自爆（技の「自分に○○」）の専用の動き（v2.6）。相手から攻撃を受けた時の動きとは別にする。
 * 自分のカードがオレンジ色に光る → 反動で後ろ（相手と反対の方）にはじかれる → カードのふちからインクと紙の破片が飛び散る
 * →（damageAfter）ダメージの数字。
 * 自分に999（たからばこ・ほそあげ など）は、さらに大きな爆発と煙。
 * 「演出をへらす」の時は、オレンジに光って数字が出るだけ。
 */

type Damaged = Extract<GameEvent, { type: 'Damaged' }>;

/** 大きな自爆か（自分に999 など） */
export const isBigSelfHit = (e: Damaged) => e.amount >= 999;

/** カードのふち（周り）から外へ、インクと紙の破片を飛ばす */
function edgeShards(env: FxEnv, b: Box, power: number): void {
  const cx = b.x + b.w / 2;
  const cy = b.y + b.h / 2;
  const n = 12;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    // カードの四角のふちの上の点
    const k = Math.min(b.w / 2 / Math.abs(Math.cos(a) || 1e-6), b.h / 2 / Math.abs(Math.sin(a) || 1e-6));
    const at = { x: cx + Math.cos(a) * k, y: cy + Math.sin(a) * k };
    particles(env, { kind: 'paper', x: at.x, y: at.y, count: Math.round(3 * power), colors: ['var(--paper)', 'var(--pencil)', 'var(--fx-self-orange)'], angle: a, spread: 0.6, speed: [160 * power, 420 * power], size: [4, 9], life: [0.5, 1.0], gravity: 500, area: 8 });
    particles(env, { kind: 'ink', x: at.x, y: at.y, count: Math.round(3 * power), colors: ['var(--ink)', 'var(--fx-self-orange)'], angle: a, spread: 0.5, speed: [200 * power, 520 * power], size: [2, 6], life: [0.4, 0.8], gravity: 700, area: 6 });
  }
}

/** オレンジの光（カードの後ろから広がる） */
function orangeGlow(env: FxEnv, b: Box, scale: number): HTMLElement {
  const glow = spawn(env, 'fx-self-glow', { x: b.x + b.w / 2, y: b.y + b.h / 2 });
  Object.assign(glow.style, { width: `${b.w * 1.5}px`, height: `${b.h * 1.4}px` });
  gsap.fromTo(glow, { scale: 0.5, opacity: 0 }, { scale, opacity: 1, duration: 0.14, ease: 'power2.out' });
  return glow;
}

export async function selfHitBefore(env: FxEnv, e: Damaged, finalBlow = false): Promise<void> {
  // 自爆で決着する時も、最後の一撃はスローモーション
  if (finalBlow) env.slowMo(0.4);
  const card = env.cardEl(e.uid);
  const b = boxOf(env, card);
  const big = isBigSelfHit(e);
  env.sound(big ? 'se_self_blast' : 'se_self_hit');
  if (!card || !b) return;
  const at: Point = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
  if (env.reduce()) {
    // オレンジに光るだけ
    await hatchFlash(env, card, 'var(--fx-self-orange)');
    return;
  }
  // 1. オレンジに光る（カードが少しふくらむ）
  const glow = orangeGlow(env, b, big ? 1.5 : 1.15);
  void hatchFlash(env, card, 'var(--fx-self-orange)');
  card.classList.add('is-self-hit');
  try {
    await selfHitMotion(env, card, b, at, big);
  } finally {
    // 途中で画面を離れても、光とオレンジのふちを残さない
    card.classList.remove('is-self-hit');
    gsap.to(glow, { opacity: 0, scale: big ? 2 : 1.4, duration: 0.3, onComplete: () => glow.remove() });
  }
  if (big) await wait(150);
}

async function selfHitMotion(env: FxEnv, card: HTMLElement, b: Box, at: Point, big: boolean): Promise<void> {
  await play(gsap.to(card, { scale: 1.06, duration: 0.12, ease: 'power2.out' }));
  // 2. 反動で後ろへはじかれる（画面の下の人は下へ、上の人は上へ）
  const back = Math.sign(at.y - STAGE_CENTER.y) || 1;
  if (big) {
    env.duckBgm();
    void flash(env, 0.4, 0.95);
    void shake(env, true);
    void focusLines(env, at, 0.8, 'var(--fx-self-orange)');
  } else {
    void shake(env, false);
  }
  edgeShards(env, b, big ? 2.2 : 1);
  inkBurst(env, at, ['var(--ink)', 'var(--fx-self-orange)'], big ? 50 : 22, big ? 1.5 : 1);
  if (big) {
    // 大きな爆発と煙
    for (let i = 0; i < 10; i++) {
      const puff = spawn(env, 'fx-lasting-smoke', { x: at.x + rand(-50, 50), y: at.y + rand(-60, 40) });
      gsap.fromTo(puff, { scale: 0.2, opacity: 1 }, { scale: rand(1.2, 2.2), x: rand(-110, 110), y: rand(-130, 20), opacity: 0, duration: rand(0.8, 1.3), ease: 'power2.out', onComplete: () => puff.remove() });
    }
    const ring = spawn(env, 'fx-self-ring', at);
    gsap.fromTo(ring, { scale: 0.2, opacity: 1 }, { scale: 3.2, opacity: 0, duration: 0.6, ease: 'power2.out', onComplete: () => ring.remove() });
    particles(env, { kind: 'spark', x: at.x, y: at.y, count: 36, colors: ['var(--fx-self-orange)', 'var(--marker-yellow)', 'var(--pen-red)'], speed: [250, 700], size: [4, 10], life: [0.5, 1.0], gravity: 250 });
  }
  void onomatopoeia(env, { x: at.x + (big ? 0 : 120), y: at.y - (big ? 40 : 10) }, big ? t().fx.selfBlast : t().fx.selfHit, big);
  await play(
    gsap
      .timeline()
      .to(card, { y: back * (big ? 46 : 30), rotate: back * (big ? -9 : -5), scale: 0.97, duration: 0.1, ease: 'power3.out' })
      .to(card, { y: 0, rotate: 0, scale: 1, duration: 0.45, ease: 'elastic.out(1.2, 0.4)', clearProps: 'y,rotate,scale' }),
  );


}
