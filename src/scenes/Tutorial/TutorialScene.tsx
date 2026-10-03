import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { audio } from '../../audio/audioManager';
import { type BattleSetup, randomSeed } from '../../battle/setup';
import type { Side } from '../../engine/types';
import { useFx } from '../../fx/fxSettings';
import { offerById } from '../../gacha/gacha';
import { useT } from '../../i18n/useT';
import { useNav } from '../../router';
import { useSave } from '../../state/SaveContext';
import { ME, TutorialDriver, tutorialMatch } from '../../tutorial/driver';
import { Dialog } from '../../ui/common/Dialog';
import { OtegeArt } from '../../ui/common/OtegeArt';
import { RoughBox } from '../../ui/rough/RoughBox';
import { RoughButton } from '../../ui/rough/RoughButton';
import { BattleScene } from '../Battle/BattleScene';
import { startPost } from '../../tutorial/post';
import { TUTORIAL_OFFER } from './PostGuide';
import './tutorial.css';


/**
 * S13 チュートリアル（UPDATE_v2 §6T・SPEC §7 S13）。
 * 対戦画面の上に「おてあげせんせい」の案内を重ねる。台本は src/data/tutorial.json。
 * 勝敗・コイン・レートには数えない（リザルトへ進まない）。右上の「スキップ」でいつでも抜けられる。
 */
export function TutorialScene() {
  const { go } = useNav();
  const { save, update } = useSave();
  const tr = useT();
  // 見返し（ルールせつめい・せってい から。もう終えた人）：延長のガチャは見本、デッキ編集は練習用の写し（UPDATE_v2_1 §6-3）。
  // 初めてでも、15まい を引くコインが無い時（アップデートの おしらせ から来て コインを使っていた人）は、ガチャを見本にする
  const [review] = useState(() => {
    const offer = offerById(TUTORIAL_OFFER);
    return save.tutorial.done || !offer || save.coins < offer.price;
  });
  /** 初めて（まだ終えていない）：終えた・とばした時に印を書く */
  const [first] = useState(() => !save.tutorial.done);
  const [driver] = useState(() => new TutorialDriver());
  const [setup] = useState<BattleSetup>(() => ({
    mode: 'cpu',
    // 見返す時も、いまの初期デッキに関係なく、台本の15枚（初期カード）を使う。サイコロ・山札の順番も台本（自動テストと同じ関数）
    ...tutorialMatch(),
    names: { p1: save.playerName, p2: tr.tutorial.oppName },
    seed: randomSeed(),
    me: ME,
    record: false,
    cpuLevel: 'weak',
    tutorial: true,
  }));
  const [winner, setWinner] = useState<Side | null>(null);
  const [asking, setAsking] = useState(false);

  /** とばした印（次から自動では始めない） */
  const markDone = () => update((d) => void (d.tutorial.done = true));
  /** 対戦が終わった：延長（#16 パックガチャから）へ。初めての人は、途中で閉じても #16 から再開できるように step を書く */
  const toPost = () => {
    startPost(review, first);
    go('menu');
  };

  return (
    <div className="tutorial-scene" data-testid="tutorial-scene">
      {winner === null ? (
        <BattleScene
          setup={setup}
          guide={{
            driver,
            onOver: (w) => {
              // 初めての人は、対戦が終わった時点で再開位置を書く（このあと閉じても #16 から）
              if (first) update((d) => void (d.tutorial.step = Math.max(d.tutorial.step, 16)));
              setWinner(w);
            },
            // 案内の途中の「戻る」・「おてあげする」は、スキップの確認にする
            onQuit: () => setAsking(true),
            hidden: asking,
          }}
        />
      ) : (
        <TutorialEnd won={winner === ME} onNext={toPost} />
      )}

      {winner === null && (
        <RoughButton seed="tutorial-skip" className="tutorial-scene__skip" onClick={() => setAsking(true)} data-testid="tutorial-skip">
          {tr.tutorial.skip}
        </RoughButton>
      )}
      {asking && (
        <Dialog
          seed="tutorial-skip"
          title={tr.tutorial.skipTitle}
          onClose={() => setAsking(false)}
          actions={
            <>
              <RoughButton seed="tutorial-skip-no" onClick={() => setAsking(false)}>
                {tr.tutorial.skipNo}
              </RoughButton>
              <RoughButton
                seed="tutorial-skip-yes"
                highlight
                onClick={() => {
                  markDone();
                  go('menu');
                }}
              >
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

/** 1文字ずつ出す（演出スピードに合わせる。演出をへらす時は一度に出す） */
function useTypewriter(text: string): [number, () => void] {
  const fx = useFx();
  const [shown, setShown] = useState(0);
  // 文が変わった時に、前の文の長さのまま1コマ描かないように、描く前に戻す
  useLayoutEffect(() => {
    if (fx.reduceFx) {
      setShown(text.length);
      return;
    }
    setShown(0);
    const id = window.setInterval(() => setShown((n) => (n >= text.length ? (window.clearInterval(id), n) : n + 1)), 42 / fx.speed);
    return () => window.clearInterval(id);
  }, [text, fx.reduceFx, fx.speed]);
  return [shown, () => setShown(text.length)];
}

/**
 * 対戦が終わった後（UPDATE_v2_1 §6-2）：勝っても負けても励まし、タップで延長（#16 パックガチャ）へ
 */
function TutorialEnd({ won, onNext }: { won: boolean; onNext: () => void }) {
  const tr = useT();
  const text = won ? tr.tutorial.won : tr.tutorial.lost;
  const [shown, finish] = useTypewriter(text);
  const typing = shown < text.length;
  const went = useRef(false);
  useEffect(() => {
    audio.play(won ? 'se_sou' : 'se_page');
  }, []);
  return (
    <div
      className="tutorial-end"
      data-testid="tutorial-end"
      onClick={() => {
        if (typing) finish();
        else if (!went.current) {
          went.current = true;
          onNext();
        }
      }}
    >
      <OtegeArt width={300} className="tutorial-end__sensei" />
      <div className="tutorial-end__balloon">
        <RoughBox seed="tutorial-end" className="tutorial-end__box" paper radius={22}>
          <span className="guide__name pencil">{tr.tutorial.sensei}</span>
          <p className="tutorial-end__text">
            <span className="sr-only">{text}</span>
            <span aria-hidden>
              {text.slice(0, shown)}
              <span className="guide__rest">{text.slice(shown)}</span>
            </span>
          </p>
          {!typing && (
            <button type="button" className="guide__next blue-pen" ref={(e) => e?.focus({ preventScroll: true })} data-testid="tutorial-end-next">
              {tr.tutorial.tapNext} ▶
            </button>
          )}
        </RoughBox>
      </div>
    </div>
  );
}
