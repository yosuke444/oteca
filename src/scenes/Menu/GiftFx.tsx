import { gsap } from 'gsap';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { audio } from '../../audio/audioManager';
import { PACK_DATA, packName } from '../../data/packs';
import { useFx } from '../../fx/fxSettings';
import { bigText, confetti, confettiRain, fireworks, flash, radialLines } from '../../fx/paperFx';
import { play, wait } from '../../fx/timing';
import { giftKind } from '../../gift/gifts';
import { useLang, useT } from '../../i18n/useT';
import { PackArt } from '../Gacha/PackArt';

/**
 * 贈り物が届いた（v2.7。SPEC §7 S20）：トロフィあげ以外（大会パックなど）。
 * 大会パック（arrival: taikai）：「たいかいの さんかしょう」のはんこ → 大会パックが1つずつ（数だけ）飛んできて並ぶ → 紙吹雪 →
 * 「ガチャの がめんで あけられるよ」。ほかの種類も同じ形（はんこの文字は「プレゼントが とどいた！」）。
 * タップで飛ばせる（少し見せてから）。演出スピード・演出をへらす に従う。セーブは届いた時に入っている（演出の途中で書き換えない）
 */
export function GiftFx({ kind, count, onDone }: { kind: string; count: number; onDone: () => void }) {
  const tr = useT();
  const lang = useLang();
  const fx = useFx();
  const def = giftKind(kind);
  const pack = def?.type === 'pack' ? PACK_DATA.packs.find((p) => p.id === def.pack) : undefined;
  const title = def?.arrival === 'taikai' ? tr.gift.taikaiTitle : tr.gift.title;
  const note = pack ? tr.gift.packNote(packName(pack, lang), count) : tr.gift.note(count);
  /** 並べる袋の数（多い時は5つまで並べ、数は文字で） */
  const shown = Math.min(count, 5);
  const rootRef = useRef<HTMLDivElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  const packsRef = useRef<HTMLDivElement>(null);
  const noteRef = useRef<HTMLParagraphElement>(null);
  const [canSkip, setCanSkip] = useState(false);
  const done = useRef(false);
  const stopJingle = useRef<() => void>(() => {});
  const finish = () => {
    if (done.current) return;
    done.current = true;
    stopJingle.current();
    onDone();
  };
  // キーボードでも飛ばせる（Enter・スペース・Esc）
  useEffect(() => {
    if (!canSkip) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'Escape') {
        e.preventDefault();
        finish();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [canSkip]);

  useLayoutEffect(() => {
    let alive = true;
    const cleanups: (() => void)[] = [];
    const reduce = fx.reduceFx;
    const L = layerRef.current!;
    const run = async () => {
      stopJingle.current = audio.play('jingle_limited');
      gsap.set(noteRef.current, { opacity: 0 });
      const bags = Array.from(packsRef.current?.querySelectorAll<HTMLElement>('.gift-fx__pack') ?? []);
      gsap.set(bags, { opacity: 0 });
      await play(gsap.fromTo(rootRef.current, { opacity: 0 }, { opacity: 1, duration: 0.3 }));
      if (!alive) return;
      // はんこ「たいかいの さんかしょう」
      cleanups.push(bigText(L, { x: 640, y: 110 }, title, 'limited-stamp gift-fx__stamp', -5));
      if (!reduce) flash(L, 0.8, 0.4);
      await wait(500);
      // 袋が1つずつ、右上から くるっと回って飛んでくる
      for (const [i, el] of bags.entries()) {
        if (!alive) return;
        audio.play('se_card_place');
        await play(
          gsap.fromTo(
            el,
            { x: 520 - i * 40, y: -420, rotate: reduce ? 0 : 200, scale: 0.4, opacity: 0 },
            { x: 0, y: 0, rotate: (i - (bags.length - 1) / 2) * 6, scale: 1, opacity: 1, duration: reduce ? 0.2 : 0.55, ease: 'back.out(1.6)' },
          ),
        );
        if (!reduce) confetti(L, centerOf(el, rootRef.current!), 16, 0.5);
      }
      if (!alive) return;
      setCanSkip(true);
      if (!reduce) {
        cleanups.push(
          radialLines(L, { x: 640, y: 340 }, {
            colors: ['var(--pen-blue)', 'var(--super-gold)', 'var(--pen-sky)', 'var(--pen-red)', 'var(--pen-green)'],
            lines: 36,
            width: 16,
            inner: 230,
            seconds: 0.6,
          }),
        );
        confettiRain(L, 80);
        fireworks(L, { x: 260, y: 230 }, 3);
        fireworks(L, { x: 1020, y: 230 }, 3);
      }
      await play(gsap.fromTo(noteRef.current, { opacity: 0, y: 20 }, { opacity: 1, y: 0, duration: 0.3 }));
      if (!alive) return;
      await wait(2200);
      if (!alive) return;
      await play(gsap.to(rootRef.current, { opacity: 0, duration: 0.3 }));
      if (alive) finish();
    };
    void run();
    return () => {
      alive = false;
      stopJingle.current();
      for (const c of cleanups) c();
    };
  }, []);

  return (
    <div className="limited-fx gift-fx" ref={rootRef} data-testid="gift-fx" onClick={() => canSkip && finish()}>
      <div className="limited-fx__glow gift-fx__glow" aria-hidden />
      <div className="gift-fx__packs" ref={packsRef}>
        {Array.from({ length: shown }, (_, i) => (
          <div key={i} className="gift-fx__pack">
            {pack ? <PackArt pack={pack} /> : <span className="gift-fx__box">{tr.gift.boxMark}</span>}
          </div>
        ))}
      </div>
      {count > shown && <p className="gift-fx__more num">{tr.gift.times(count)}</p>}
      <p className="limited-fx__note" ref={noteRef} data-testid="gift-fx-note">
        {note}
      </p>
      <div className="limited-fx__layer" ref={layerRef} aria-hidden />
      {canSkip && <p className="limited-fx__skip pencil">{tr.story.tapSkip}</p>}
    </div>
  );
}

/** 要素のまんなか（演出の層の座標。舞台 1280×720） */
function centerOf(el: HTMLElement, root: HTMLElement): { x: number; y: number } {
  const a = el.getBoundingClientRect();
  const b = root.getBoundingClientRect();
  const k = b.width ? 1280 / b.width : 1;
  return { x: (a.left - b.left + a.width / 2) * k, y: (a.top - b.top + a.height / 2) * k };
}
