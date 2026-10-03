import { gsap } from 'gsap';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { audio } from '../../audio/audioManager';
import { useFx } from '../../fx/fxSettings';
import { useT } from '../../i18n/useT';
import { STORY, type StageDef, type StageState, type StoryData, childrenOf } from '../../story/story';
import { RoughBox } from '../../ui/rough/RoughBox';
import { RoughButton } from '../../ui/rough/RoughButton';
import { BossArt } from './BossCutin';

/**
 * ストーリーのマップ（SPEC §7 S08・UPDATE_v2_1 §4）。下から上へ進み、縦にも横にも広がる。
 * 大きさと線は story.json の pos・parents から自動で描く（ステージを足す時は story.json に書くだけ）。
 * 上下左右にドラッグ（スワイプ）で動かし、ホイール・2本指・「＋」「－」で拡大縮小（0.6〜1.5倍）。右下に全体図。
 */

/** 枠の大きさ（雑魚は四角、ボスは大きめ） */
export const SIZE = { normal: { w: 120, h: 96 }, boss: { w: 210, h: 176 } } as const;
/** 1マス（ステージ1つ分の間隔）の大きさと、紙の余白 */
const CELL = { x: 230, y: 230 };
const MARGIN = { x: 250, top: 190, bottom: 120 };
/** 名前の札の高さ（線は名前の下から出る） */
const LABEL_H = 36;
/** 合流点：枠の下からこれだけ下で、線が1点に集まる */
const MERGE_GAP = 46;
export const ZOOM = { min: 0.6, max: 1.5 } as const;

export type MapLayout = {
  width: number;
  height: number;
  /** ステージの枠のまんなか（紙の上の座標） */
  at: (no: number) => { x: number; y: number };
};

