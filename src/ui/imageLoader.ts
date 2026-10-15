import { useEffect, useSyncExternalStore } from 'react';
import { CARD_DB } from '../data/cards';
import type { CardDef } from '../engine/types';
import { imageUrl } from './imageFiles';

/**
 * 絵の読み込み係（v2.4。カードの絵が出るまでのラグをなくす）。カードの絵を出す部品（CardArt・ItemArt）は、すべてここを通す。
 * - Image に src を入れ、decode() が終わるまで待つ（描く時に止まらない）
 * - 読んだ絵はメモリに持ち、同じ絵を2回読まない（読んでいる途中にもう一度頼まれても、同じ読み込みを待つ）
 * - 失敗しても止まらない（「読めなかった」にして、部品は仮の絵を出す。次に頼まれた時に読み直す）
 */

export type ImageState = 'loading' | 'ok' | 'error';
/** 読む急ぎぐあい：high＝今すぐ出す絵（ガチャで当たったカードなど）、low＝空いた時間に先に読んでおく絵 */
export type ImagePriority = 'high' | 'low' | 'auto';

type Entry = { state: ImageState; done: Promise<boolean>; img: HTMLImageElement | null };

const entries = new Map<string, Entry>();
const listeners = new Map<string, Set<() => void>>();

function notify(url: string): void {
  for (const f of listeners.get(url) ?? []) f();
}

/** 絵を読む（読み終わる・失敗すると true／false）。もう読んである・読んでいる途中なら、それを待つだけ */
export function loadImage(url: string, priority: ImagePriority = 'auto'): Promise<boolean> {
  const cur = entries.get(url);
  if (cur && cur.state !== 'error') return cur.done;
  if (typeof Image === 'undefined') return Promise.resolve(false);
  const img = new Image();
  // 先に読んでおく時は、ほかの読み込み（画面に今いるもの）の邪魔をしない
  (img as HTMLImageElement & { fetchPriority?: string }).fetchPriority = priority;
  img.decoding = 'async';
  const entry: Entry = { state: 'loading', img, done: Promise.resolve(false) };
  entry.done = new Promise<boolean>((resolve) => {
    const finish = (ok: boolean) => {
      if (entry.state !== 'loading') return;
      entry.state = ok ? 'ok' : 'error';
      if (!ok) entry.img = null;
      notify(url);
      resolve(ok);
    };
    img.onerror = () => finish(false);
    img.src = url;
    // decode() が使えれば、絵をほどき終わるまで待つ（描く時にかくっとしない）。使えない・失敗した時は onload で
    if (typeof img.decode === 'function') {
      img.decode().then(
        () => finish(true),
        () => {
          if (img.complete && img.naturalWidth > 0) finish(true);
          else img.onload = () => finish(true);
        },
      );
    } else {
      img.onload = () => finish(true);
    }
  });
  entries.set(url, entry);
  notify(url);
  return entry.done;
}

/** 今の様子（まだ頼まれていなければ null） */
export function imageState(url: string): ImageState | null {
  return entries.get(url)?.state ?? null;
}

/** 読み終わっているか */
export function isImageReady(url: string | null): boolean {
  return !!url && entries.get(url)?.state === 'ok';
}

function subscribe(url: string, f: () => void): () => void {
  let set = listeners.get(url);
  if (!set) listeners.set(url, (set = new Set()));
  set.add(f);
  return () => {
    set.delete(f);
    if (!set.size) listeners.delete(url);
  };
}

/**
 * 部品から使う：絵の様子（読み終わったら ok）。まだなら読み始める。url が null なら null（絵が無い）
 */
export function useImage(url: string | null, priority: ImagePriority = 'high'): ImageState | null {
  const state = useSyncExternalStore(
    (f) => (url ? subscribe(url, f) : () => {}),
    () => (url ? (entries.get(url)?.state ?? 'loading') : null),
    () => (url ? 'loading' : null),
  );
  useEffect(() => {
    if (url && imageState(url) !== 'ok' && imageState(url) !== 'loading') void loadImage(url, priority);
  }, [url]);
  return state;
}

/** カードの絵の場所（置いてある絵だけ。トロフィーのカードも v2.7 から絵を読む） */
export function cardImageUrl(def: CardDef | undefined): string | null {
  if (!def?.image) return null;
  return imageUrl(def.image);
}

/** カードの絵を読み始める（カードが決まった時。ガチャ・デイリーパック・ストーリーの報酬・トレードで受け取った時など） */
export function preloadCards(nos: readonly number[], priority: ImagePriority = 'high'): Promise<boolean[]> {
  const urls = [...new Set(nos.map((no) => cardImageUrl(CARD_DB[no])).filter((u): u is string => !!u))];
  return Promise.all(urls.map((u) => loadImage(u, priority)));
}

/** カードの絵が読めるまで待つ（ms まで）。読めたら true、時間が来たら false（その後も読み続ける） */
export async function waitCardImages(nos: readonly number[], ms: number): Promise<boolean> {
  const all = preloadCards(nos).then((r) => r.every((x) => x));
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<false>((resolve) => {
    timer = setTimeout(() => resolve(false), ms);
  });
  const ok = await Promise.race([all, late]);
  clearTimeout(timer);
  return ok;
}

/** テスト用：覚えている絵を忘れる */
export function forgetImagesForTest(): void {
  entries.clear();
  listeners.clear();
}
