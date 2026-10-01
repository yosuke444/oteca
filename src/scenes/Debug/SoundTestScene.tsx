import { useEffect, useState } from 'react';
import { audio } from '../../audio/audioManager';
import { checkAllSounds } from '../../audio/soundCheck';
import { BGM, type BgmKey, SE_KEYS, type SeKey, battleTracks } from '../../audio/soundMap';
import { recipeLength } from '../../audio/sfx/synth';
import { RECIPES } from '../../audio/sfx/recipes';
import { useNav } from '../../router';
import { useSave } from '../../state/SaveContext';
import './debug.css';
import { useT } from '../../i18n/useT';

/** 重ねテスト（SPEC §10-4 の例と、演出で実際に重ねる組み合わせ） */
const LAYERS: { id: 'bigHit' | 'ko' | 'dice' | 'card' | 'heal' | 'smallHits'; keys: SeKey[]; gapMs?: number }[] = [
  { id: 'bigHit', keys: ['se_hit_big', 'se_pen', 'se_stamp'] },
  { id: 'ko', keys: ['se_ko', 'se_stamp'], gapMs: 650 },
  { id: 'dice', keys: ['se_dice_roll', 'se_dice_land'], gapMs: 900 },
  { id: 'card', keys: ['se_card_draw', 'se_card_place', 'se_tape'], gapMs: 150 },
  { id: 'heal', keys: ['se_item_kusuri', 'se_heal'], gapMs: 300 },
  { id: 'smallHits', keys: ['se_hit_small', 'se_hit_small', 'se_hit_small'], gapMs: 120 },
];

/**
 * こうかおん テスト（SPEC §10-4。?debug=1 のメニューから）
 * 全部の効果音の再生、連打（同じ音を5回）、重ね。企画者はここで聞いて「○○をもっと低く」と調整を頼む。
 */
export function SoundTestScene() {
  const { go } = useNav();
  const { save } = useSave();
  const tr = useT();
  const S = tr.debug.sound;
  const [last, setLast] = useState('');
  const [bgm, setBgm] = useState<BgmKey | null>(audio.bgmKey);
  // いま流れている戦闘曲（曲が切りかわるのを目で見られるように）
  const [song, setSong] = useState<string | null>(null);
  useEffect(() => {
    const id = window.setInterval(() => setSong(audio.battleSong), 300);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    audio.unlock();
    // 自動チェック用（Playwright から全部の音の大きさと長さを測る）
    (window as unknown as { __otecaSoundCheck?: typeof checkAllSounds }).__otecaSoundCheck = checkAllSounds;
  }, []);

  const play = (key: SeKey) => {
    audio.unlock();
    audio.play(key);
    setLast(S.seconds(key, recipeLength(RECIPES[key]).toFixed(2)));
  };
  const burst = (key: SeKey) => {
    audio.unlock();
    for (let i = 0; i < 5; i++) window.setTimeout(() => audio.play(key), i * 110);
    setLast(`${key} × 5`);
  };
  const layer = (l: (typeof LAYERS)[number]) => {
    audio.unlock();
    l.keys.forEach((k, i) => window.setTimeout(() => audio.play(k), i * (l.gapMs ?? 0)));
    setLast(S.layer[l.id]);
  };
  const switchBgm = (k: BgmKey | null) => {
    audio.unlock();
    audio.playBgm(k);
    setBgm(k);
  };

  return (
    <div className="soundtest" data-testid="soundtest">
      <div className="soundtest__head">
        <h1 className="soundtest__title">{S.title}</h1>
        <span className="soundtest__vol pencil">
          {S.volume(save.settings.se, save.settings.bgm)}
        </span>
        <button type="button" className="fxtest-btn soundtest__back" onClick={() => go('debug')}>
          {tr.common.back}
        </button>
      </div>
      <div className="soundtest__grid">
        {SE_KEYS.map((k) => (
          <div key={k} className="soundtest__row">
            <span className="soundtest__label">
              {S.se[k]}
              <small className="pencil"> {k}</small>
            </span>
            <button type="button" className="fxtest-btn" data-se={k} onClick={() => play(k)}>
              {S.play}
            </button>
            <button type="button" className="fxtest-btn" data-burst={k} onClick={() => burst(k)}>
              ×5
            </button>
          </div>
        ))}
      </div>
      <div className="soundtest__bottom">
        <div className="soundtest__layers">
          <b>{S.layers}</b>
          {LAYERS.map((l) => (
            <button key={l.id} type="button" className="fxtest-btn" onClick={() => layer(l)}>
              {S.layer[l.id]}
            </button>
          ))}
        </div>
        <div className="soundtest__layers">
          <b>{S.bgm}</b>
          {([...Object.keys(BGM), 'battle'] as BgmKey[]).map((k) => (
            <button key={k} type="button" className={`fxtest-btn ${bgm === k ? 'is-on' : ''}`} onClick={() => switchBgm(k)}>
              {k === 'battle' ? S.battle(battleTracks.length) : k}
            </button>
          ))}
          <button type="button" className="fxtest-btn" onClick={() => switchBgm(null)}>
            {S.stop}
          </button>
          <button type="button" className="fxtest-btn" onClick={() => audio.seekNearEnd(5)}>
            {S.toEnd}
          </button>
          <span className="soundtest__note" data-testid="bgm-now">
            {song && S.now(song)}
          </span>
          <span className="pencil soundtest__note">{S.noFile}</span>
        </div>
        <p className="soundtest__last" data-testid="last-played">
          {last && S.now(last)}
        </p>
      </div>
    </div>
  );
}
