import { gsap } from 'gsap';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { audio } from '../../audio/audioManager';
import { useFx } from '../../fx/fxSettings';
import { bigText, flash, paperScraps, shake } from '../../fx/paperFx';
import { play, wait } from '../../fx/timing';
import { local } from '../../i18n';
import { useLang, useT } from '../../i18n/useT';
import { type BossId, type StageDef, bossImagePath } from '../../story/story';
import { imageUrl } from '../../ui/imageFiles';
import { RoughBox } from '../../ui/rough/RoughBox';

/**
 * ボスの絵（public/story/boss_<id>.png）。無い時は、赤い手描き枠の中にボスの名前をペン文字で書く（UPDATE_v2 §11-2）。
 */
export function BossArt({ boss, name, small, dim }: { boss: BossId; name: string; small?: boolean; dim?: boolean }) {
  const url = imageUrl(bossImagePath(boss));
  return (
    <div className={`boss-art ${small ? 'boss-art--small' : ''} ${dim ? 'is-dim' : ''}`}>
      {url ? (
        <img src={url} alt="" draggable={false} />
      ) : (
        <span className="boss-art__name red-pen">{name}</span>
      )}
    </div>
  );
}

/**
 * ボス戦の前のカットイン（SPEC §7 S08）。迷ったら3倍豪華に：
 * 暗転 → 赤いフラッシュ と 画面のゆれ → 集中線 → ボスの絵が画面いっぱいに入ってくる → 「ボス」のはんこ → 名前 →
 * 赤ペンで「ボスルール：…」が書かれていく → 紙くずが舞う。タップで飛ばせる。演出スピード・演出をへらす に従う。
 */
export function BossCutin({ stage, onDone }: { stage: StageDef; onDone: () => void }) {
  const tr = useT();
  const lang = useLang();
  const fx = useFx();
  const rootRef = useRef<HTMLDivElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  const artRef = useRef<HTMLDivElement>(null);
  const nameRef = useRef<HTMLDivElement>(null);
  const ruleRef = useRef<HTMLDivElement>(null);
  const done = useRef(false);
  const [canSkip, setCanSkip] = useState(false);
  /** ジングルを止める（飛ばした時・画面を出た時） */
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
    const root = rootRef.current!;
    const run = async () => {
      stopJingle.current = audio.play('jingle_boss');
      gsap.set([artRef.current, nameRef.current, ruleRef.current], { opacity: 0 });
      await play(gsap.fromTo(root, { opacity: 0 }, { opacity: 1, duration: 0.25 }));
      if (!alive) return;
      if (!reduce) {
        // 集中線は出さない（v2.3。企画者の指示）
        flash(L, 0.8, 0.35);
        void shake(root, 16, 6);
      }
      // ボスの絵が右から大きく入ってくる
      await play(
        gsap.fromTo(
          artRef.current,
          { opacity: 0, x: reduce ? 0 : 900, scale: reduce ? 1 : 1.8, rotate: reduce ? 0 : 14 },
          { opacity: 1, x: 0, scale: 1, rotate: -3, duration: reduce ? 0.2 : 0.55, ease: 'power4.out' },
        ),
      );
      if (!alive) return;
      setCanSkip(true);
      // 「ボス」のはんこ
      cleanups.push(bigText(L, { x: 860, y: 160 }, tr.story.boss, 'boss-stamp', -14));
      if (!reduce) {
        void shake(root, 10, 4);
        paperScraps(L, { x: 860, y: 160 }, 14);
      }
      audio.play('se_stamp');
      await play(gsap.fromTo(nameRef.current, { opacity: 0, y: 40 }, { opacity: 1, y: 0, duration: 0.3, ease: 'back.out(2)' }));
      if (!alive) return;
      // 赤ペンで ボスルールが書かれていく（左から右へ見えていく）
      if (ruleRef.current) {
        audio.play('se_pen');
        await play(gsap.fromTo(ruleRef.current, { opacity: 1, clipPath: 'inset(0 100% 0 0)' }, { clipPath: 'inset(0 0% 0 0)', duration: reduce ? 0.2 : 1.3, ease: 'none' }));
      }
      if (!alive) return;
      await wait(2000);
      if (!alive) return;
      await play(gsap.to(root, { opacity: 0, duration: 0.3 }));
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
    <div className="boss-cutin" ref={rootRef} data-testid="boss-cutin" onClick={() => canSkip && finish()}>
      <div className="boss-cutin__band" aria-hidden />
      <div className="boss-cutin__art" ref={artRef}>
        {stage.boss && (
          <RoughBox seed={`cutin-${stage.no}`} className="boss-cutin__frame" stroke="var(--pen-red)" strokeWidth={5} double paper radius={16}>
            <BossArt boss={stage.boss} name={stage.name} />
          </RoughBox>
        )}
      </div>
      <div className="boss-cutin__name" ref={nameRef}>
        {stage.name}
      </div>
      {stage.bossRule && (
        <div className="boss-cutin__rule red-pen" ref={ruleRef}>
          {tr.story.cutinRule(local(stage.bossRule.text, lang))}
        </div>
      )}
      <div className="boss-cutin__layer" ref={layerRef} aria-hidden />
      {canSkip && <p className="boss-cutin__skip pencil">{tr.story.tapSkip}</p>}
    </div>
  );
}
