import { useState, type ReactNode } from 'react';
import { useNav } from '../../router';
import { NAME_MAX, VOLUME_MAX, clampText } from '../../save/saveData';
import { useSave } from '../../state/SaveContext';
import { Dialog } from '../../ui/common/Dialog';
import { SavedToast } from '../../ui/common/SavedToast';
import { RoughBox } from '../../ui/rough/RoughBox';
import { RoughButton } from '../../ui/rough/RoughButton';
import { tiltStyle } from '../../ui/rough/seed';
import { EnterCodeDialog, MakeCodeDialog } from './TransferDialogs';
import './settings.css';

const SPEEDS = [
  { value: 0, label: 'ふつう' },
  { value: 1, label: 'はやい' },
  { value: 2, label: 'さいそく' },
] as const;

/** S06 設定（SPEC §7） */
export function SettingsScene() {
  const { go } = useNav();
  const { save, update, replace, reset, markCodeCreated } = useSave();
  const [dialog, setDialog] = useState<'make' | 'enter' | 'wipe1' | 'wipe2' | null>(null);
  const s = save.settings;

  return (
    <div className="settings-scene">
      <h1 className="settings-scene__title">
        <span className="tilt" style={tiltStyle('settings-title')}>
          せってい
        </span>
      </h1>
      <RoughButton seed="settings-back" className="settings-scene__back" onClick={() => go('menu')}>
        もどる
      </RoughButton>
      <SavedToast />

      <RoughBox seed="settings-left" className="settings-panel settings-panel--left" paper radius={8}>
        <Row label="なまえ" note={`${NAME_MAX}もじ まで。あいてに みえるよ`}>
          <input
            key={save.playerName}
            className="pen-input settings-scene__name"
            defaultValue={save.playerName}
            maxLength={NAME_MAX * 2}
            onChange={(e) => {
              const v = clampText(e.target.value, NAME_MAX);
              if (v !== e.target.value) e.target.value = v;
            }}
            onBlur={(e) => {
              const v = clampText(e.target.value.trim(), NAME_MAX);
              if (v && v !== save.playerName) update((d) => void (d.playerName = v));
              else e.target.value = save.playerName;
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
            }}
          />
        </Row>
        <Row label="BGM">
          <Volume id="bgm" value={s.bgm} onChange={(v) => update((d) => void (d.settings.bgm = v))} />
        </Row>
        <Row label="こうかおん">
          <Volume id="se" value={s.se} onChange={(v) => update((d) => void (d.settings.se = v))} />
        </Row>
        <Row label="えんしゅつ スピード">
          <div className="settings-choice">
            {SPEEDS.map((sp) => (
              <RoughButton
                key={sp.value}
                seed={`speed-${sp.value}`}
                className="settings-choice__btn"
                highlight={s.fxSpeed === sp.value}
                onClick={() => update((d) => void (d.settings.fxSpeed = sp.value))}
              >
                {sp.label}
              </RoughButton>
            ))}
          </div>
        </Row>
        <Row label="えんしゅつを へらす" note="がめんの ゆれ・ひかり・つぶを おさえる">
          <OnOff id="reduce" value={s.reduceFx} onChange={(v) => update((d) => void (d.settings.reduceFx = v))} />
        </Row>
        <Row label="ヒントを だす" note="たいせんちゅうの ヒント 1ぎょう">
          <OnOff id="hints" value={s.hints} onChange={(v) => update((d) => void (d.settings.hints = v))} />
        </Row>
      </RoughBox>

      <RoughBox seed="settings-right" className="settings-panel settings-panel--right" paper radius={8}>
        <h2 className="settings-panel__title">データひきつぎ</h2>
        <p className="settings-panel__note pencil">
          ほかの たんまつや ブラウザに データを もっていけるよ。ブラウザの データを けすと きえるので、ときどき コードを つくっておこう。
        </p>
        <div className="settings-transfer">
          <RoughButton seed="make-code-btn" className="settings-transfer__btn" onClick={() => {
            markCodeCreated();
            setDialog('make');
          }}>
            コードを つくる
          </RoughButton>
          <RoughButton seed="enter-code-btn" className="settings-transfer__btn" onClick={() => setDialog('enter')}>
            コードを いれる
          </RoughButton>
        </div>
        <p className="settings-panel__stats">
          せいせき：<span className="num">{save.stats.wins}</span> かち　<span className="num">{save.stats.losses}</span> まけ
        </p>
        <RoughButton seed="wipe-btn" className="settings-wipe" stroke="var(--pen-red)" onClick={() => setDialog('wipe1')}>
          <span className="red-pen">データを けす</span>
        </RoughButton>
      </RoughBox>

      {dialog === 'make' && <MakeCodeDialog save={save} onClose={() => setDialog(null)} />}
      {dialog === 'enter' && <EnterCodeDialog onRestore={replace} onClose={() => setDialog(null)} />}
      {dialog === 'wipe1' && (
        <Dialog
          seed="wipe1"
          title="データを けす？"
          actions={
            <>
              <RoughButton seed="wipe1-no" onClick={() => setDialog(null)}>
                やめる
              </RoughButton>
              <RoughButton seed="wipe1-yes" stroke="var(--pen-red)" onClick={() => setDialog('wipe2')}>
                けす
              </RoughButton>
            </>
          }
        >
          デッキ・なまえ・せってい・せいせきが ぜんぶ きえて、はじめの じょうたいに もどるよ。
        </Dialog>
      )}
      {dialog === 'wipe2' && (
        <Dialog
          seed="wipe2"
          title="もういちど きくよ"
          actions={
            <>
              <RoughButton seed="wipe2-no" onClick={() => setDialog(null)}>
                やめる
              </RoughButton>
              <RoughButton
                seed="wipe2-yes"
                stroke="var(--pen-red)"
                onClick={() => {
                  reset();
                  go('title');
                }}
              >
                ほんとうに けす
              </RoughButton>
            </>
          }
        >
          <span className="red-pen">けしたら もとに もどせないよ。</span>ほんとうに いい？
        </Dialog>
      )}
    </div>
  );
}

