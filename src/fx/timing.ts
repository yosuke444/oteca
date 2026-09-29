import { gsap } from 'gsap';

/**
 * 演出の時間。GSAP 全体の時間の速さを演出スピードに合わせるので、
 * ここで待つ時間も、GSAP のアニメも、すべて fxSpeed で割られる（SPEC §9-4）。
 */
export function setFxSpeed(speed: number, slowMo = 1): void {
  gsap.globalTimeline.timeScale(speed * slowMo);
}

/** ふつう速度で ms 待つ（演出スピードに従って短くなる） */
export function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    gsap.delayedCall(ms / 1000, resolve);
  });
}

/** GSAP のアニメが終わるまで待つ（アニメ自身の onComplete も呼ぶ） */
export function play(tween: gsap.core.Animation): Promise<void> {
  return new Promise((resolve) => {
    const own = tween.eventCallback('onComplete') as ((...a: unknown[]) => void) | null;
    tween.eventCallback('onComplete', () => {
      own?.();
      resolve();
    });
  });
}