/** story.json の pos から、紙の大きさと位置を決める（下から上へ：pos.y が大きいほど上） */
export function mapLayout(data: StoryData = STORY): MapLayout {
  const xs = data.stages.map((s) => s.pos.x);
  const ys = data.stages.map((s) => s.pos.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const byNo = new Map(data.stages.map((s) => [s.no, s]));
  return {
    width: (maxX - minX) * CELL.x + MARGIN.x * 2,
    height: (maxY - minY) * CELL.y + MARGIN.top + MARGIN.bottom,
    at: (no) => {
      const s = byNo.get(no)!;
      return { x: (s.pos.x - minX) * CELL.x + MARGIN.x, y: (maxY - s.pos.y) * CELL.y + MARGIN.top };
    },
  };
}

/** 種から決まる -1〜1 の数（線のゆらぎ。描き直しても同じ形） */
function wobble(key: string, k: number): number {
  let h = 2166136261;
  const s = `${key}:${k}`;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return ((h >>> 0) / 4294967295) * 2 - 1;
}

export type Edge = { key: string; from: number; to: number; d: string };

/**
 * 線（手描きのゆるい曲線）。上のステージへは「上の辺 → 下の辺」、同じ高さへは横の辺どうし。
 * 下から2本以上来るステージは、枠の下の合流点に線が1点に集まり、そこから1本で枠に入る（stub）
 */
export function mapEdges(layout: MapLayout, data: StoryData = STORY): { edges: Edge[]; stubs: { to: number; d: string }[] } {
  const byNo = new Map(data.stages.map((s) => [s.no, s]));
  const edges: Edge[] = [];
  const stubs: { to: number; d: string }[] = [];
  for (const c of data.stages) {
    const cp = layout.at(c.no);
    const cs = SIZE[c.kind];
    const below = c.parents.filter((p) => byNo.get(p)!.pos.y < c.pos.y);
    const merge = below.length >= 2;
    const bottom = { x: cp.x, y: cp.y + cs.h / 2 + LABEL_H };
    const mergeAt = { x: cp.x, y: bottom.y + MERGE_GAP };
    if (merge) stubs.push({ to: c.no, d: `M${mergeAt.x} ${mergeAt.y} L${bottom.x} ${bottom.y}` });
    for (const pNo of c.parents) {
      const p = byNo.get(pNo)!;
      const pp = layout.at(pNo);
      const ps = SIZE[p.kind];
      const key = `${pNo}-${c.no}`;
      let d: string;
      if (p.pos.y === c.pos.y) {
        // 同じ高さ：横の辺どうし
        const dir = Math.sign(cp.x - pp.x);
        const x1 = pp.x + (dir * ps.w) / 2 + dir * 8;
        const x2 = cp.x - (dir * cs.w) / 2 - dir * 8;
        const dx = x2 - x1;
        d = `M${x1} ${pp.y} C${x1 + dx * 0.35} ${pp.y + 18 * wobble(key, 1)} ${x2 - dx * 0.35} ${cp.y + 18 * wobble(key, 2)} ${x2} ${cp.y}`;
      } else {
        // 上へ：前のステージの上の辺から、このステージの下（合流点）へ
        const x1 = pp.x + 10 * wobble(key, 0);
        const y1 = pp.y - ps.h / 2 - 8;
        const end = merge ? mergeAt : bottom;
        const dy = y1 - end.y;
        d = `M${x1} ${y1} C${x1 + 14 * wobble(key, 1)} ${y1 - dy * 0.5} ${end.x + 22 * wobble(key, 2)} ${end.y + dy * 0.45} ${end.x} ${end.y}`;
      }
      edges.push({ key, from: pNo, to: c.no, d });
    }
  }
  return { edges, stubs };
}

type View = { x: number; y: number; z: number };

export function StoryMap({
  stateOf,
  focus,
  fresh,
  drawing,
  shake,
  onPick,
  onDrawn,
}: {
  stateOf: (no: number) => StageState;
  /** 開いた時にまんなかに来るステージ */
  focus: number;
  /** はんこを押したばかりのステージ */
  fresh: number | null;
  /** 線を描く演出：クリアしたステージと、新しく開いたステージ */
  drawing: { from: number; opened: number[] } | null;
  shake: { no: number; n: number } | null;
  onPick: (st: StageDef) => void;
  /** 線を描き終えた */
  onDrawn: () => void;
}) {
  const tr = useT();
  const fx = useFx();
  const layout = useMemo(() => mapLayout(), []);
  const { edges, stubs } = useMemo(() => mapEdges(layout), [layout]);
  const viewRef = useRef<HTMLDivElement>(null);
  const paperRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<View>({ x: 0, y: 0, z: 1 });
  const viewNow = useRef(view);
  viewNow.current = view;
  const [box, setBox] = useState({ w: 1280, h: 634 });
  /** ドラッグ中（動かしたら、離した時の click でステージを選ばない） */
  const drag = useRef<{ moved: boolean } | null>(null);

  /** 紙が画面からはみ出さないように（紙が画面より小さい向きは、まんなかに置く） */
  const clamp = (v: View, w = box.w, h = box.h): View => {
    const z = Math.min(ZOOM.max, Math.max(ZOOM.min, v.z));
    const pw = layout.width * z;
    const ph = layout.height * z;
    const x = pw <= w ? (w - pw) / 2 : Math.min(0, Math.max(w - pw, v.x));
    const y = ph <= h ? (h - ph) / 2 : Math.min(0, Math.max(h - ph, v.y));
    return { x, y, z };
  };
  const centerOn = (no: number, z = viewNow.current.z, w = box.w, h = box.h): View => {
    const p = layout.at(no);
    return clamp({ x: w / 2 - p.x * z, y: h / 2 - p.y * z, z }, w, h);
  };
  /** (sx, sy)（画面の中の点）を動かさずに拡大縮小 */
  const zoomAt = (factor: number, sx: number, sy: number) => {
    setView((v) => {
      const z = Math.min(ZOOM.max, Math.max(ZOOM.min, v.z * factor));
      const mx = (sx - v.x) / v.z;
      const my = (sy - v.y) / v.z;
      return clamp({ x: sx - mx * z, y: sy - my * z, z });
    });
  };

  // 開いた時：画面の大きさを測り、いちばん新しい「行ける」ステージ（戻ってきた時はクリアしたステージ）をまんなかに
  useLayoutEffect(() => {
    const el = viewRef.current;
    if (!el) return;
    const w = el.clientWidth;
    const h = el.clientHeight;
    setBox({ w, h });
    setView(centerOn(focus, 1, w, h));
  }, []);

  /** 舞台の拡大縮小（画面の大きさに合わせて縮めている分）を戻す */
  const stageScale = () => {
    const el = viewRef.current;
    return el ? el.getBoundingClientRect().width / (el.clientWidth || 1) : 1;
  };
  /** 画面の座標 → 地図の窓の中の座標 */
  const local = (cx: number, cy: number) => {
    const r = viewRef.current!.getBoundingClientRect();
    const s = stageScale();
    return { x: (cx - r.left) / s, y: (cy - r.top) / s };
  };

  // ホイールで拡大縮小（ページは動かさない）
  useEffect(() => {
    const el = viewRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const p = local(e.clientX, e.clientY);
      // 行単位（1）・ページ単位（2）で来る環境もあるので、画素に換算する
      const dy = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaMode === 2 ? e.deltaY * 600 : e.deltaY;
      zoomAt(Math.exp(-dy * 0.0015), p.x, p.y);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [box]);

  // ドラッグ（指・マウス）で動かす。2本指は拡大縮小
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  /** window に付けたリスナーを外す（指を離した時と、画面を離れる時） */
  const detach = useRef<(() => void) | null>(null);
  useEffect(
    () => () => {
      detach.current?.();
      pointers.current.clear();
    },
    [],
  );
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    // 前の操作の指が残っていたら（離したのを取りこぼした時）消してから始める
    if (!detach.current) pointers.current.clear();
    pointers.current.set(e.pointerId, local(e.clientX, e.clientY));
    if (pointers.current.size === 1) drag.current = { moved: false };
    const move = (ev: PointerEvent) => {
      const prev = pointers.current.get(ev.pointerId);
      if (!prev) return;
      const now = local(ev.clientX, ev.clientY);
      if (pointers.current.size >= 2) {
        // 2本指：2点の間の長さの変わり方で拡大縮小、まんなかの動きで移動
        const [a, b] = [...pointers.current.entries()];
        const other = a[0] === ev.pointerId ? b[1] : a[1];
        const d0 = Math.hypot(prev.x - other.x, prev.y - other.y) || 1;
        const d1 = Math.hypot(now.x - other.x, now.y - other.y) || 1;
        const mid = { x: (now.x + other.x) / 2, y: (now.y + other.y) / 2 };
        zoomAt(d1 / d0, mid.x, mid.y);
        if (drag.current) drag.current.moved = true;
      } else {
        const dx = now.x - prev.x;
        const dy = now.y - prev.y;
        if (drag.current && (Math.abs(dx) > 0 || Math.abs(dy) > 0)) {
          if (!drag.current.moved && Math.hypot(dx, dy) < 4) return; // 少しの手ぶれは押したことにする
          drag.current.moved = true;
        }
        setView((v) => clamp({ ...v, x: v.x + dx, y: v.y + dy }));
      }
      pointers.current.set(ev.pointerId, now);
    };
    const up = (ev: PointerEvent) => {
      pointers.current.delete(ev.pointerId);
      if (pointers.current.size === 0) {
        detach.current?.();
        // 離した直後の click で「動かしたか」を見てから消す
        window.setTimeout(() => (drag.current = null), 0);
      }
    };
    if (!detach.current) {
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', up);
      detach.current = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        window.removeEventListener('pointercancel', up);
        detach.current = null;
      };
    }
  };

  // クリアして戻ってきた：そのステージから出る線が全部ペンで描かれる → 新しく開いたステージが ぽんっと開く。
  // 描き終わるまで、その線は見せない（pending）
  const [pending, setPending] = useState<Set<string>>(() =>
    drawing ? new Set([...childrenOf(drawing.from).map((c) => `${drawing.from}-${c}`), ...drawing.opened.map((n) => `stub-${n}`)]) : new Set(),
  );
  useEffect(() => {
    if (!drawing || pending.size === 0) return;
    const paper = paperRef.current;
    if (!paper) return;
    let alive = true;
    const keys = [...pending];
    const lines = keys.map((k) => paper.querySelector<SVGPathElement>(`[data-edge="${k}"]`)).filter((e): e is SVGPathElement => !!e);
    const reduce = fx.reduceFx;
    const tl = gsap.timeline({ delay: reduce ? 0.1 : 0.7 });
    for (const l of lines) {
      const len = l.getTotalLength();
      gsap.set(l, { strokeDasharray: len, strokeDashoffset: len, opacity: 1 });
    }
    tl.call(() => alive && audio.play('se_pen'));
    tl.to(lines, { strokeDashoffset: 0, duration: reduce ? 0.2 : 1.1, ease: 'power1.inOut' });
    tl.call(() => {
      if (!alive) return;
      setPending(new Set());
      onDrawn();
      audio.play('se_stage_open');
      for (const n of drawing.opened) {
        const el = paper.querySelector<HTMLElement>(`[data-stage="${n}"]`);
        if (el && !reduce) gsap.fromTo(el, { scale: 0.4, rotate: -12 }, { scale: 1, rotate: 0, duration: 0.6, ease: 'back.out(3)' });
      }
    });
    return () => {
      alive = false;
      tl.kill();
    };
  }, []);

  const open = (no: number) => stateOf(no) !== 'locked';
  const mini = { w: 190, h: (190 * layout.height) / layout.width };
  const ms = mini.w / layout.width;

  return (
    <div className="story-map" ref={viewRef} onPointerDown={onPointerDown} data-testid="story-map" data-zoom={view.z.toFixed(2)}>
      <div
        className="story-map__paper"
        ref={paperRef}
        style={{ width: layout.width, height: layout.height, transform: `translate(${view.x}px, ${view.y}px) scale(${view.z})` }}
      >
        <svg className="story-map__lines" width={layout.width} height={layout.height} viewBox={`0 0 ${layout.width} ${layout.height}`} aria-hidden>
          {edges.map((e) => (
            <path
              key={e.key}
              data-edge={e.key}
              className={`story-line ${stateOf(e.from) === 'cleared' && !pending.has(e.key) ? 'is-open' : ''} ${pending.has(e.key) ? 'is-drawing' : ''}`}
              d={e.d}
            />
          ))}
          {stubs.map((s) => (
            <path
              key={`stub-${s.to}`}
              data-edge={`stub-${s.to}`}
              className={`story-line ${open(s.to) && !pending.has(`stub-${s.to}`) ? 'is-open' : ''} ${pending.has(`stub-${s.to}`) ? 'is-drawing' : ''}`}
              d={s.d}
            />
          ))}
        </svg>
        {STORY.stages.map((st) => (
          <StageNode
            key={st.no}
            stage={st}
            at={layout.at(st.no)}
            state={stateOf(st.no)}
            fresh={fresh === st.no}
            shake={shake?.no === st.no ? shake.n : 0}
            onPick={() => {
              if (drag.current?.moved) return;
              onPick(st);
            }}
            onFocus={(el) => el.matches(':focus-visible') && setView((v) => {
              // キーボードで選んだステージが見えるように
              const p = layout.at(st.no);
              const sx = v.x + p.x * v.z;
              const sy = v.y + p.y * v.z;
              return sx < 80 || sx > box.w - 80 || sy < 80 || sy > box.h - 80 ? centerOn(st.no, v.z) : v;
            })}
          />
        ))}
      </div>

      {/* 全体図（どのあたりを見ているか）。押すとそこへ動く */}
      <div
        className="story-minimap"
        style={{ width: mini.w, height: mini.h }}
        onPointerDown={(e) => {
          e.stopPropagation();
          const r = e.currentTarget.getBoundingClientRect();
          const s = stageScale();
          const mx = (e.clientX - r.left) / s / ms;
          const my = (e.clientY - r.top) / s / ms;
          setView((v) => clamp({ ...v, x: box.w / 2 - mx * v.z, y: box.h / 2 - my * v.z }));
        }}
        data-testid="story-minimap"
        aria-hidden
      >
        <svg width={mini.w} height={mini.h} viewBox={`0 0 ${layout.width} ${layout.height}`}>
          {edges.map((e) => (
            <path key={e.key} d={e.d} className={`story-minimap__line ${stateOf(e.from) === 'cleared' ? 'is-open' : ''}`} />
          ))}
          {STORY.stages.map((st) => {
            const p = layout.at(st.no);
            const s = stateOf(st.no);
            return <circle key={st.no} cx={p.x} cy={p.y} r={st.kind === 'boss' ? 90 : 62} className={`story-minimap__dot story-minimap__dot--${st.kind} is-${s}`} />;
          })}
          <rect className="story-minimap__view" x={-view.x / view.z} y={-view.y / view.z} width={box.w / view.z} height={box.h / view.z} />
        </svg>
      </div>
      <div className="story-zoom" style={{ bottom: 30 + mini.h }}>
        <RoughButton seed="story-zoom-in" className="story-zoom__btn" ariaLabel={tr.story.zoomIn} onClick={() => zoomAt(1.25, box.w / 2, box.h / 2)} data-testid="story-zoom-in">
          {tr.story.zoomInMark}
        </RoughButton>
        <RoughButton seed="story-zoom-out" className="story-zoom__btn" ariaLabel={tr.story.zoomOut} onClick={() => zoomAt(0.8, box.w / 2, box.h / 2)} data-testid="story-zoom-out">
          {tr.story.zoomOutMark}
        </RoughButton>
      </div>
    </div>
  );
}

