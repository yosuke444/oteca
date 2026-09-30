import { gsap } from 'gsap';
import { useEffect, useRef } from 'react';
import { audio } from '../../audio/audioManager';

/**
 * 画面切り替え：ノートのページが右下からめくれる（SPEC §9-2、0.5秒＋紙の音）
 * 前の画面の見た目を写し取った「ページ」を上に重ね、右下の角からめくって、下の新しい画面を見せる。
 * めくれた部分は、ページの裏（無地の紙）として折り返して見せる。
 */

let starter: ((snapshot: Node | null) => void) | null = null;

/** 画面を切り替える直前に呼ぶ（いまの画面の見た目を写し取ってめくる） */
export function turnPage(stage: HTMLElement | null): void {
  if (!starter) return;
  const snap = stage ? (stage.cloneNode(true) as HTMLElement) : null;
  // 写しはアニメを止めるので、アニメの途中の見た目（線の描きかけ・うすさ・位置）を写しに書き込んでおく
  if (stage && snap) {
    const from = [stage, ...stage.querySelectorAll('*')];
    const to = [snap, ...snap.querySelectorAll('*')];
    from.forEach((el, i) => {
      if (!(el instanceof Element) || !el.getAnimations || el.getAnimations().length === 0) return;
      const cs = getComputedStyle(el);
      const st = (to[i] as HTMLElement | SVGElement).style;
      for (const p of ['opacity', 'transform', 'translate', 'rotate', 'scale', 'stroke-dashoffset', 'clip-path', 'background-size']) st.setProperty(p, cs.getPropertyValue(p));
    });
  }
  // 写しは動かない（押せない・アニメしない）
  snap?.querySelectorAll('canvas, video, audio').forEach((e) => e.remove());
  snap?.querySelectorAll('[data-testid],[id]').forEach((e) => {
    e.removeAttribute('data-testid');
    e.removeAttribute('id');
  });
  snap?.setAttribute('inert', '');
  starter(snap);
}

export function PageTurn() {
  const layerRef = useRef<HTMLDivElement>(null);
  const pageRef = useRef<HTMLDivElement>(null);
  const flapRef = useRef<HTMLDivElement>(null);
  const shadeRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let tl: gsap.core.Tween | null = null;
    starter = (snap) => {
      const layer = layerRef.current!;
      const page = pageRef.current!;
      const flap = flapRef.current!;
      const shade = shadeRef.current!;
      tl?.kill();
      page.replaceChildren();
      if (snap) page.appendChild(snap);
      layer.style.display = 'block';
      audio.play('se_page');
      const W = window.innerWidth;
      const H = window.innerHeight;
      const st = { c: W + H };
      const apply = () => {
        const c = st.c;
        // 折り目の線 x + y = c より左上がまだめくれていないページ
        const pts: [number, number][] = [];
        const corners: [number, number][] = [
          [0, 0],
          [W, 0],
          [W, H],
          [0, H],
        ];
        for (let i = 0; i < 4; i++) {
          const [x1, y1] = corners[i];
          const [x2, y2] = corners[(i + 1) % 4];
          const v1 = x1 + y1 - c;
          const v2 = x2 + y2 - c;
          if (v1 <= 0) pts.push([x1, y1]);
          if (v1 * v2 < 0) {
            const t = v1 / (v1 - v2);
            pts.push([x1 + (x2 - x1) * t, y1 + (y2 - y1) * t]);
          }
        }
        const poly = (list: [number, number][]) => (list.length >= 3 ? `polygon(${list.map(([x, y]) => `${x}px ${y}px`).join(',')})` : 'polygon(0 0,0 0,0 0)');
        page.style.clipPath = poly(pts);
        // めくれた角（右下）を折り目で折り返した形 ＝ ページの裏
        const turned: [number, number][] = [];
        for (let i = 0; i < 4; i++) {
          const [x1, y1] = corners[i];
          const [x2, y2] = corners[(i + 1) % 4];
          const v1 = x1 + y1 - c;
          const v2 = x2 + y2 - c;
          if (v1 >= 0) turned.push([x1, y1]);
          if (v1 * v2 < 0) {
            const t = v1 / (v1 - v2);
            turned.push([x1 + (x2 - x1) * t, y1 + (y2 - y1) * t]);
          }
        }
        const mirrored = turned.map(([x, y]) => [c - y, c - x] as [number, number]);
        flap.style.clipPath = poly(mirrored);
        shade.style.clipPath = poly(mirrored.map(([x, y]) => [x + 10, y + 10] as [number, number]));
      };
      apply();
      tl = gsap.to(st, {
        c: -Math.min(W, H) * 0.3,
        duration: 0.5,
        ease: 'power1.in',
        onUpdate: apply,
        onComplete: () => {
          layer.style.display = 'none';
          page.replaceChildren();
        },
      });
    };
    return () => {
      starter = null;
      tl?.kill();
    };
  }, []);

  return (
    <div className="pageturn" ref={layerRef} aria-hidden>
      <div className="pageturn__page" ref={pageRef} />
      <div className="pageturn__shade" ref={shadeRef} />
      <div className="pageturn__flap" ref={flapRef} />
    </div>
  );
}
