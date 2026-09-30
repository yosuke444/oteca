import { useEffect, useRef } from 'react';
import { audio } from '../../audio/audioManager';
import { useNav } from '../../router';
import { Logo, LOGO_DRAW_MS } from '../../ui/common/Logo';
import { OtegeArt } from '../../ui/common/OtegeArt';
import './title.css';

/**
 * S00 タイトル
 * ロゴが書き順どおりに描かれる → 「おてあげカードバトル」 → 「タップしてはじめる」が点滅。ロゴの横に おてあげの絵（動かさない）。
 * タップで音声を有効化して、メニューへ。
 */
export function TitleScene() {
  const { go } = useNav();
  const started = useRef(false);
  /** 1回だけメニューへ進む */
  const start = () => {
    if (started.current) return;
    started.current = true;
    audio.unlock();
    go('menu');
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat) return;
      if (e.key === 'Enter' || e.key === ' ') start();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go]);

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
      aria-label="タップして はじめる"
    >
      <div className="title-scene__logo-row">
        <Logo draw width={520} />
        <OtegeArt width={190} className="title-scene__art" />
      </div>
      <p className="title-scene__sub">おてあげカードバトル</p>
      <p className="title-scene__tap">タップして はじめる</p>
    </div>
  );
}
