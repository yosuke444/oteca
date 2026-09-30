import { useState } from 'react';
import { features } from '../../config/features';
import { isDebugMode, useNav } from '../../router';
import { RoughBox } from '../../ui/rough/RoughBox';
import { RoughButton } from '../../ui/rough/RoughButton';
import { tiltStyle } from '../../ui/rough/seed';
import { Logo } from '../../ui/common/Logo';
import { Sticky } from '../../ui/common/Sticky';
import { DiceDoodle, StarDoodle } from '../../ui/common/Doodles';
import { OtegeArt } from '../../ui/common/OtegeArt';
import { useSave } from '../../state/SaveContext';
import './menu.css';

type LockedId = 'story' | 'gacha';

/** S01 メニュー（SPEC §7） */
export function MenuScene() {
  const { go } = useNav();
  const debug = isDebugMode();
  const { save, remindBackup } = useSave();
  // 🔒 じゅんびちゅう のふせんを揺らす合図（押した回数）
  const [shake, setShake] = useState<Record<LockedId, number>>({ story: 0, gacha: 0 });

  const pressLocked = (id: LockedId) => {
    // 機能フラグが ON になったら、その画面へ進む
    if (features[id]) {
      go(id);
      return;
    }
    setShake((s) => ({ ...s, [id]: s[id] + 1 }));
  };

  return (
    <div className="menu-scene">
      {/* 上の帯：小さいロゴ／コイン／なまえ／設定 */}
      <Logo width={170} className="menu-scene__logo" />
      <div className="menu-scene__top-right">
        {features.coins && (
          <RoughBox seed="menu-coins" className="menu-scene__coins" radius={20}>
            <span className="num">{save.coins}</span>
          </RoughBox>
        )}
        <RoughBox seed="menu-name" className="menu-scene__name" paper>
          <span className="tilt" style={tiltStyle('menu-name')}>
            {save.playerName}
          </span>
        </RoughBox>
        <RoughButton seed="menu-settings" className="menu-scene__gear" ariaLabel="せってい" onClick={() => go('settings')}>
          <GearIcon />
        </RoughButton>
      </div>

      {/* 左：フレンドたいせん（いちばん大きい）とロック中の2つ */}
      <RoughButton seed="menu-friend" className="menu-scene__friend" strokeWidth={3} onClick={() => go('lobby')}>
        <span className="menu-scene__friend-label">
          フレンドたいせん
          <small>ともだちと あそぶ</small>
        </span>
      </RoughButton>

      <LockedButton id="story" label="ストーリー" shake={shake.story} onPress={pressLocked} />
      <LockedButton id="gacha" label="ガチャ" shake={shake.gacha} onPress={pressLocked} />

      {/* 右：デッキ・ルール（・デバッグ） */}
      <RoughButton seed="menu-deck" className="menu-scene__sub menu-scene__deck" onClick={() => go('deck')}>
        デッキへんしゅう
      </RoughButton>
      <RoughButton seed="menu-rules" className="menu-scene__sub menu-scene__rules" onClick={() => go('rules')}>
        ルールせつめい
      </RoughButton>
      {debug && (
        <RoughButton
          seed="menu-debug"
          className="menu-scene__sub menu-scene__debug"
          stroke="var(--pen-red)"
          onClick={() => go('debug')}
        >
          <span className="menu-scene__debug-label">デバッグ たいせん</span>
        </RoughButton>
      )}
      {debug && (
        <RoughButton seed="menu-soundtest" className="menu-scene__sub menu-scene__debug menu-scene__soundtest" stroke="var(--pen-red)" onClick={() => go('soundtest')}>
          <span className="menu-scene__debug-label">こうかおん テスト</span>
        </RoughButton>
      )}

      {/* データを まもろう（SPEC §12-6） */}
      {remindBackup && (
        <button type="button" className="menu-scene__backup" onClick={() => go('settings')}>
          <Sticky seed="menu-backup" color="green" angle={3}>
            データを まもろう
            <br />
            <small>（コードを つくっておこう）</small>
          </Sticky>
        </button>
      )}

      {/* 余白の落書き（星・サイコロはゆっくり動く。おてあげの絵は動かさない） */}
      <OtegeArt width={150} className="menu-scene__doodle menu-scene__doodle--oteage" />
      <StarDoodle seed="menu-star-1" size={54} float className="menu-scene__doodle menu-scene__doodle--star1" />
      <StarDoodle seed="menu-star-2" size={36} float className="menu-scene__doodle menu-scene__doodle--star2" />
      <DiceDoodle seed="menu-dice" size={58} face={6} float className="menu-scene__doodle menu-scene__doodle--dice" />
    </div>
  );
}

/** ストーリー・ガチャ：押すと「じゅんびちゅう」ふせんがプルッと揺れる */
function LockedButton({
  id,
  label,
  shake,
  onPress,
}: {
  id: LockedId;
  label: string;
  shake: number;
  onPress: (id: LockedId) => void;
}) {
  const locked = !features[id];
  return (
    <div className={`menu-scene__locked menu-scene__locked--${id}`}>
      <RoughButton seed={`menu-${id}`} className="menu-scene__locked-btn" onClick={() => onPress(id)}>
        {label}
      </RoughButton>
      {locked && (
        <Sticky seed={`menu-${id}-sticky`} angle={id === 'story' ? -8 : 7} shake={shake} className="menu-scene__locked-sticky">
          じゅんび
          <br />
          ちゅう
        </Sticky>
      )}
      {locked && shake > 0 && (
        <span key={shake} className="note-pop menu-scene__locked-msg">
          もうすこし まってね
        </span>
      )}
    </div>
  );
}

function GearIcon() {
  return (
    <svg viewBox="0 0 40 40" width="34" height="34" className="menu-scene__gear-icon" aria-hidden>
      <circle cx="20" cy="20" r="6" />
      <path d="M20 4 V10 M20 30 V36 M4 20 H10 M30 20 H36 M8.7 8.7 L13 13 M27 27 L31.3 31.3 M8.7 31.3 L13 27 M27 13 L31.3 8.7" />
      <circle cx="20" cy="20" r="11.5" />
    </svg>
  );
}

