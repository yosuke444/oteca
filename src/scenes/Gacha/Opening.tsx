import { gsap } from 'gsap';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { audio } from '../../audio/audioManager';
import { CARD_DB } from '../../data/cards';
import type { PackDef } from '../../data/packs';
import { useFx } from '../../fx/fxSettings';
import { bigText, centerIn, confetti, confettiRain, fireworks, flash, paperScraps, radialLines, shake } from '../../fx/paperFx';
import { play, wait } from '../../fx/timing';
import type { Bag, PullResult } from '../../gacha/gacha';
import { useT } from '../../i18n/useT';
import { CardBack } from '../../ui/card/CardBack';
import { CardMini } from '../../ui/card/CardMini';
import { RoughButton } from '../../ui/rough/RoughButton';
import { PackArt } from './PackArt';

/**
 * 袋を開ける（SPEC §7 S09「演出」）。
 * 3まい：袋が3つ机の上に滑ってくる。15まい：5×3に並ぶ。1つずつタップ（横になぞって破る）か「ぜんぶ あける」。
 * どの段階でも「スキップ」でまとめ画面へ。演出スピード・演出をへらす に従う。
 */
export function Opening({ pack, bags, results, onDone }: { pack: PackDef; bags: Bag[]; results: PullResult[]; onDone: () => void }) {
  const tr = useT();
  const fx = useFx();
  const [opened, setOpened] = useState<boolean[]>(() => bags.map(() => false));
  const [reveal, setReveal] = useState<number | null>(null);
  const [auto, setAuto] = useState(false);
  const busy = useRef(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  const bagRefs = useRef<(HTMLDivElement | null)[]>([]);
  const alive = useRef(true);
  const many = bags.length > 3;

  // 袋ごとの結果（results は袋の順に、中のカードの順で並んでいる）
  const perBag: PullResult[][] = [];
  let k = 0;
  for (const b of bags) {
    perBag.push(results.slice(k, k + b.cards.length));
    k += b.cards.length;
  }

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  // 袋が机の上に滑ってくる（15まいは5×3に並ぶ）
  useLayoutEffect(() => {
    const els = bagRefs.current.filter((e): e is HTMLDivElement => !!e);
    audio.play('se_card_place');
    gsap.fromTo(els, { x: 900, rotate: 25, opacity: 0 }, { x: 0, rotate: 0, opacity: 1, duration: fx.reduceFx ? 0.2 : 0.55, stagger: many ? 0.04 : 0.12, ease: 'power3.out', clearProps: 'transform,opacity' });
    // スーパーレアの袋は、開ける前から光って震える
    if (bags.some((b) => b.cards.some((c) => c.super))) window.setTimeout(() => alive.current && audio.play('se_super_shine'), fx.dur(500));
  }, []);

  /** i 番目の袋を開ける（破る → カードがめくれる → 演出） */
  const open = async (i: number) => {
    if (busy.current || opened[i]) return;
    busy.current = true;
    const el = bagRefs.current[i];
    const layer = layerRef.current;
    const reduce = fx.reduceFx;
    if (el && layer) {
      // ダブル：開ける前に、袋がぱんぱんに膨らんで2回跳ねる（予告）
      if (bags[i].double && !reduce) {
        await play(gsap.to(el, { scaleX: 1.25, scaleY: 1.12, duration: 0.18, ease: 'power2.out' }));
        if (!alive.current) return;
        await play(gsap.to(el, { y: -40, duration: 0.16, ease: 'power2.out', yoyo: true, repeat: 1 }));
        if (!alive.current) return;
        await play(gsap.to(el, { y: -40, duration: 0.16, ease: 'power2.out', yoyo: true, repeat: 1 }));
        if (!alive.current) return;
      }
      // 点線に沿って破れる：上の切れ端が飛び、紙くずが飛ぶ
      audio.play('se_bag_tear');
      const at = centerIn(layer, el);
      const r = el.getBoundingClientRect();
      const lr = layer.getBoundingClientRect();
      const s = lr.width / (layer.offsetWidth || 1);
      const strip = document.createElement('div');
      strip.className = `gacha-strip gacha-strip--${pack.color}`;
      layer.appendChild(strip);
      gsap.set(strip, { left: (r.left - lr.left) / s, top: (r.top - lr.top) / s, width: r.width / s, height: (r.height / s) * 0.16 });
      el.classList.add('is-torn');
      if (!reduce) paperScraps(layer, { x: at.x, y: at.y - (r.height / s) * 0.4 }, 12);
      await play(gsap.to(strip, { x: 120, y: -90, rotate: 40, opacity: 0, duration: reduce ? 0.15 : 0.45, ease: 'power2.out', onComplete: () => strip.remove() }));
      gsap.to(el, { scaleX: 1, scaleY: 1, y: 0, duration: 0.15 });
    }
    if (!alive.current) return;
    setReveal(i);
  };

  /** めくり終わって閉じた */
  const closeReveal = (i: number) => {
    setReveal(null);
    setOpened((o) => o.map((v, j) => (j === i ? true : v)));
    busy.current = false;
  };

  // ぜんぶ あける：残りを順番に自動で開ける
  useEffect(() => {
    if (!auto || reveal !== null || busy.current) return;
    const next = opened.findIndex((v) => !v);
    if (next < 0) return;
    const id = window.setTimeout(() => void open(next), fx.dur(250));
    return () => window.clearTimeout(id);
  }, [auto, reveal, opened]);

  const allOpened = opened.every((v) => v);

  return (
    <div className="gacha-open" ref={rootRef} data-testid="gacha-opening">
      <div className={`gacha-open__bags ${many ? 'gacha-open__bags--many' : ''}`}>
        {bags.map((b, i) => (
          <BagButton
            key={i}
            index={i}
            pack={pack}
            bag={b}
            opened={opened[i]}
            result={perBag[i]}
            refCb={(e) => (bagRefs.current[i] = e)}
            onOpen={() => void open(i)}
          />
        ))}
      </div>
      <p className="gacha-open__hint pencil">{tr.gacha.hint}</p>
      <div className="gacha-open__buttons">
        {!allOpened && (
          <RoughButton seed="gacha-openall" className="gacha-open__btn" highlight={!auto} disabled={auto} onClick={() => setAuto(true)}>
            {tr.gacha.openAll}
          </RoughButton>
        )}
        {allOpened ? (
          <RoughButton seed="gacha-summary" className="gacha-open__btn" highlight onClick={onDone}>
            {tr.gacha.toSummary}
          </RoughButton>
        ) : (
          <RoughButton seed="gacha-skip" className="gacha-open__btn gacha-open__btn--skip" onClick={onDone}>
            {tr.gacha.skip}
          </RoughButton>
        )}
      </div>
      {reveal !== null && (
        <Reveal
          key={reveal}
          results={perBag[reveal]}
          double={bags[reveal].double}
          root={rootRef}
          layer={layerRef}
          auto={auto}
          onClose={() => closeReveal(reveal)}
          onSkip={onDone}
        />
      )}
      <div className="gacha-open__layer" ref={layerRef} aria-hidden />
    </div>
  );
}

/** 1つの袋（タップでも、横になぞっても開く） */
function BagButton({ index, pack, bag, opened, result, refCb, onOpen }: { index: number; pack: PackDef; bag: Bag; opened: boolean; result: PullResult[]; refCb: (e: HTMLDivElement | null) => void; onOpen: () => void }) {
  const tr = useT();
  const start = useRef<number | null>(null);
  const sr = bag.cards.some((c) => c.super);
  return (
    // 開けた袋の中に CardMini（ボタン）を出すので、袋は button ではなく role="button" の div にする
    <div
      ref={refCb}
      role={opened ? undefined : 'button'}
      tabIndex={opened ? undefined : 0}
      onKeyDown={(e) => {
        if (!opened && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          onOpen();
        }
      }}
      className={`gacha-bag ${sr && !opened ? 'is-super' : ''} ${bag.double && !opened ? 'is-double' : ''} ${opened ? 'is-opened' : ''}`}
      aria-label={opened ? undefined : tr.gacha.bagAria(index + 1)}
      data-testid={`gacha-bag-${index}`}
      onPointerDown={(e) => {
        start.current = e.clientX;
      }}
      onPointerMove={(e) => {
        // 横になぞると破れる
        if (start.current !== null && Math.abs(e.clientX - start.current) > 40) {
          start.current = null;
          onOpen();
        }
      }}
      onPointerUp={() => {
        start.current = null;
      }}
      onClick={() => !opened && onOpen()}
    >
      {opened ? (
        <span className="gacha-bag__got">
          {result.map((r, j) => (
            <CardMini key={j} def={CARD_DB[r.no]} seed={`bag-got-${index}-${j}`} variant="slot" />
          ))}
        </span>
      ) : (
        <PackArt pack={pack} small />
      )}
      {sr && !opened && <span className="gacha-bag__leak" aria-hidden />}
    </div>
  );
}

/**
 * めくる演出。ノーマル：集中線＋「ぺらっ」。スーパーレア：フラッシュ・虹色の線・回転しながら大きく・星と紙吹雪・はんこ・画面揺れ。
 * ダブル：特大の「ダブル！！」・2枚が左右に分かれて同時にめくれる・紙吹雪と花火。2枚目がスーパーレアならスーパーレアの演出を重ねる
 */
function Reveal({
  results,
  double,
  root,
  layer,
  auto,
  onClose,
  onSkip,
}: {
  results: PullResult[];
  double: boolean;
  root: React.RefObject<HTMLDivElement | null>;
  layer: React.RefObject<HTMLDivElement | null>;
  auto: boolean;
  onClose: () => void;
  onSkip: () => void;
}) {
  const tr = useT();
  const fx = useFx();
  const [done, setDone] = useState(false);
  const cardRefs = useRef<(HTMLDivElement | null)[]>([]);
  const backRefs = useRef<(HTMLDivElement | null)[]>([]);
  const frontRefs = useRef<(HTMLDivElement | null)[]>([]);
  const cleanups = useRef<(() => void)[]>([]);
  const alive = useRef(true);

  useLayoutEffect(() => {
    alive.current = true;
    const L = layer.current;
    const reduce = fx.reduceFx;
    const sr = results.some((r) => r.super);
    const center = { x: 640, y: 330 };
    const run = async () => {
      const cards = cardRefs.current.filter((e): e is HTMLDivElement => !!e);
      const backs = backRefs.current.filter((e): e is HTMLDivElement => !!e);
      const fronts = frontRefs.current.filter((e): e is HTMLDivElement => !!e);
      gsap.set(fronts, { scaleX: 0 });
      // 裏向きのカードが袋から出てくる
      const gone = () => !alive.current;
      await play(gsap.fromTo(cards, { y: 260, scale: 0.5, opacity: 0 }, { y: 0, scale: 1, opacity: 1, duration: 0.3, ease: 'back.out(1.6)' }));
      if (gone()) return;
      if (double) {
        // ダブル：特大の「ダブル！！」（蛍光ペン2色）→ 2枚が左右に分かれる
        audio.play('jingle_double');
        if (L) cleanups.current.push(bigText(L, { x: 640, y: 130 }, tr.gacha.double, 'gacha-double', -6));
        if (L && !reduce) {
          fireworks(L, center, 5);
          confettiRain(L, 70);
        }
        await play(gsap.to(cards, { x: (i: number) => (i === 0 ? -190 : 190), duration: 0.35, ease: 'power2.out' }));
        if (gone()) return;
      }
      if (sr && L && !reduce) {
        // スーパーレア：画面が白くフラッシュし、虹色の蛍光ペンの線が放射状に走る
        flash(L, 1, 0.6);
        cleanups.current.push(
          radialLines(L, center, {
            colors: ['var(--pen-red)', 'var(--super-gold)', 'var(--pen-green)', 'var(--pen-sky)', 'var(--pen-blue)', 'var(--pen-purple)', 'var(--fx-onom-fill)'],
            lines: 36,
            width: 20,
            inner: 150,
            seconds: 0.55,
          }),
        );
      } else if (L && !reduce) {
        // ノーマル：ペンの集中線
        cleanups.current.push(radialLines(L, center, { colors: ['var(--ink)'], lines: 30, width: 4, inner: 200, seconds: 0.25 }));
      }
      if (sr) audio.play('jingle_super');
      // くるっとめくれる（スーパーレアは、ゆっくり回転しながら大きく登場）
      audio.play('se_card_flip');
      await play(gsap.to(backs, { scaleX: 0, duration: 0.14, ease: 'power1.in' }));
      if (gone()) return;
      const flips = fronts.map((f, i) =>
        results[i]?.super && !reduce
          ? play(gsap.fromTo(f, { scaleX: 1, scale: 0.2, rotate: -720 }, { scale: 1, rotate: 0, duration: 1.1, ease: 'power2.out' }))
          : play(gsap.to(f, { scaleX: 1, duration: 0.16, ease: 'power1.out' })),
      );
      if (!sr && !double && L) cleanups.current.push(bigText(L, { x: 640, y: 120 }, tr.gacha.flip, 'gacha-flip', -10));
      await Promise.all(flips);
      if (gone()) return;
      if (sr && L) {
        // 星の落書きと紙吹雪・「スーパーレア！」のはんこ・画面揺れ大
        if (!reduce) {
          confetti(L, center, 60, 1.4);
          confettiRain(L, 60);
          if (root.current) void shake(root.current, 18, 10);
        }
        cleanups.current.push(bigText(L, { x: 640, y: 590 }, tr.gacha.superStamp, 'gacha-stamp', -12));
      }
      await wait(sr ? 500 : 200);
      if (!alive.current) return;
      setDone(true);
    };
    void run();
    return () => {
      alive.current = false;
      for (const c of cleanups.current) c();
      cleanups.current = [];
    };
  }, []);

  // ぜんぶ あける の時は、少し見せてから自動で閉じる
  useEffect(() => {
    if (!done || !auto) return;
    const id = window.setTimeout(onClose, fx.dur(results.some((r) => r.super) ? 1600 : 700));
    return () => window.clearTimeout(id);
  }, [done, auto]);

  return (
    <div
      className={`gacha-reveal ${results.some((r) => r.super) ? 'is-super' : ''}`}
      onClick={(e) => done && !(e.target as HTMLElement).closest('.gacha-reveal__skip') && onClose()}
      data-testid="gacha-reveal"
    >
      <div className="gacha-reveal__cards">
        {results.map((r, i) => (
          <div key={i} className={`gacha-reveal__card ${r.super ? 'is-super' : ''}`} ref={(e) => void (cardRefs.current[i] = e)}>
            <div className="gacha-reveal__back" ref={(e) => void (backRefs.current[i] = e)}>
              <CardBack seed={`reveal-back-${i}`} width={176} height={240} />
            </div>
            <div className="gacha-reveal__front" ref={(e) => void (frontRefs.current[i] = e)}>
              <CardMini def={CARD_DB[r.no]} seed={`reveal-${r.no}-${i}`} variant="tile" />
              {r.isNew && <span className="gacha-new">{tr.gacha.newTag}</span>}
            </div>
          </div>
        ))}
      </div>
      {/* キーボードでも進めるように、つぎへ は本物のボタン（出たらフォーカス） */}
      {done && (
        <button type="button" className="gacha-reveal__next pencil" ref={(e) => e?.focus({ preventScroll: true })}>
          {tr.gacha.tapNext}
        </button>
      )}
      <RoughButton
        seed="reveal-skip"
        className="gacha-reveal__skip"
        onClick={onSkip}
      >
        {tr.gacha.skip}
      </RoughButton>
    </div>
  );
}