function Row({ label, note, children }: { label: string; note?: string; children: ReactNode }) {
  return (
    <div className="settings-row">
      <div className="settings-row__label">
        <span className="tilt" style={tiltStyle(`row-${label}`)}>
          {label}
        </span>
        {note && <small className="pencil">{note}</small>}
      </div>
      <div className="settings-row__control">{children}</div>
    </div>
  );
}

/** 音量 0〜10：マスをタップ、または −／＋ */
function Volume({ id, value, onChange }: { id: string; value: number; onChange: (v: number) => void }) {
  return (
    <div className="volume">
      <RoughButton seed={`${id}-minus`} className="volume__step" disabled={value <= 0} onClick={() => onChange(value - 1)} ariaLabel="へらす">
        −
      </RoughButton>
      <div className="volume__cells">
        {Array.from({ length: VOLUME_MAX }, (_, i) => (
          <button
            key={i}
            type="button"
            className={`volume__cell ${i < value ? 'is-on' : ''}`}
            onClick={() => onChange(i + 1 === value ? i : i + 1)}
            aria-label={`${i + 1}`}
          />
        ))}
      </div>
      <RoughButton seed={`${id}-plus`} className="volume__step" disabled={value >= VOLUME_MAX} onClick={() => onChange(value + 1)} ariaLabel="ふやす">
        ＋
      </RoughButton>
      <span className="volume__value num">{value}</span>
    </div>
  );
}

function OnOff({ id, value, onChange }: { id: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="settings-choice">
      <RoughButton seed={`${id}-on`} className="settings-choice__btn" highlight={value} onClick={() => onChange(true)}>
        オン
      </RoughButton>
      <RoughButton seed={`${id}-off`} className="settings-choice__btn" highlight={!value} onClick={() => onChange(false)}>
        オフ
      </RoughButton>
    </div>
  );
}
