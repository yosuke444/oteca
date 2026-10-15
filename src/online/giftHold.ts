import { useEffect } from 'react';

/**
 * トロフィあげが届いた演出を「今は出さない」印（v2.7。SPEC §7 S20）。
 * ガチャの演出中・トレードの途中・ストーリーの限定カードの演出中などに立て、終わったら下ろす。下りた直後に演出を出す。
 * 対戦中など画面ごとに出さないものは GiftArrival の HOLD_ROUTES で決める
 */

const holds = new Set<string>();
const listeners = new Set<() => void>();

export function setGiftHold(key: string, on: boolean): void {
  const had = holds.has(key);
  if (on) holds.add(key);
  else holds.delete(key);
  if (had !== on) for (const fn of listeners) fn();
}

export function giftHeld(): boolean {
  return holds.size > 0;
}

export function onGiftHold(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** 画面の中で使う：on の間だけ印を立てる */
export function useGiftHold(key: string, on: boolean): void {
  useEffect(() => {
    if (!on) return;
    setGiftHold(key, true);
    return () => setGiftHold(key, false);
  }, [key, on]);
}
