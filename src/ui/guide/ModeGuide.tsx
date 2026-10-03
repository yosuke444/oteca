import { gsap } from 'gsap';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { audio } from '../../audio/audioManager';
import { DAILY } from '../../daily/daily';
import { type GuideMode, type GuideWords, guideNumbers } from '../../guide/guideData';
import { useFx } from '../../fx/fxSettings';
import { useT } from '../../i18n/useT';
import { Dialog } from '../common/Dialog';
import { RoughBox } from '../rough/RoughBox';
import { RoughButton } from '../rough/RoughButton';
import './guide.css';

/**
 * 「このモードの せつめい」（SPEC §7 共通・UPDATE_v2_1 §5）。各モードの最初の画面の上部に置く。
 * 手描きの枠に2〜3行の短い説明。右上の「？」で詳しい説明（1〜3ページ。ノートをめくる形）。
 * 短い説明は小さくたためる（たたんだかはモードごとに、この端末に覚える）。
 */

const FOLD_KEY = 'oteca.guideFolded';

function readFolded(): Record<string, boolean> {
  try {
    const v = JSON.parse(window.localStorage.getItem(FOLD_KEY) ?? '{}');
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
}

function writeFolded(mode: GuideMode, folded: boolean): void {
  try {
    window.localStorage.setItem(FOLD_KEY, JSON.stringify({ ...readFolded(), [mode]: folded }));
  } catch {
    // 覚えられなくても、今の画面ではたためる
  }
}

export function ModeGuide({ mode, className }: { mode: GuideMode; className?: string }) {
  const tr = useT();
  const nums = useMemo(() => guideNumbers(), []);
  const words: GuideWords = { levels: tr.cpu.level, levelNotes: tr.cpu.levelNote, missions: DAILY.missions.map((m) => tr.daily.mission[m.id](m.target)) };
  const g = tr.guide.modes[mode](nums, words);
  const [folded, setFolded] = useState(() => !!readFolded()[mode]);
  const [help, setHelp] = useState(false);
  const fold = (v: boolean) => {
    setFolded(v);
    writeFolded(mode, v);
    audio.play('se_page');
  };
  return (
    <div className={`mode-guide ${folded ? 'is-folded' : ''} ${className ?? ''}`} data-testid={`mode-guide-${mode}`}>
      {folded ? (
        <button type="button" className="mode-guide__tab" onClick={() => fold(false)} data-testid="mode-guide-unfold" aria-label={tr.guide.unfoldAria}>
          <span className="mode-guide__tab-label">{tr.guide.tab}</span>
          <span className="mode-guide__tab-arrow" aria-hidden>
            ▼
          </span>
        </button>
      ) : (
        <RoughBox seed={`guide-${mode}`} className="mode-guide__box" paper radius={10} strokeWidth={2.4}>
          <div className="mode-guide__lines">
            {g.short.map((line, i) => (
              <p key={i} className="mode-guide__line">
                {line}
              </p>
            ))}
          </div>
        </RoughBox>
      )}
      <div className="mode-guide__side">
        <RoughButton seed={`guide-help-${mode}`} className="mode-guide__help" ariaLabel={tr.guide.helpAria} onClick={() => setHelp(true)} data-testid="mode-guide-help">
          {tr.guide.helpMark}
        </RoughButton>
        {!folded && (
          <RoughButton seed={`guide-fold-${mode}`} className="mode-guide__fold" ariaLabel={tr.guide.foldAria} onClick={() => fold(true)} data-testid="mode-guide-fold">
            {tr.guide.fold}
          </RoughButton>
        )}
      </div>
      {help && <GuidePages title={g.title} pages={g.pages} onClose={() => setHelp(false)} />}
    </div>
  );
}

/** 詳しい説明：1〜3ページ。「つぎへ」「まえへ」でノートのページをめくる */
function GuidePages({ title, pages, onClose }: { title: string; pages: { title: string; lines: string[] }[]; onClose: () => void }) {
  const tr = useT();
  const fx = useFx();
  const [page, setPage] = useState(0);
  const bodyRef = useRef<HTMLDivElement>(null);
  const turning = useRef(false);
  const p = pages[page];

  // ページが変わった：新しいページが右からめくれて開く
  const dir = useRef(1);
  useLayoutEffect(() => {
    const el = bodyRef.current;
    if (!el || fx.reduceFx) return;
    gsap.killTweensOf(el);
    const t = gsap.fromTo(el, { rotateY: dir.current * 70, opacity: 0.2, transformOrigin: dir.current > 0 ? '0% 50%' : '100% 50%' }, { rotateY: 0, opacity: 1, duration: fx.dur(320) / 1000, ease: 'power2.out' });
    return () => void t.kill();
  }, [page, fx.reduceFx]);
  // 閉じた時に、めくっている途中の動きを止める
  useEffect(() => () => void (bodyRef.current && gsap.killTweensOf(bodyRef.current)), []);

  const go = async (d: 1 | -1) => {
    const next = page + d;
    if (next < 0 || next >= pages.length || turning.current) return;
    turning.current = true;
    audio.play('se_page');
    dir.current = d;
    const el = bodyRef.current;
    if (el && !fx.reduceFx) {
      // 今のページが左へめくれていく（開いている途中の動きは止めてから）
      gsap.killTweensOf(el);
      await new Promise<void>((resolve) =>
        gsap.to(el, { rotateY: -d * 70, opacity: 0.2, transformOrigin: d > 0 ? '100% 50%' : '0% 50%', duration: fx.dur(220) / 1000, ease: 'power2.in', onComplete: () => resolve(), onInterrupt: () => resolve() }),
      );
    }
    turning.current = false;
    setPage(next);
  };

  return (
    <Dialog
      seed="guide-pages"
      title={title}
      width={860}
      onClose={onClose}
      actions={
        <>
          <RoughButton seed="guide-prev" disabled={page === 0} onClick={() => void go(-1)} data-testid="guide-prev">
            {tr.guide.prev}
          </RoughButton>
          <span className="guide-pages__count num" data-testid="guide-page">
            {tr.guide.page(page + 1, pages.length)}
          </span>
          {page < pages.length - 1 ? (
            <RoughButton seed="guide-next" highlight onClick={() => void go(1)} data-testid="guide-next">
              {tr.guide.next}
            </RoughButton>
          ) : (
            <RoughButton seed="guide-close" highlight onClick={onClose} data-testid="guide-close">
              {tr.common.close}
            </RoughButton>
          )}
        </>
      }
    >
      <div className="guide-pages" data-testid="guide-pages">
        <div className="guide-pages__paper" ref={bodyRef}>
          <h3 className="guide-pages__title">{p.title}</h3>
          <ul className="guide-pages__lines">
            {p.lines.map((l, i) => (
              <li key={i}>{l}</li>
            ))}
          </ul>
        </div>
      </div>
    </Dialog>
  );
}
