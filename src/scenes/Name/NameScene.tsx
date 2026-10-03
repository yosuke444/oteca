import { useRef, useState } from 'react';
import { audio } from '../../audio/audioManager';
import { useT } from '../../i18n/useT';
import { useNav } from '../../router';
import { NAME_MAX, clampText } from '../../save/saveData';
import { useSave } from '../../state/SaveContext';
import { OtegeArt } from '../../ui/common/OtegeArt';
import { RoughBox } from '../../ui/rough/RoughBox';
import { RoughButton } from '../../ui/rough/RoughButton';
import { tiltStyle } from '../../ui/rough/seed';
import './name.css';

/**
 * S12 なまえ（UPDATE_v2 §6T-1・SPEC §7 S12）。
 * 新しく始めた人が、タイトルのあとに名前を決める。決めたらチュートリアルへ。
 */
export function NameScene() {
  const { go } = useNav();
  const { save, update } = useSave();
  const tr = useT();
  const [name, setName] = useState(save.playerName);
  const [warn, setWarn] = useState(false);
  const done = useRef(false);

  const decide = () => {
    const v = clampText(name.trim(), NAME_MAX);
    if (!v) {
      setWarn(true);
      audio.play('se_error');
      return;
    }
    if (done.current) return;
    done.current = true;
    update((d) => void (d.playerName = v));
    go('tutorial');
  };

  return (
    <div className="name-scene" data-testid="name-scene">
      <h1 className="name-scene__title">
        <span className="tilt" style={tiltStyle('name-title')}>
          {tr.name.title}
        </span>
      </h1>
      <OtegeArt width={180} className="name-scene__art" />
      <RoughBox seed="name-box" className="name-scene__box" paper radius={14}>
        <p className="name-scene__text pencil">{tr.name.text(NAME_MAX)}</p>
        <input
          className="pen-input name-scene__input"
          value={name}
          aria-label={tr.name.aria}
          maxLength={NAME_MAX * 2}
          autoFocus
          data-testid="name-input"
          onChange={(e) => {
            setWarn(false);
            setName(clampText(e.target.value, NAME_MAX));
          }}
          onKeyDown={(e) => {
            // 日本語の変換を確定する Enter では決めない
            if (e.key === 'Enter' && !e.nativeEvent.isComposing && e.keyCode !== 229) decide();
          }}
        />
        {warn && <p className="name-scene__warn red-pen">{tr.name.empty}</p>}
        <p className="name-scene__safe red-pen">{tr.settings.nameWarn}</p>
      </RoughBox>
      <RoughButton seed="name-ok" className="name-scene__ok" highlight strokeWidth={3} onClick={decide} data-testid="name-ok">
        {tr.name.ok}
      </RoughButton>
    </div>
  );
}
