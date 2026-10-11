import { useLayoutEffect, useRef, type ReactNode } from 'react';
import type { CardDef } from '../../engine/types';
import { imageUrl } from '../imageFiles';
import { useImage } from '../imageLoader';

/**
 * アイテムの絵（v2.3）。public/cards/<id>.webp が置いてある時だけ、ふせんの中に出す。
 * 置いていない時は null（今までの ふせん のまま。無い絵を読みに行かない）
 */
export function itemArtUrl(def: CardDef): string | null {
  return def.kind === 'item' && def.image ? imageUrl(def.image) : null;
}

/**
 * ふせんの中の絵。白い所は乗算で ふせんの色になじませる。読めなかった時は何も出さない。
 * 絵は読み込み係（imageLoader）で読み、読み終わってから出す（v2.4。読んでいる間は同じ大きさの空き）
 */
export function ItemArt({ url, className }: { url: string; className?: string }) {
  const state = useImage(url);
  if (state === 'error') return null;
  return (
    <span className={`item-art ${className ?? ''}`} aria-hidden data-src={url}>
      {state === 'ok' && <img className="item-art__img" src={url} alt="" draggable={false} />}
    </span>
  );
}

/**
 * 決まった高さの中に収まるまで、文字を小さくする（最小 min px）。
 * 絵を入れて文字の場所がせまくなったふせん用（文字と絵が重ならず、切れないように）
 */
export function FitText({ children, className, min = 9 }: { children: ReactNode; className?: string; min?: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fit = () => {
      el.style.fontSize = '';
      let size = parseFloat(getComputedStyle(el).fontSize);
      while (el.scrollHeight > el.clientHeight + 1 && size > min) {
        size -= 0.5;
        el.style.fontSize = `${size}px`;
      }
    };
    fit();
    // 手書きの文字（Web フォント）が後から届くと大きさが変わるので、届いた時にも合わせ直す
    void document.fonts?.ready.then(fit);
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  });
  return (
    <span ref={ref} className={`fit-text ${className ?? ''}`}>
      {children}
    </span>
  );
}
