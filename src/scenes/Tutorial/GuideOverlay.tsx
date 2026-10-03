import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { audio } from '../../audio/audioManager';
import type { GameState } from '../../engine/types';
import { useFx } from '../../fx/fxSettings';
import { local } from '../../i18n';
import { useLang, useT } from '../../i18n/useT';
import type { TutorialDriver } from '../../tutorial/driver';
import { OtegeArt } from '../../ui/common/OtegeArt';
import { RoughBox } from '../../ui/rough/RoughBox';

/** 舞台（1280×720）の上の四角 */
type Rect = { x: number; y: number; w: number; h: number };

const PAD = 10;

/** 囲む場所の名前 → 画面の要素 */
function elementOf(root: HTMLElement, key: string): Element | null {
  if (key.startsWith('card:')) return root.querySelector(`.battle-board [data-uid="${key.slice(5)}"]`);
  if (key.startsWith('zone:')) return root.querySelector(`[data-zone="${key.slice(5)}"]`);
  if (key === 'end') return root.querySelector('.battle-end');
  if (key === 'dice') return root.querySelector('.battle-dice');
  if (key === 'draw') return root.querySelector('.battle-draw');
  return null;
}

/** 要素の四角を、舞台の座標（拡大・縮小の前）にする */
export function stageRect(root: HTMLElement, el: Element): Rect {
  const rr = root.getBoundingClientRect();
  const s = rr.width / (root.offsetWidth || 1280);
  const r = el.getBoundingClientRect();
  return { x: (r.left - rr.left) / s - PAD, y: (r.top - rr.top) / s - PAD, w: r.width / s + PAD * 2, h: r.height / s + PAD * 2 };
}

/**
 * 押せない所（穴の外）を、重ならない四角に分ける。穴どうしが重なっても、重なった所は穴のまま
 * （穴のふちの x・y で舞台を区切り、どの穴にも入らない区画をふさぐ。横に続く区画はつなげる）
 */
export function blockedRects(holes: Rect[]): Rect[] {
  const xs = [...new Set([-50, 1330, ...holes.flatMap((h) => [h.x, h.x + h.w])])].sort((a, b) => a - b);
  const ys = [...new Set([-50, 770, ...holes.flatMap((h) => [h.y, h.y + h.h])])].sort((a, b) => a - b);
  const inHole = (x: number, y: number) => holes.some((h) => x > h.x && x < h.x + h.w && y > h.y && y < h.y + h.h);
  const out: Rect[] = [];
  for (let j = 0; j < ys.length - 1; j++) {
    let run: Rect | null = null;
    for (let i = 0; i < xs.length - 1; i++) {
      const blocked = !inHole((xs[i] + xs[i + 1]) / 2, (ys[j] + ys[j + 1]) / 2);
      if (blocked && run) run.w = xs[i + 1] - run.x;
      else if (blocked) run = { x: xs[i], y: ys[j], w: xs[i + 1] - xs[i], h: ys[j + 1] - ys[j] };
      else if (run) {
        out.push(run);
        run = null;
      }
    }
    if (run) out.push(run);
  }
  return out;
}

/** 吹き出しの右はしから、いちばん目の穴へ向かう手描きの矢印 */
export function arrowPath(to: Rect): { line: string; head: string } {
  const sx = 384;
  const sy = 250;
  // 穴のふちのうち、矢印の出発点に近い所
  const tx = Math.max(to.x - 6, Math.min(sx, to.x + to.w));
  const ty = to.y + to.h / 2 > sy ? Math.max(to.y - 6, Math.min(sy, to.y + to.h)) : to.y + to.h + 6;
  const ex = tx === sx ? to.x + to.w / 2 : tx;
  const ey = tx === sx ? ty : to.y + to.h / 2;
  const cx = (sx + ex) / 2;
  const cy = Math.min(sy, ey) - 70;
  // 矢じり：終点の向き
  const ang = Math.atan2(ey - cy, ex - cx);
  const a1 = ang + Math.PI * 0.82;
  const a2 = ang - Math.PI * 0.82;
  const L = 22;
  return {
    line: `M${sx} ${sy} Q${cx} ${cy} ${ex} ${ey}`,
    head: `M${ex + Math.cos(a1) * L} ${ey + Math.sin(a1) * L} L${ex} ${ey} L${ex + Math.cos(a2) * L} ${ey + Math.sin(a2) * L}`,
  };
}