/**
 * マップの中の1つのステージ（雑魚＝緑の四角、ボス＝赤い大きな枠にイラスト）。
 * まだ行けないステージは、点線の枠に「？」（何があるかはまだ秘密。名前も出さない）
 */
function StageNode({
  stage,
  at,
  state,
  fresh,
  shake,
  onPick,
  onFocus,
}: {
  stage: StageDef;
  at: { x: number; y: number };
  state: StageState;
  fresh: boolean;
  shake: number;
  onPick: () => void;
  /** キーボードで選んだ時だけ、見える位置へ動かす（el はステージのボタン） */
  onFocus: (el: HTMLElement) => void;
}) {
  const tr = useT();
  const ref = useRef<HTMLButtonElement>(null);
  const size = SIZE[stage.kind];
  const boss = stage.kind === 'boss';
  const locked = state === 'locked';
  useEffect(() => {
    if (shake && ref.current) gsap.fromTo(ref.current.querySelector('.story-node__frame'), { x: -10 }, { x: 0, duration: 0.5, ease: 'elastic.out(1.2, 0.3)' });
  }, [shake]);
  return (
    <button
      ref={ref}
      type="button"
      className={`story-node story-node--${stage.kind} is-${state} ${fresh ? 'is-fresh' : ''}`}
      style={{ left: at.x - size.w / 2, top: at.y - size.h / 2, width: size.w }}
      data-stage={stage.no}
      data-testid={`story-stage-${stage.no}`}
      aria-label={tr.story.stageAria(stage.no, locked ? tr.story.unknownName : stage.name, state)}
      onClick={onPick}
      onFocus={(e) => onFocus(e.currentTarget)}
    >
      <RoughBox
        seed={`stage-${stage.no}`}
        className="story-node__frame"
        style={{ height: size.h }}
        stroke={locked ? 'var(--pencil)' : boss ? 'var(--pen-red)' : 'var(--pen-green)'}
        strokeWidth={locked ? 2.4 : boss ? 4 : 3}
        dashed={locked}
        double={boss && !locked}
        boil={state === 'open'}
        paper
        radius={boss ? 14 : 8}
      >
        {boss && stage.boss && !locked && <BossArt boss={stage.boss} name={stage.name} small />}
        {locked && <span className="story-node__q">{tr.story.unknownMark}</span>}
        {state === 'cleared' && (
          <>
            <span className={`story-stamp ${fresh ? 'is-new' : ''}`}>{tr.story.cleared}</span>
            <CheckDoodle />
          </>
        )}
      </RoughBox>
      <span className={`story-node__no num ${locked ? 'pencil' : ''}`}>{stage.no}</span>
      <span className={`story-node__name ${locked ? 'pencil' : ''}`}>{locked ? tr.story.unknownName : stage.name}</span>
    </button>
  );
}

function CheckDoodle() {
  return (
    <svg className="story-check" viewBox="0 0 50 40" aria-hidden>
      <path d="M4 22 Q12 28 18 36 Q28 14 46 4" />
    </svg>
  );
}
