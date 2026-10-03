import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { audio } from '../../audio/audioManager';
import { DAILY } from '../../daily/daily';
import { DEFAULT_RULES } from '../../engine/rules';
import { useFx } from '../../fx/fxSettings';
import { offerById, packById } from '../../gacha/gacha';
import { useLang, useT } from '../../i18n/useT';
import { useNav } from '../../router';
import { useRealSave, useSave } from '../../state/SaveContext';
import { POST_STEPS, type PostCtx, type PostState, endPost, postState, postText, setPostState, stepForSave, subscribePost } from '../../tutorial/post';
import { Dialog } from '../../ui/common/Dialog';
import { OtegeArt } from '../../ui/common/OtegeArt';
import { RoughBox } from '../../ui/rough/RoughBox';
import { RoughButton } from '../../ui/rough/RoughButton';
import { Hanamaru, blockedRects, stageRect } from './GuideOverlay';
import './tutorial.css';

/** チュートリアルで案内するパックと買い方（UPDATE_v2_1 §6-2 #17） */
export const TUTORIAL_PACK = 'ganso';
export const TUTORIAL_OFFER = 'fifteen';

type Rect = { x: number; y: number; w: number; h: number };

/** 今の進み具合（チュートリアルの延長） */
export function usePostState(): PostState {
  const [s, setS] = useState(postState);
  useEffect(() => subscribePost(setS), []);
  return s;
}

/**
 * チュートリアルの延長（UPDATE_v2_1 §6-2：#16〜#25）の案内。メニュー・パックガチャ・デッキ編集の本物の画面の上に重ねる。
 * 操作してほしい場所だけを蛍光ペンで囲み、ほかは少し暗くして押せなくする（対戦の案内と同じ見た目）。
 * どの手順からでも「スキップ」できる。
 */
export function PostGuide() {
  const st = usePostState();
  if (!st.active) return null;
  return <PostGuideBody key={st.index} st={st} />;
}