/** 花丸（赤ペン）：ぐるぐる＋花びら */
export function Hanamaru({ at }: { at: { x: number; y: number } }) {
  const tr = useT();
  const petals = Array.from({ length: 7 }, (_, i) => {
    const a = (i / 7) * Math.PI * 2;
    const x = Math.cos(a) * 46;
    const y = Math.sin(a) * 46;
    const x1 = Math.cos(a - 0.45) * 70;
    const y1 = Math.sin(a - 0.45) * 70;
    const x2 = Math.cos(a + 0.45) * 70;
    const y2 = Math.sin(a + 0.45) * 70;
    return `M${x} ${y} C${x1} ${y1} ${x2} ${y2} ${x} ${y}`;
  }).join(' ');
  return (
    <div className="guide-hanamaru" style={{ left: at.x, top: at.y }} aria-hidden>
      <svg viewBox="-80 -80 160 160" width="160" height="160">
        <path className="guide-hanamaru__petals" d={petals} />
        <path className="guide-hanamaru__swirl" d="M0 -8 C14 -8 14 10 0 12 C-20 14 -22 -16 0 -20 C28 -24 30 22 0 26 C-34 30 -38 -30 0 -34 C40 -38 44 36 0 40" />
      </svg>
      <span className="guide-hanamaru__text red-pen">{tr.tutorial.good}</span>
    </div>
  );
}

/**
 * チュートリアルの案内（UPDATE_v2 §6T-2・§6T-4）。
 * 案内役「おてあげせんせい」が画面の左はしに立ち、吹き出しで話す（1文字ずつ。タップで全文 → 次へ）。
 * 操作してほしい場所だけ蛍光ペンで丸く囲み、手描きの矢印で指す。ほかは少し暗くして押せなくする。
 * 正しく操作すると、赤ペンの花丸と「そう！」の音。
 */
