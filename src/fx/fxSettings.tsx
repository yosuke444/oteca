import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react';
import { setFxSpeed } from './timing';

/**
 * 演出の設定（SPEC §9-4）
 * - fxSpeed：全演出の時間をこの値で割る（ふつう1.0／はやい1.6／さいそく2.5）
 * - reduceFx：画面揺れ・フラッシュ・集中線・粒子を止める
 * 値はセーブデータの settings から受け取る（変更は設定画面からセーブ経由で行う）。
 * CSS からは --fx-speed と html[data-reduce-fx] で参照できる。
 */

export const FX_SPEEDS = [1, 1.6, 2.5] as const;
export type FxSpeedIndex = 0 | 1 | 2;

export type FxSettings = {
  fxSpeed: FxSpeedIndex;
  reduceFx: boolean;
};

type FxContextValue = FxSettings & {
  /** 倍率（1 / 1.6 / 2.5） */
  speed: number;
  /** ふつう速度の ms → 今の設定での ms */
  dur: (ms: number) => number;
};

/** OSの「視差効果を減らす」がONなら、演出をへらすの初期値をONにする */
export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

const FxContext = createContext<FxContextValue | null>(null);

export function FxSettingsProvider({ fxSpeed, reduceFx, children }: FxSettings & { children: ReactNode }) {
  const value = useMemo<FxContextValue>(() => {
    const speed = FX_SPEEDS[fxSpeed];
    return { fxSpeed, reduceFx, speed, dur: (ms) => ms / speed };
  }, [fxSpeed, reduceFx]);

  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty('--fx-speed', String(value.speed));
    // GSAP の演出も、どの画面でも演出スピードで短くなるように
    setFxSpeed(value.speed);
    if (value.reduceFx) root.setAttribute('data-reduce-fx', '');
    else root.removeAttribute('data-reduce-fx');
  }, [value.speed, value.reduceFx]);

  return <FxContext.Provider value={value}>{children}</FxContext.Provider>;
}

export function useFx(): FxContextValue {
  const ctx = useContext(FxContext);
  if (!ctx) throw new Error('FxSettingsProvider の外で useFx は使えません');
  return ctx;
}
