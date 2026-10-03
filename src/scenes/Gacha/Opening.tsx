import { gsap } from 'gsap';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { audio } from '../../audio/audioManager';
import { CARD_DB } from '../../data/cards';
import type { PackDef } from '../../data/packs';
import { useFx } from '../../fx/fxSettings';
import { bigText, centerIn, confetti, confettiRain, fireworks, flash, paperScraps, radialLines, shake } from '../../fx/paperFx';
import { goldBeams, sparkleBurst, sparkleFountain, sparkleRain } from '../../fx/sparkleFx';
import { play, wait } from '../../fx/timing';
import type { Bag, PullResult } from '../../gacha/gacha';
import { useT } from '../../i18n/useT';
import { CardBack } from '../../ui/card/CardBack';
import { CardMini } from '../../ui/card/CardMini';
import { RoughButton } from '../../ui/rough/RoughButton';
import { PackArt } from './PackArt';

/**
 * 袋を開ける（SPEC §7 S09「演出」）。
 * 3まい：袋が3つ机の上に滑ってくる。15まい：5×3に並ぶ。1袋目は自分で開ける（タップ・横になぞって破る）。
 * 2袋目からは「つぎへ」で、次の袋が真ん中へ滑ってきて自動で開く（v2.1-K）。最後の袋の「つぎへ」でまとめ画面へ。
 * どの段階でも「ぜんぶ スキップ」でまとめ画面へ。演出スピード・演出をへらす に従う。
 */