function PostGuideBody({ st }: { st: PostState }) {
  const { route, go } = useNav();
  // 画面は（見本の時は写しの）セーブを見る。終えた印・再開位置は本物のセーブに書く
  const { save } = useSave();
  const real = useRealSave();
  const tr = useT();
  const lang = useLang();
  const fx = useFx();
  const step = POST_STEPS[st.index];
  const [enterLen] = useState(() => save.decks[save.selectedDeck]?.cards.length ?? 0);
  const [holes, setHoles] = useState<Rect[]>([]);
  const [shown, setShown] = useState(0);
  const [flower, setFlower] = useState<{ x: number; y: number } | null>(null);
  const [asking, setAsking] = useState(false);
  const saveRef = useRef(save);
  saveRef.current = save;
  const routeRef = useRef(route);
  routeRef.current = route;
  const doneRef = useRef(false);

  const ctx = (): PostCtx => ({
    route: routeRef.current,
    save: saveRef.current,
    review: st.review,
    enterLen,
    has: (sel) => !!document.querySelector(`.stage ${sel}`),
  });

  /** 次の手順へ（最後なら終わり） */
  const next = () => {
    if (doneRef.current) return;
    doneRef.current = true;
    let i = st.index + 1;
    while (i < POST_STEPS.length && POST_STEPS[i].skipIf?.(ctx())) i += 1;
    if (i >= POST_STEPS.length) {
      finish(true);
      return;
    }
    setPostState({ index: i });
  };

  /** 終える・とばす：初めての人は本物のセーブに tutorial.done を立てる（見本で進めた人も）。見返しは何も書かない */
  const finish = (completed: boolean) => {
    if (st.first) {
      const boughtGacha = !st.review && st.index > POST_STEPS.findIndex((s) => s.id === 'buy');
      real.update((d) => {
        d.tutorial.done = true;
        d.tutorial.step = 0;
        // 最後まで終えた・ガチャを引いた後にとばした人には、ガチャのふせんを貼らない
        if (completed || boughtGacha) d.tutorial.gachaInviteShown = true;
      });
    }
    endPost();
    if (routeRef.current !== 'menu') go('menu');
  };

  // この手順に入った：画面を動かす・途中で閉じた時の再開位置を保存
  useEffect(() => {
    if (step.goTo && routeRef.current !== step.goTo) go(step.goTo);
    // 初めての人だけ、本物のセーブに再開位置を書く（見本で進めている人は、ガチャの前の 16 のまま）
    if (st.first && !st.review) {
      const want = stepForSave(st.index);
      if (real.save.tutorial.step < want) real.update((d) => void (d.tutorial.step = want));
    }
  }, []);

  // 文：数はデータから
  const offer = offerById(TUTORIAL_OFFER);
  const vars: Record<string, string | number> = {
    coins: save.coins,
    pack: packById(TUTORIAL_PACK)?.name ?? '',
    bags: offer?.bags ?? 0,
    price: offer?.price ?? 0,
    note: st.review ? postText('noteSample', lang) : '',
    deck: save.decks[0]?.name ?? '',
    n: save.decks[save.selectedDeck]?.cards.length ?? 0,
    size: DEFAULT_RULES.deckSize,
    superMax: DEFAULT_RULES.superMaxPerDeck,
    superNote: st.supers >= 2 ? postText('noteSuper', lang) : '',
    hour: DAILY.resetHour,
  };
  const text = postText(step.id, lang, vars);

  // 1文字ずつ出す（演出スピードに合わせる。演出をへらす時は一度に出す）
  useLayoutEffect(() => {
    if (fx.reduceFx) {
      setShown(text.length);
      return;
    }
    setShown(0);
    const id = window.setInterval(() => setShown((n) => (n >= text.length ? (window.clearInterval(id), n) : n + 1)), 42 / fx.speed);
    return () => window.clearInterval(id);
  }, [text, fx.reduceFx, fx.speed]);
  const typing = shown < text.length;

  // 囲む場所を測り、操作の手順は「進む条件」を見張る（画面が動くので、ときどき測り直す）
  const last = useRef('');
  const fired = useRef(false);
  const timer = useRef(0);
  useEffect(() => {
    const tick = () => {
      const root = document.querySelector<HTMLElement>('.stage');
      if (!root) return;
      const els = step.spot.flatMap((sel) => [...root.querySelectorAll(sel)]).filter((e) => !e.closest('.post-guide'));
      const rects = els.map((e) => stageRect(root, e)).filter((r) => r.w > 0 && r.h > 0);
      const key = JSON.stringify(rects.map((r) => [Math.round(r.x), Math.round(r.y), Math.round(r.w), Math.round(r.h)]));
      if (key !== last.current) {
        last.current = key;
        setHoles(rects);
      }
      // できた：花丸と「そう！」を見せてから次へ（1回だけ）
      if (step.kind === 'act' && !fired.current && step.until?.(ctx())) {
        fired.current = true;
        audio.play('se_sou');
        const r = rects[0] ?? { x: 560, y: 300, w: 160, h: 120 };
        setFlower({ x: r.x + r.w / 2, y: r.y + r.h / 2 });
        timer.current = window.setTimeout(next, fx.dur(520));
      }
    };
    tick();
    const id = window.setInterval(tick, 150);
    return () => {
      window.clearInterval(id);
      window.clearTimeout(timer.current);
      // 開発時の StrictMode（片付け → もう一度）でも、もう一度見張れるように
      fired.current = false;
    };
  }, []);

  const tap = () => {
    if (typing) {
      setShown(text.length);
      return;
    }
    if (step.kind === 'tap') {
      audio.play('se_page');
      next();
    }
  };
  // タップの手順は、どこを押しても次へ（囲んだ所も押せない）。操作の手順は、囲んだ所だけ下の画面に届く
  const blocks = step.kind === 'tap' ? [{ x: -50, y: -50, w: 1380, h: 820 }] : blockedRects(holes);

  return (
    <div className={`guide post-guide post-guide--${step.at} guide--${step.kind === 'tap' ? 'tap' : 'act'} ${asking ? 'is-asking' : ''}`} data-testid="post-guide" data-step={step.id}>
      <svg className="guide__dim" viewBox="0 0 1280 720" aria-hidden>
        <defs>
          <mask id="post-guide-holes">
            <rect x="-50" y="-50" width="1380" height="820" fill="white" />
            {holes.map((h, i) => (
              <rect key={i} x={h.x} y={h.y} width={h.w} height={h.h} rx={14} fill="black" />
            ))}
          </mask>
        </defs>
        <rect x="-50" y="-50" width="1380" height="820" mask="url(#post-guide-holes)" />
      </svg>
      {blocks.map((b, i) => (
        <div key={i} className="guide__catcher" style={{ left: b.x, top: b.y, width: b.w, height: b.h }} onClick={tap} />
      ))}
      <svg className="guide__marks" viewBox="0 0 1280 720" aria-hidden>
        {holes.map((h, i) => (
          <ellipse key={i} className="guide__circle" cx={h.x + h.w / 2} cy={h.y + h.h / 2} rx={h.w / 2 + 14} ry={h.h / 2 + 12} />
        ))}
      </svg>
      <div className="post-guide__panel">
        <div className="post-guide__sensei" aria-hidden>
          <OtegeArt width={110} />
        </div>
        <div className="post-guide__balloon" onClick={tap} role="status" aria-live="polite">
          <RoughBox seed={`post-guide-${step.id}`} className="guide__box" paper radius={18}>
            <span className="guide__name pencil">
              {tr.tutorial.sensei}
              {st.review && <span className="post-guide__sample red-pen">{tr.tutorial.sample}</span>}
            </span>
            <p className="guide__text">
              <span className="sr-only">{text}</span>
              <span aria-hidden>
                {text.slice(0, shown)}
                <span className="guide__rest">{text.slice(shown)}</span>
              </span>
            </p>
            <div className="post-guide__foot">
              <button
                type="button"
                className="post-guide__skip pencil"
                onClick={(e) => {
                  e.stopPropagation();
                  setAsking(true);
                }}
                data-testid="post-skip"
              >
                {tr.tutorial.skip}
              </button>
              {step.kind === 'tap' && !typing && (
                <button type="button" className="guide__next blue-pen" data-testid="tutorial-next" onClick={(e) => (e.stopPropagation(), tap())}>
                  {tr.tutorial.tapNext} ▶
                </button>
              )}
            </div>
          </RoughBox>
        </div>
      </div>
      {flower && <Hanamaru at={flower} />}
      {/* 見本の時は、画面の上に「みほん」の判子（UPDATE_v2_1 §6-3） */}
      {st.review && (
        <div className="post-guide__stamp red-pen" data-testid="post-sample">
          {tr.tutorial.sample}
        </div>
      )}
      {asking && (
        <Dialog
          seed="post-skip"
          title={tr.tutorial.skipTitle}
          onClose={() => setAsking(false)}
          actions={
            <>
              <RoughButton seed="post-skip-no" onClick={() => setAsking(false)}>
                {tr.tutorial.skipNo}
              </RoughButton>
              <RoughButton seed="post-skip-yes" highlight onClick={() => finish(false)} data-testid="post-skip-yes">
                {tr.tutorial.skipYes}
              </RoughButton>
            </>
          }
        >
          {tr.tutorial.skipText}
        </Dialog>
      )}
    </div>
  );
}
