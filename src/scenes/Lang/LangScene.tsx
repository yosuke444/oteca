import { useRef } from 'react';
import { audio } from '../../audio/audioManager';
import type { Lang } from '../../i18n';
import { useT } from '../../i18n/useT';
import { useNav } from '../../router';
import { useSave } from '../../state/SaveContext';
import { OtegeArt } from '../../ui/common/OtegeArt';
import { RoughButton } from '../../ui/rough/RoughButton';
import { tiltStyle } from '../../ui/rough/seed';
import './lang.css';

/**
 * ことばを えらぶ（UPDATE_v2_1 §6-1）。新しく始めた人だけ、タイトルのあと・名前の前に出す。
 * 「にほんご」「日本語」の大きなボタンに、見本の1行。選んだら すぐ設定に保存して、名前へ（ここから選んだ言語）。
 */
export function LangScene() {
  const { go } = useNav();
  const { update } = useSave();
  const tr = useT();
  const done = useRef(false);
  const pick = (lang: Lang) => {
    if (done.current) return;
    done.current = true;
    audio.play('se_sou');
    update((d) => void (d.settings.lang = lang));
    go('name');
  };
  return (
    <div className="lang-scene" data-testid="lang-scene">
      <h1 className="lang-scene__title">
        <span className="tilt" style={tiltStyle('lang-title')}>
          {tr.langPick.title}
        </span>
      </h1>
      <OtegeArt width={170} className="lang-scene__art" />
      <div className="lang-scene__choices">
        {(['hira', 'kanji'] as const).map((l) => (
          <RoughButton key={l} seed={`lang-${l}`} className="lang-scene__btn" strokeWidth={3} onClick={() => pick(l)} data-testid={`lang-${l}`}>
            <span className="lang-scene__label">
              {tr.langPick.options[l].label}
              <small>{tr.langPick.options[l].sample}</small>
            </span>
          </RoughButton>
        ))}
      </div>
      <p className="lang-scene__note pencil">{tr.langPick.note}</p>
    </div>
  );
}