export function Opening({
  pack,
  bags,
  results,
  onDone,
  banner,
}: {
  pack: PackDef;
  bags: Bag[];
  results: PullResult[];
  onDone: () => void;
  /** 上に出す札（チュートリアルの見返しの「みほん」など） */
  banner?: string;
}) {
  const tr = useT();
  const fx = useFx();
  const [opened, setOpened] = useState<boolean[]>(() => bags.map(() => false));
  const [reveal, setReveal] = useState<number | null>(null);
  /** 真ん中に滑ってきて自動で開く袋（2袋目から） */
  const [center, setCenter] = useState<number | null>(null);
  const busy = useRef(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  const bagRefs = useRef<(HTMLDivElement | null)[]>([]);
  const alive = useRef(true);
  /** 画面全体に降り続けるキラキラを止める関数（スーパーレア・ダブルが出たら、まとめ画面まで降る） */
  const rainStop = useRef<(() => void) | null>(null);
  const many = bags.length > 3;
  const reduce = fx.reduceFx;

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
      rainStop.current?.();
      rainStop.current = null;
      // 画面を離れたら、飛んでいるキラキラなどの動きも止める
      const L = layerRef.current;
      if (L) gsap.killTweensOf(L.querySelectorAll('*'));
    };
  }, []);

  // 袋が机の上に滑ってくる（15まいは5×3に並ぶ）
  const placed = useRef(false);
  useLayoutEffect(() => {
    const els = bagRefs.current.filter((e): e is HTMLDivElement => !!e);
    gsap.fromTo(els, { x: 900, rotate: 25, opacity: 0 }, { x: 0, rotate: 0, opacity: 1, duration: reduce ? 0.2 : 0.55, stagger: many ? 0.04 : 0.12, ease: 'power3.out', clearProps: 'transform,opacity' });
    // 開発時の StrictMode（片付け → すぐもう一度）でも、音は1回だけ
    if (placed.current) return;
    placed.current = true;
    audio.play('se_card_place');
    // スーパーレアの袋は、開ける前から光って震える
    if (bags.some((b) => b.cards.some((c) => c.super))) window.setTimeout(() => alive.current && audio.play('se_super_shine'), fx.dur(500));
  }, []);

  // 真ん中の舞台が出ている間は、後ろの袋の一覧をキーボードでも押せないようにする（inert）
  const bagsRef = useRef<HTMLDivElement>(null);

  /** スーパーレア・ダブルが出た：画面全体にキラキラを降らせ始める（まとめ画面に移るまで） */
  const startRain = () => {
    const L = layerRef.current;
    if (reduce || rainStop.current || !L) return;
    rainStop.current = sparkleRain(L, 16);
  };

  /** el の袋を開ける（震える → 破る → キラキラが噴き出す → カードがめくれる） */
  const open = async (i: number, el: HTMLElement | null) => {
    if (busy.current || opened[i]) return;
    busy.current = true;
    const layer = layerRef.current;
    const big = bags[i].double || bags[i].cards.some((c) => c.super);
    if (el && layer) {
      // 開ける前に、袋が小さく震えて期待をあおる
      if (!reduce) {
        await play(gsap.fromTo(el, { rotate: -3 }, { rotate: 3, x: 2, duration: 0.05, yoyo: true, repeat: big ? 11 : 7, ease: 'none' }));
        gsap.set(el, { rotate: 0, x: 0 });
        if (!alive.current) return;
      }
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
      const mouth = { x: at.x, y: at.y - (r.height / s) * 0.36 };
      if (!reduce) paperScraps(layer, mouth, 12);
      // 袋の口から黄色いキラキラが噴き出す（スーパーレア・ダブルは3倍）＋ しゃらしゃら
      sparkleFountain(layer, mouth, Math.round((big ? 120 : 40) * (reduce ? 0.25 : 1)));
      audio.play('se_sparkle');
      await play(gsap.to(strip, { x: 120, y: -90, rotate: 40, opacity: 0, duration: reduce ? 0.15 : 0.45, ease: 'power2.out', onComplete: () => strip.remove() }));
      gsap.to(el, { scaleX: 1, scaleY: 1, y: 0, duration: 0.15 });
    }
    if (!alive.current) return;
    setCenter(null);
    setReveal(i);
  };

  /** 次にまだ開けていない袋（並びの順） */
  const nextAfter = (done: boolean[]) => done.findIndex((v) => !v);

  /** めくり終わって「つぎへ」：次の袋が真ん中へ滑ってくる。最後ならまとめ画面へ */
  const next = (i: number) => {
    const done = opened.map((v, j) => (j === i ? true : v));
    setOpened(done);
    busy.current = false;
    const n = nextAfter(done);
    if (n < 0) {
      onDone();
      return;
    }
    setReveal(null);
    setCenter(n);
  };

  const left = opened.filter((v) => !v).length;
  const staged = reveal !== null || center !== null;
  useEffect(() => {
    bagsRef.current?.toggleAttribute('inert', staged);
  }, [staged]);

  return (
    <div className="gacha-open" ref={rootRef} data-testid="gacha-opening">
      {!reduce && <SpinLines />}
      <div className={`gacha-open__bags ${many ? 'gacha-open__bags--many' : ''}`} ref={bagsRef}>
        {bags.map((b, i) => (
          <BagButton
            key={i}
            index={i}
            pack={pack}
            bag={b}
            opened={opened[i]}
            result={perBag[i]}
            refCb={(e) => (bagRefs.current[i] = e)}
            onOpen={() => void open(i, bagRefs.current[i])}
          />
        ))}
      </div>
      <p className="gacha-open__hint pencil">{tr.gacha.hint}</p>
      <div className="gacha-open__buttons">
        <RoughButton seed="gacha-skip" className="gacha-open__btn gacha-open__btn--skip" onClick={onDone} data-testid="gacha-skip">
          {tr.gacha.skipAll}
        </RoughButton>
      </div>
      {staged && (
        <div className={`gacha-stage ${reveal !== null && perBag[reveal].some((r) => r.super) ? 'is-super' : ''}`} data-testid="gacha-stage">
          {!reduce && <SpinLines />}
          {center !== null && (
            <CenterBag key={`c${center}`} pack={pack} bag={bags[center]} index={center} left={left - 1} onReady={(el) => void open(center, el)} />
          )}
          {reveal !== null && (
            <Reveal
              key={`r${reveal}`}
              results={perBag[reveal]}
              double={bags[reveal].double}
              root={rootRef}
              layer={layerRef}
              last={nextAfter(opened.map((v, j) => (j === reveal ? true : v))) < 0}
              left={left - 1}
              onBig={startRain}
              onNext={() => next(reveal)}
            />
          )}
          <RoughButton seed="reveal-skip" className="gacha-reveal__skip" onClick={onDone} data-testid="gacha-skip-all">
            {tr.gacha.skipAll}
          </RoughButton>
        </div>
      )}
      {banner && <div className="gacha-open__banner red-pen">{banner}</div>}
      <div className="gacha-open__layer" ref={layerRef} aria-hidden />
    </div>
  );
}

