import { CARD_LIST } from '../data/cards';
import { cardImageUrl, isImageReady, loadImage } from './imageLoader';

/**
 * 全カードの絵を、空いている時間に1枚ずつ先に読んでおく（v2.4。カードの絵が出るまでのラグをなくす）。
 * - タイトルが出た後に始める（起動を遅くしない）
 * - 空いている時間（requestIdleCallback）に、低い優先度（fetchpriority="low"）で1枚ずつ
 * - 対戦中とガチャの演出中は止める（その間の通信・描くことの邪魔をしない）
 */

const pauses = new Set<string>();
let queue: string[] | null = null;
let running = false;
let timer: ReturnType<typeof setTimeout> | null = null;

type IdleWindow = Window & { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number };

function later(f: () => void, ms: number): void {
  if (timer !== null) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    const w = typeof window === 'undefined' ? null : (window as IdleWindow);
    if (w?.requestIdleCallback) w.requestIdleCallback(f, { timeout: 2000 });
    else f();
  }, ms);
}

async function step(): Promise<void> {
  if (!queue || running) return;
  if (pauses.size > 0) return; // 止めている間は、再開の時に続きから
  const url = queue.find((u) => !isImageReady(u));
  if (!url) {
    queue = [];
    return;
  }
  queue = queue.filter((u) => u !== url);
  running = true;
  await loadImage(url, 'low');
  running = false;
  later(() => void step(), 50);
}

/** 起動の読み込み（ページ・文字の形）が終わってから、少し待って始める（起動を遅くしない） */
const START_AFTER_MS = 1500;

/** 先読みを始める（タイトルが出た後に1回。2回目からは何もしない） */
export function startIdlePreload(): void {
  if (queue) return;
  const urls = CARD_LIST.map((c) => cardImageUrl(c)).filter((u): u is string => !!u);
  queue = [...new Set(urls)];
  if (typeof window === 'undefined') return;
  const loaded = new Promise<void>((resolve) => {
    if (document.readyState === 'complete') resolve();
    else window.addEventListener('load', () => resolve(), { once: true });
  });
  const fonts = document.fonts?.ready.then(() => undefined) ?? Promise.resolve();
  void Promise.all([loaded, fonts]).then(() => later(() => void step(), START_AFTER_MS));
}

/** 先読みを止める（理由ごと。対戦・ガチャの演出） */
export function pauseIdlePreload(reason: string): void {
  pauses.add(reason);
}

/** 止めたのを戻す（ほかの理由が残っていれば止めたまま） */
export function resumeIdlePreload(reason: string): void {
  if (!pauses.delete(reason) || pauses.size > 0) return;
  later(() => void step(), 300);
}

/** 先読みが止まっているか（テスト・確認用） */
export function idlePreloadPaused(): boolean {
  return pauses.size > 0;
}

/** まだ読んでいない絵の数（テスト・確認用） */
export function idlePreloadLeft(): number {
  return queue ? queue.filter((u) => !isImageReady(u)).length : -1;
}
