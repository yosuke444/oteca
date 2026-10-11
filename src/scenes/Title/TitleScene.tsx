import { useEffect, useRef } from 'react';
import { audio } from '../../audio/audioManager';
import { useNav } from '../../router';
import { Logo, LOGO_DRAW_MS } from '../../ui/common/Logo';
import { OtegeArt } from '../../ui/common/OtegeArt';
import { useT } from '../../i18n/useT';
import { useSave } from '../../state/SaveContext';
import { startPost, titleNext } from '../../tutorial/post';
import { offerById } from '../../gacha/gacha';
import { TUTORIAL_OFFER } from '../Tutorial/PostGuide';
import './title.css';
import { startIdlePreload } from '../../ui/idlePreload';

/**
 * S00 タイトル
 * ロゴが書き順どおりに描かれる → 「おてあげカードバトル」 → 「タップしてはじめる」が点滅。ロゴの横に おてあげの絵（動かさない）。
 * タップで音声を有効化して、メニューへ（新しく始めた人は なまえ → チュートリアルへ）。
 */
export function TitleScene() {
  // タイトルが出たら、空いている時間に全カードの絵を先に読んでおく（v2.4。起動は遅くしない）
  useEffect(() => startIdlePreload(), []);
  const { go } = useNav();
  const tr = useT();
  const { save } = useSave();
  const started = useRef(false);
  /** 1回だけメニューへ進む */
  const start = () => {
    if (started.current) return;
    started.current = true;
    audio.unlock();
    // 新しく始めた人は、ことば → 名前 → チュートリアルへ（UPDATE_v2_1 §6-1）。古いセーブから来た人はメニューの おしらせ で聞く
    // 延長（ガチャ・デッキ編集）の途中で閉じた人は、そこから再開（UPDATE_v2_1 §7）
    const next = titleNext(save.tutorial, save.updateNoticeSeen, save.coins, offerById(TUTORIAL_OFFER)?.price ?? 0);
    if (next.post !== undefined) startPost(false, true, next.post);
    go(next.go);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat) return;
      if (e.key === 'Enter' || e.key === ' ') start();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go, save]);

  return (
    <div
      className="title-scene"
      style={{ ['--logo-ms' as string]: LOGO_DRAW_MS }}
      onClick={() => {
        // タップで音を有効にする（スマホの自動再生制限のため。SPEC §7 S00）
        audio.unlock();
        audio.play('se_click');
        start();
      }}
      role="button"
      aria-label={tr.title.tap}
    >
      <div className="title-scene__logo-row">
        <Logo draw width={520} />
        <OtegeArt width={190} className="title-scene__art" />
      </div>
      <p className="title-scene__sub">{tr.title.sub}</p>
      <p className="title-scene__tap">{tr.title.tap}</p>
    </div>
  );
}
