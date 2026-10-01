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
import { LANGS, DICTS } from '../../i18n';
import { useT } from '../../i18n/useT';
import './settings.css';

const SPEEDS = [
  { value: 0, key: 'normal' },
  { value: 1, key: 'fast' },
  { value: 2, key: 'fastest' },
] as const;

/** S06 設定（SPEC §7） */
export function SettingsScene() {
  const { go } = useNav();
  const { save, update, replace, reset, markCodeCreated } = useSave();
  const [dialog, setDialog] = useState<'make' | 'enter' | 'wipe1' | 'wipe2' | null>(null);
  const s = save.settings;
  const tr = useT();

  return (
    <div className="settings-scene">
      <h1 className="settings-scene__title">
        <span className="tilt" style={tiltStyle('settings-title')}>
          {tr.settings.title}
        </span>
      </h1>
      <RoughButton seed="settings-back" className="settings-scene__back" onClick={() => go('menu')}>
        {tr.common.back}
      </RoughButton>
      <SavedToast />

      <RoughBox seed="settings-left" className="settings-panel settings-panel--left" paper radius={8}>
        <Row id="name" label={tr.settings.name} note={tr.settings.nameNote(NAME_MAX)}>
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
        <Row id="bgm" label={tr.settings.bgm}>
          <Volume id="bgm" value={s.bgm} onChange={(v) => update((d) => void (d.settings.bgm = v))} />
        </Row>
        <Row id="se" label={tr.settings.se}>
          <Volume id="se" value={s.se} onChange={(v) => update((d) => void (d.settings.se = v))} />
        </Row>
        <Row id="speed" label={tr.settings.fxSpeed}>
          <div className="settings-choice">
            {SPEEDS.map((sp) => (
              <RoughButton
                key={sp.value}
                seed={`speed-${sp.value}`}
                className="settings-choice__btn"
                highlight={s.fxSpeed === sp.value}
                onClick={() => update((d) => void (d.settings.fxSpeed = sp.value))}
              >
                {tr.settings.speed[sp.key]}
              </RoughButton>
            ))}
          </div>
        </Row>
        <Row id="reduce" label={tr.settings.reduceFx} note={tr.settings.reduceFxNote}>
          <OnOff id="reduce" value={s.reduceFx} onChange={(v) => update((d) => void (d.settings.reduceFx = v))} />
        </Row>
        {/* ことば（SPEC §6-4b）：ボタンの文字は、その言語での名前（にほんご／日本語） */}
        <Row id="lang" label={tr.settings.lang} note={tr.settings.langNote}>
          <div className="settings-choice">
            {LANGS.map((l) => (
              <RoughButton
                key={l}
                seed={`lang-${l}`}
                className="settings-choice__btn"
                highlight={s.lang === l}
                onClick={() => update((d) => void (d.settings.lang = l))}
              >
                {l === 'hira' ? DICTS.hira.settings.langHira : DICTS.kanji.settings.langKanji}
              </RoughButton>
            ))}
          </div>
        </Row>
      </RoughBox>

      <RoughBox seed="settings-right" className="settings-panel settings-panel--right" paper radius={8}>
        <h2 className="settings-panel__title">{tr.settings.transfer}</h2>
        <p className="settings-panel__note pencil">{tr.settings.transferText}</p>
        <div className="settings-transfer">
          <RoughButton seed="make-code-btn" className="settings-transfer__btn" onClick={() => setDialog('make')}>
            {tr.settings.makeCode}
          </RoughButton>
          <RoughButton seed="enter-code-btn" className="settings-transfer__btn" onClick={() => setDialog('enter')}>
            {tr.settings.enterCode}
          </RoughButton>
        </div>
        <p className="settings-panel__stats">
          {tr.settings.record}
          <span className="num">{save.stats.wins}</span> {tr.common.winsLosses.wins}{"  "}<span className="num">{save.stats.losses}</span> {tr.common.winsLosses.losses}
        </p>
        <RoughButton seed="wipe-btn" className="settings-wipe" stroke="var(--pen-red)" onClick={() => setDialog('wipe1')}>
          <span className="red-pen">{tr.settings.erase}</span>
        </RoughButton>
      </RoughBox>

      {dialog === 'make' && <MakeCodeDialog save={save} onClose={() => setDialog(null)} onCreated={markCodeCreated} />}
      {dialog === 'enter' && <EnterCodeDialog onRestore={replace} onClose={() => setDialog(null)} />}
      {dialog === 'wipe1' && (
        <Dialog
          seed="wipe1"
          title={tr.settings.eraseTitle}
          actions={
            <>
              <RoughButton seed="wipe1-no" onClick={() => setDialog(null)}>
                {tr.common.cancel}
              </RoughButton>
              <RoughButton seed="wipe1-yes" stroke="var(--pen-red)" onClick={() => setDialog('wipe2')}>
                {tr.settings.eraseYes}
              </RoughButton>
            </>
          }
        >
          {tr.settings.eraseText}
        </Dialog>
      )}
      {dialog === 'wipe2' && (
        <Dialog
          seed="wipe2"
          title={tr.settings.eraseAgainTitle}
          actions={
            <>
              <RoughButton seed="wipe2-no" onClick={() => setDialog(null)}>
                {tr.common.cancel}
              </RoughButton>
              <RoughButton
                seed="wipe2-yes"
                stroke="var(--pen-red)"
                onClick={() => {
                  reset();
                  go('title');
                }}
              >
                {tr.settings.eraseAgainYes}
              </RoughButton>
            </>
          }
        >
          <span className="red-pen">{tr.settings.eraseAgainWarn}</span>
          {tr.settings.eraseAgainAsk}
        </Dialog>
      )}
    </div>
  );
}

function Row({ id, label, note, children }: { id: string; label: string; note?: string; children: ReactNode }) {
  return (
    <div className="settings-row">
      <div className="settings-row__label">
        <span className="tilt" style={tiltStyle(`row-${id}`)}>
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
  const tr = useT();
  return (
    <div className="volume">
      <RoughButton seed={`${id}-minus`} className="volume__step" disabled={value <= 0} onClick={() => onChange(value - 1)} ariaLabel={tr.settings.minus}>
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
      <RoughButton seed={`${id}-plus`} className="volume__step" disabled={value >= VOLUME_MAX} onClick={() => onChange(value + 1)} ariaLabel={tr.settings.plus}>
        {tr.settings.plusSign}
      </RoughButton>
      <span className="volume__value num">{value}</span>
    </div>
  );
}

function OnOff({ id, value, onChange }: { id: string; value: boolean; onChange: (v: boolean) => void }) {
  const tr = useT();
  return (
    <div className="settings-choice">
      <RoughButton seed={`${id}-on`} className="settings-choice__btn" highlight={value} onClick={() => onChange(true)}>
        {tr.common.on}
      </RoughButton>
      <RoughButton seed={`${id}-off`} className="settings-choice__btn" highlight={!value} onClick={() => onChange(false)}>
        {tr.common.off}
      </RoughButton>
    </div>
  );
}