export function GuideOverlay({
  driver,
  view,
  busy,
  hidden,
  rootRef,
  onDice,
}: {
  driver: TutorialDriver;
  view: GameState;
  busy: boolean;
  /** ダイアログ（カードの詳細・確認）を出している間は隠す */
  hidden: boolean;
  rootRef: RefObject<HTMLDivElement | null>;
  /** 先攻決めのサイコロを押した */
  onDice: () => void;
}) {
  const tr = useT();
  const lang = useLang();
  const fx = useFx();
  const [, setTick] = useState(0);
  const [holes, setHoles] = useState<Rect[]>([]);
  const [flower, setFlower] = useState<{ at: { x: number; y: number }; n: number } | null>(null);
  const [shown, setShown] = useState(0);
  const lastHoles = useRef('');

  // 台本が進んだら描き直す。正しく操作したら花丸と「そう！」
  useEffect(
    () =>
      driver.subscribe((e) => {
        setTick((n) => n + 1);
        if (e.kind !== 'good') return;
        audio.play('se_sou');
        const root = rootRef.current;
        const el = root && e.spot.map((k) => elementOf(root, k)).find((x) => !!x);
        const r = root && el ? stageRect(root, el) : { x: 560, y: 300, w: 160, h: 120 };
        setFlower((f) => ({ at: { x: r.x + r.w / 2, y: r.y + r.h / 2 }, n: (f?.n ?? 0) + 1 }));
      }),
    [driver],
  );
  useEffect(() => {
    if (!flower) return;
    const id = window.setTimeout(() => setFlower(null), fx.dur(1100));
    return () => window.clearTimeout(id);
  }, [flower]);

  const step = driver.step;
  const watch = step?.kind === 'watch';
  // 見るだけの手順は、相手が動いている間も出しておく（暗くしない）
  const active = !!step && !hidden && (watch || (!busy && driver.visible(view)));
  const text = step ? local(step.text, lang) : '';

  // 文字を1つずつ出す（演出スピードに合わせる。演出をへらす時は一度に出す）。
  // 手順が変わった時に、前の文の長さのまま1コマ描かないように、描く前に戻す
  useLayoutEffect(() => {
    if (!active) return;
    if (fx.reduceFx) {
      setShown(text.length);
      return;
    }
    setShown(0);
    const id = window.setInterval(() => {
      setShown((n) => {
        if (n >= text.length) {
          window.clearInterval(id);
          return n;
        }
        return n + 1;
      });
    }, 42 / fx.speed);
    return () => window.clearInterval(id);
  }, [active, text, fx.reduceFx, fx.speed]);
  const typing = shown < text.length;

  // 囲む場所を測る（カードが動くので、出している間はときどき測り直す）
  useLayoutEffect(() => {
    if (!active || watch) {
      setHoles([]);
      lastHoles.current = '';
      return;
    }
    const measure = () => {
      const root = rootRef.current;
      if (!root) return;
      const keys = [...(step?.spot ?? [])];
      const els = keys.map((k) => elementOf(root, k)).filter((e): e is Element => !!e);
      // 選んだカードの操作ボタン（「ベンチへ」など）も押せるように
      const bar = root.querySelector('.battle-actionbar');
      if (bar && step?.kind === 'act') els.push(bar);
      const next = els.map((e) => stageRect(root, e));
      const key = JSON.stringify(next.map((r) => [Math.round(r.x), Math.round(r.y), Math.round(r.w), Math.round(r.h)]));
      if (key !== lastHoles.current) {
        lastHoles.current = key;
        setHoles(next);
      }
    };
    measure();
    const id = window.setInterval(measure, 200);
    return () => window.clearInterval(id);
  }, [active, watch, step, view]);

  if (!step || !active) return flower ? <Hanamaru key={flower.n} at={flower.at} /> : null;

  const tap = () => {
    if (typing) {
      setShown(text.length);
      return;
    }
    if (step.kind === 'tap') {
      audio.play('se_page');
      driver.tap(view);
    }
  };
  // 穴の外は押せない。タップの手順は どこを押しても次へ（穴も含む）
  const blocks = step.kind === 'tap' ? [{ x: -50, y: -50, w: 1380, h: 820 }] : blockedRects(holes);
  const arrow = holes.length > 0 ? arrowPath(holes[0]) : null;

  return (
    <div className={`guide guide--${step.kind}`} data-testid="tutorial-guide" data-step={step.id}>
      {!watch && (
        <>
          <svg className="guide__dim" viewBox="0 0 1280 720" aria-hidden>
            <defs>
              <mask id="guide-holes">
                <rect x="-50" y="-50" width="1380" height="820" fill="white" />
                {holes.map((h, i) => (
                  <rect key={i} x={h.x} y={h.y} width={h.w} height={h.h} rx={14} fill="black" />
                ))}
              </mask>
            </defs>
            <rect x="-50" y="-50" width="1380" height="820" mask="url(#guide-holes)" />
          </svg>
          {blocks.map((b, i) => (
            <div key={i} className="guide__catcher" style={{ left: b.x, top: b.y, width: b.w, height: b.h }} onClick={tap} />
          ))}
          <svg className="guide__marks" viewBox="0 0 1280 720" aria-hidden>
            {holes.map((h, i) => (
              <ellipse key={i} className="guide__circle" cx={h.x + h.w / 2} cy={h.y + h.h / 2} rx={h.w / 2 + 14} ry={h.h / 2 + 12} />
            ))}
            {arrow && (
              <g className="guide__arrow">
                <path d={arrow.line} />
                <path d={arrow.head} />
              </g>
            )}
          </svg>
        </>
      )}
      {step.kind === 'dice' && holes[0] && (
        <button
          type="button"
          className="guide__dice"
          style={{ left: holes[0].x, top: holes[0].y, width: holes[0].w, height: holes[0].h }}
          aria-label={tr.tutorial.rollDice}
          data-testid="tutorial-dice"
          onClick={() => {
            if (typing) setShown(text.length);
            onDice();
          }}
        />
      )}
      <div className="guide__sensei" aria-hidden>
        <OtegeArt width={136} />
      </div>
      <div className="guide__balloon" onClick={tap} role="status" aria-live="polite">
        <RoughBox seed={`guide-${step.id}`} className="guide__box" paper radius={18}>
          <span className="guide__name pencil">{tr.tutorial.sensei}</span>
          <p className="guide__text">
            {/* 読み上げは全文を1回だけ（1文字ずつ読み上げないように） */}
            <span className="sr-only">{text}</span>
            <span aria-hidden>
              {text.slice(0, shown)}
              <span className="guide__rest">{text.slice(shown)}</span>
            </span>
          </p>
          {step.kind === 'tap' && !typing && (
            <button type="button" className="guide__next blue-pen" data-testid="tutorial-next" onClick={(e) => (e.stopPropagation(), tap())}>
              {tr.tutorial.tapNext} ▶
            </button>
          )}
        </RoughBox>
        <svg className="guide__tail" viewBox="0 0 60 50" aria-hidden>
          <path d="M8 2 Q20 30 4 48 Q30 30 44 2" />
        </svg>
      </div>
      {flower && <Hanamaru key={flower.n} at={flower.at} />}
    </div>
  );
}
