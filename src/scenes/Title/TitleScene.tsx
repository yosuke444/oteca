import { useEffect } from 'react';
import { audio } from '../../audio/audioManager';
import { useNav } from '../../router';
import { Logo, LOGO_DRAW_MS } from '../../ui/common/Logo';
import { OteageDoodle } from '../../ui/common/Doodles';
import './title.css';

/**
 * S00 タイトル
 * ロゴが書き順どおりに描かれる → 「おてあげカードバトル」 → 「タップしてはじめる」が点滅。
 * タップで音声を有効化して、メニューへ。
 */
export function TitleScene() {
  const { go } = useNav();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        audio.unlock();
        go('menu');
      }
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
        go('menu');
      }}
      role="button"
      aria-label="タップして はじめる"
    >
      <div className="title-scene__logo-row">
        <Logo draw width={520} />
        <OteageDoodle seed="title-oteage" size={150} className="title-scene__doodle" />
      </div>
      <p className="title-scene__sub">おてあげカードバトル</p>
      <p className="title-scene__tap">タップして はじめる</p>
    </div>
  );
}
