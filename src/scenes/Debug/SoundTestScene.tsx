import { useEffect, useState } from 'react';
import { audio } from '../../audio/audioManager';
import { checkAllSounds } from '../../audio/soundCheck';
import { BGM, type BgmKey, SE_KEYS, SE_LABEL, type SeKey } from '../../audio/soundMap';
import { recipeLength } from '../../audio/sfx/synth';
import { RECIPES } from '../../audio/sfx/recipes';
import { useNav } from '../../router';
import { useSave } from '../../state/SaveContext';
import './debug.css';

/** 重ねテスト（SPEC §10-4 の例と、演出で実際に重ねる組み合わせ） */
const LAYERS: { label: string; keys: SeKey[]; gapMs?: number }[] = [
  { label: 'おおきい ダメージ＋ペン＋はんこ', keys: ['se_hit_big', 'se_pen', 'se_stamp'] },
  { label: 'きぜつ → はんこ', keys: ['se_ko', 'se_stamp'], gapMs: 650 },
  { label: 'サイコロ ころがる → とまる', keys: ['se_dice_roll', 'se_dice_land'], gapMs: 900 },
  { label: 'カードを ひく＋おく＋テープ', keys: ['se_card_draw', 'se_card_place', 'se_tape'], gapMs: 150 },
  { label: 'アイテム かいふく＋かいふく', keys: ['se_item_kusuri', 'se_heal'], gapMs: 300 },
  { label: 'ちいさい ダメージ ×3 れんぞく', keys: ['se_hit_small', 'se_hit_small', 'se_hit_small'], gapMs: 120 },
];

/**
 * こうかおん テスト（SPEC §10-4。?debug=1 のメニューから）
 * 全部の効果音の再生、連打（同じ音を5回）、重ね。企画者はここで聞いて「○○をもっと低く」と調整を頼む。
 */
export function SoundTestScene() {
  const { go } = useNav();
  const { save } = useSave();
  const [last, setLast] = useState('');
  const [bgm, setBgm] = useState<BgmKey | null>(audio.bgmKey);

  useEffect(() => {
    audio.unlock();
    // 自動チェック用（Playwright から全部の音の大きさと長さを測る）
    (window as unknown as { __otecaSoundCheck?: typeof checkAllSounds }).__otecaSoundCheck = checkAllSounds;
  }, []);

  const play = (key: SeKey) => {
    audio.unlock();
    audio.play(key);
    setLast(`${key}（${recipeLength(RECIPES[key]).toFixed(2)}びょう）`);
  };
  const burst = (key: SeKey) => {
    audio.unlock();
    for (let i = 0; i < 5; i++) window.setTimeout(() => audio.play(key), i * 110);
    setLast(`${key} × 5`);
  };
  const layer = (l: (typeof LAYERS)[number]) => {
    audio.unlock();
    l.keys.forEach((k, i) => window.setTimeout(() => audio.play(k), i * (l.gapMs ?? 0)));
    setLast(l.label);
  };
  const switchBgm = (k: BgmKey | null) => {
    audio.unlock();
    audio.playBgm(k);
    setBgm(k);
  };

  return (
    <div className="soundtest" data-testid="soundtest">
      <div className="soundtest__head">
        <h1 className="soundtest__title">こうかおん テスト</h1>
        <span className="soundtest__vol pencil">
          おんりょう：こうかおん {save.settings.se}／BGM {save.settings.bgm}（せっていで かえられるよ）
        </span>
        <button type="button" className="fxtest-btn soundtest__back" onClick={() => go('debug')}>
          もどる
        </button>
      </div>
      <div className="soundtest__grid">
        {SE_KEYS.map((k) => (
          <div key={k} className="soundtest__row">
            <span className="soundtest__label">
              {SE_LABEL[k]}
              <small className="pencil"> {k}</small>
            </span>
            <button type="button" className="fxtest-btn" data-se={k} onClick={() => play(k)}>
              ▶ きく
            </button>
            <button type="button" className="fxtest-btn" data-burst={k} onClick={() => burst(k)}>
              ×5
            </button>
          </div>
        ))}
      </div>
      <div className="soundtest__bottom">
        <div className="soundtest__layers">
          <b>かさね：</b>
          {LAYERS.map((l) => (
            <button key={l.label} type="button" className="fxtest-btn" onClick={() => layer(l)}>
              {l.label}
            </button>
          ))}
        </div>
        <div className="soundtest__layers">
          <b>BGM：</b>
          {(Object.keys(BGM) as BgmKey[]).map((k) => (
            <button key={k} type="button" className={`fxtest-btn ${bgm === k ? 'is-on' : ''}`} onClick={() => switchBgm(k)}>
              {k}
            </button>
          ))}
          <button type="button" className="fxtest-btn" onClick={() => switchBgm(null)}>
            とめる
          </button>
          <span className="pencil soundtest__note">（public/audio/bgm/ に ファイルが ないと むおん）</span>
        </div>
        <p className="soundtest__last" data-testid="last-played">
          {last && `いま：${last}`}
        </p>
      </div>
    </div>
  );
}