/** 背景で、方眼ノートに描いた集中線がゆっくり回る（演出をへらす の時は出さない） */
function SpinLines() {
  const lines = [];
  for (let i = 0; i < 48; i++) {
    const a = (i / 48) * Math.PI * 2;
    // 長さと太さを少しずつ変えて、手で引いた線らしく
    const r0 = 150 + ((i * 37) % 5) * 22;
    const r1 = 900;
    lines.push(<path key={i} d={`M${Math.cos(a) * r0} ${Math.sin(a) * r0} L${Math.cos(a + 0.012) * r1} ${Math.sin(a + 0.012) * r1}`} strokeWidth={i % 3 === 0 ? 5 : 2.5} />);
  }
  return (
    <svg className="gacha-spin" viewBox="-900 -900 1800 1800" aria-hidden>
      <g className="gacha-spin__g">{lines}</g>
    </svg>
  );
}

/** 2袋目から：真ん中へ滑ってきて、震えてから自動で開く袋 */
function CenterBag({ pack, bag, index, left, onReady }: { pack: PackDef; bag: Bag; index: number; /** この袋のあと何袋 */ left: number; onReady: (el: HTMLElement) => void }) {
  const tr = useT();
  const fx = useFx();
  const ref = useRef<HTMLDivElement>(null);
  const sr = bag.cards.some((c) => c.super);
  useLayoutEffect(() => {
    const el = ref.current!;
    let live = true;
    audio.play('se_card_place');
    if (sr) audio.play('se_super_shine');
    gsap.fromTo(el, { x: 820, rotate: 18, opacity: 0 }, {
      x: 0,
      rotate: 0,
      opacity: 1,
      duration: fx.reduceFx ? 0.2 : 0.5,
      ease: 'back.out(1.3)',
      onComplete: () => {
        if (live) window.setTimeout(() => live && onReady(el), fx.dur(fx.reduceFx ? 60 : 220));
      },
    });
    return () => {
      live = false;
      gsap.killTweensOf(el);
    };
  }, []);
  return (
    <div className="gacha-center">
      <div ref={ref} className={`gacha-bag gacha-bag--center ${sr ? 'is-super' : ''} ${bag.double ? 'is-double' : ''}`} data-testid={`gacha-center-${index}`}>
        <PackArt pack={pack} small />
        {sr && <span className="gacha-bag__leak" aria-hidden />}
      </div>
      <p className="gacha-center__left pencil">{left > 0 ? tr.gacha.bagsLeft(left) : tr.gacha.lastBag}</p>
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
 * ダブル：特大の「ダブル！！」・2枚が左右に分かれて同時にめくれる・紙吹雪と花火。2枚目がスーパーレアならスーパーレアの演出を重ねる。
 * v2.1-K：めくれる瞬間にカードの周りから黄色いキラキラが弾け、カードが少し弾んで止まる。
 * スーパーレア・ダブルはキラキラ3倍・画面の端から金色の光の筋・画面全体にキラキラが降り続ける
 */
function Reveal({
  results,
  double,
  root,
  layer,
  last,
  left,
  onBig,
  onNext,
}: {
  results: PullResult[];
  double: boolean;
  root: React.RefObject<HTMLDivElement | null>;
  layer: React.RefObject<HTMLDivElement | null>;
  /** 最後の袋（つぎへ でまとめ画面へ） */
  last: boolean;
  /** このあと残っている袋の数 */
  left: number;
  /** スーパーレア・ダブルが出た（画面全体のキラキラを降らせ始める） */
  onBig: () => void;
  onNext: () => void;
}) {
  const tr = useT();
  const fx = useFx();
  const [done, setDone] = useState(false);
  const cardRefs = useRef<(HTMLDivElement | null)[]>([]);
  const backRefs = useRef<(HTMLDivElement | null)[]>([]);
  const frontRefs = useRef<(HTMLDivElement | null)[]>([]);
  const cleanups = useRef<(() => void)[]>([]);
  const sr = results.some((r) => r.super);

  useLayoutEffect(() => {
    // この実行だけの印（開発時の StrictMode で2回実行されても、1回目は片付けで止まり、演出や音が2重にならない）
    let live = true;
    const L = layer.current;
    const reduce = fx.reduceFx;
    const big = sr || double;
    const center = { x: 640, y: 330 };
    const run = async () => {
      const cards = cardRefs.current.filter((e): e is HTMLDivElement => !!e);
      const backs = backRefs.current.filter((e): e is HTMLDivElement => !!e);
      const fronts = frontRefs.current.filter((e): e is HTMLDivElement => !!e);
      gsap.set(fronts, { scaleX: 0 });
      // 裏向きのカードが袋から出てくる
      const gone = () => !live;
      await play(gsap.fromTo(cards, { y: 260, scale: 0.5, opacity: 0 }, { y: 0, scale: 1, opacity: 1, duration: 0.3, ease: 'back.out(1.6)' }));
      if (gone()) return;
      if (big && L && !reduce) {
        // 画面の端から金色の光の筋が差し込み、キラキラが画面全体に降り始める
        cleanups.current.push(goldBeams(L, center));
        onBig();
      }
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
      // くるっとめくれる（スーパーレアは、ゆっくり回転しながら大きく登場）。カードの周りから黄色いキラキラが弾ける
      audio.play('se_card_flip');
      if (L) {
        for (const c of cards) sparkleBurst(L, centerIn(L, c), Math.round((big ? 72 : 24) * (reduce ? 0.25 : 1)));
        audio.play('se_sparkle');
      }
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
      // めくれたカードが少し弾んで止まる
      if (!reduce) void play(gsap.fromTo(cards, { y: 0 }, { keyframes: [{ y: -34, duration: 0.14, ease: 'power2.out' }, { y: 0, duration: 0.5, ease: 'bounce.out' }] }));
      if (sr && L) {
        // 星の落書きと紙吹雪・「スーパーレア！」のはんこ・画面揺れ大
        if (!reduce) {
          confetti(L, center, 60, 1.4);
          confettiRain(L, 60);
          sparkleBurst(L, center, 60, 420, 420);
          if (root.current) void shake(root.current, 18, 10);
        }
        cleanups.current.push(bigText(L, { x: 640, y: 590 }, tr.gacha.superStamp, 'gacha-stamp', -12));
      }
      await wait(sr ? 500 : 250);
      if (gone()) return;
      setDone(true);
    };
    void run();
    return () => {
      live = false;
      gsap.killTweensOf([...cardRefs.current, ...backRefs.current, ...frontRefs.current].filter((e) => !!e));
      for (const c of cleanups.current) c();
      cleanups.current = [];
    };
  }, []);

  return (
    <div className={`gacha-reveal ${sr ? 'is-super' : ''}`} onClick={(e) => done && !(e.target as HTMLElement).closest('.gacha-reveal__skip') && onNext()} data-testid="gacha-reveal">
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
      {/* つぎへ：キーボードでも進めるように本物のボタン（出たらフォーカス）。画面のどこをタップしても進む */}
      {done && (
        <div className="gacha-reveal__nextwrap" onClick={(e) => e.stopPropagation()} ref={(el) => el?.querySelector('button')?.focus({ preventScroll: true })}>
          <RoughButton seed="reveal-next" className="gacha-reveal__next" highlight strokeWidth={3} onClick={onNext} data-testid="gacha-next">
            {tr.gacha.nextBag}
          </RoughButton>
          <span className="gacha-reveal__left pencil">{last ? tr.gacha.lastBag : tr.gacha.bagsLeft(left)}</span>
        </div>
      )}
    </div>
  );
}
