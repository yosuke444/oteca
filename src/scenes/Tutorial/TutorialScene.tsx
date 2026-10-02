import { useEffect, useLayoutEffect, useState } from 'react';
import { audio } from '../../audio/audioManager';
import { type BattleSetup, randomSeed } from '../../battle/setup';
import { PACK_DATA } from '../../data/packs';
import type { Side } from '../../engine/types';
import { useFx } from '../../fx/fxSettings';
import { offerById } from '../../gacha/gacha';
import { useT } from '../../i18n/useT';
import { useNav } from '../../router';
import { useSave } from '../../state/SaveContext';
import { ME, TutorialDriver, tutorialMatch } from '../../tutorial/driver';
import { features } from '../../config/features';
import { Dialog } from '../../ui/common/Dialog';
import { OtegeArt } from '../../ui/common/OtegeArt';
import { RoughBox } from '../../ui/rough/RoughBox';
import { RoughButton } from '../../ui/rough/RoughButton';
import { BattleScene } from '../Battle/BattleScene';
import type { GachaPayload } from '../Gacha/GachaScene';
import './tutorial.css';

/** チュートリアルの最後に案内するパックと買い方（UPDATE_v2 §6T-6） */
const INVITE_PACK = 'ganso';
const INVITE_OFFER = 'fifteen';

/**
 * S13 チュートリアル（UPDATE_v2 §6T・SPEC §7 S13）。
 * 対戦画面の上に「おてあげせんせい」の案内を重ねる。台本は src/data/tutorial.json。
 * 勝敗・コイン・レートには数えない（リザルトへ進まない）。右上の「スキップ」でいつでも抜けられる。
 */
export function TutorialScene() {
  const { go } = useNav();
  const { save, update } = useSave();
  const tr = useT();
  // 見返し（パックガチャへの案内を出さない）：まだ案内していない人（初めて・デバッグで はじめから）には案内する。
  // ガチャが無い・15まい を引くコインが無い時も、案内は出さない
  const [review] = useState(() => {
    const offer = offerById(INVITE_OFFER);
    return save.tutorial.gachaInviteShown || !features.gacha || !offer || save.coins < offer.price;
  });
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

  /** 終えた・とばした印（次から自動では始めない） */
  const markDone = () => update((d) => void (d.tutorial.done = true));

  return (
    <div className="tutorial-scene" data-testid="tutorial-scene">
      {winner === null ? (
        <BattleScene
          setup={setup}
          guide={{
            driver,
            onOver: (w) => {
              markDone();
              setWinner(w);
            },
            // 案内の途中の「戻る」・「おてあげする」は、スキップの確認にする
            onQuit: () => setAsking(true),
            hidden: asking,
          }}
        />
      ) : (
        <TutorialEnd
          won={winner === ME}
          review={review}
          onMenu={() => go('menu')}
          onGacha={() => {
            update((d) => void (d.tutorial.gachaInviteShown = true));
            const payload: GachaPayload = { packId: INVITE_PACK, guideOffer: INVITE_OFFER };
            go('gacha', payload);
          }}
        />
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
 * 終わった後（UPDATE_v2 §6T-6）。
 * 負けても励ます → 初めて：パックガチャへの案内（ひいてみる！／あとで）。見返し：「おつかれさま！」でメニューへ
 */
function TutorialEnd({ won, review, onMenu, onGacha }: { won: boolean; review: boolean; onMenu: () => void; onGacha: () => void }) {
  const tr = useT();
  const { save } = useSave();
  const [page, setPage] = useState(0);
  const pack = PACK_DATA.packs.find((p) => p.id === INVITE_PACK)!;
  const bags = offerById(INVITE_OFFER)?.bags ?? 0;
  const texts = [won ? tr.tutorial.won : tr.tutorial.lost, review ? tr.tutorial.reviewEnd : tr.tutorial.invite(save.coins, pack.name, bags)];
  const text = texts[page];
  const [shown, finish] = useTypewriter(text);
  const typing = shown < text.length;
  useEffect(() => {
    audio.play(page === 0 ? (won ? 'se_sou' : 'se_page') : 'se_present');
  }, [page]);

  return (
    <div
      className="tutorial-end"
      data-testid="tutorial-end"
      onClick={() => {
        if (typing) finish();
        else if (page === 0) setPage(1);
      }}
    >
      <OtegeArt width={300} className="tutorial-end__sensei" />
      <div className="tutorial-end__balloon">
        <RoughBox seed={`tutorial-end-${page}`} className="tutorial-end__box" paper radius={22}>
          <span className="guide__name pencil">{tr.tutorial.sensei}</span>
          <p className="tutorial-end__text">
            <span className="sr-only">{text}</span>
            <span aria-hidden>
              {text.slice(0, shown)}
              <span className="guide__rest">{text.slice(shown)}</span>
            </span>
          </p>
          {page === 0 && !typing && (
            <button type="button" className="guide__next blue-pen" ref={(e) => e?.focus({ preventScroll: true })} data-testid="tutorial-end-next">
              {tr.tutorial.tapNext} ▶
            </button>
          )}
        </RoughBox>
      </div>
      {page === 1 && !typing && (
        <div className="tutorial-end__buttons" onClick={(e) => e.stopPropagation()}>
          {review ? (
            <RoughButton seed="tutorial-end-menu" highlight className="tutorial-end__btn" onClick={onMenu} data-testid="tutorial-menu">
              {tr.tutorial.toMenu}
            </RoughButton>
          ) : (
            <>
              <RoughButton seed="tutorial-end-later" className="tutorial-end__btn" onClick={onMenu} data-testid="tutorial-later">
                {tr.tutorial.later}
              </RoughButton>
              <RoughButton seed="tutorial-end-gacha" highlight strokeWidth={3} className="tutorial-end__btn tutorial-end__btn--gacha" onClick={onGacha} data-testid="tutorial-gacha">
                {tr.tutorial.tryGacha}
              </RoughButton>
            </>
          )}
        </div>
      )}
    </div>
  );
}
