import { useEffect, useRef, useState } from 'react';
import { useT } from '../../i18n/useT';
import { useSave } from '../../state/SaveContext';
import { checkForUpdate, outdatedNow, reloadToLatest, useOutdated } from '../../update/update';
import { Dialog } from './Dialog';
import { Sticky } from './Sticky';
import { RoughButton } from '../rough/RoughButton';
import './updateNotice.css';

/**
 * 新しい版のお知らせ（v2.7。SPEC §12-7）
 * - UpdateNote：メニュー画面の上の ふせん「あたらしい バージョンが あります…」と「さいよみこみ」
 * - ReloadButton：セーブしてから、新しい版の番号を付けて開き直す
 * - OutdatedDialog：古い版のまま フレンド対戦・レート対戦・トレードに入ろうとした時（入らずに、同じ文と「さいよみこみ」）
 * 対戦中・ガチャの演出中・トレードの途中には出さない（メニューにだけ置く）。勝手に読み込み直さない
 */

/** 「さいよみこみ」：今のセーブを書き直してから（念のため）、少し待って開き直す */
export function ReloadButton({ seed, className }: { seed: string; className?: string }) {
  const tr = useT();
  const { update } = useSave();
  const [busy, setBusy] = useState(false);
  return (
    <RoughButton
      seed={seed}
      className={className}
      highlight
      disabled={busy}
      data-testid="update-reload"
      onClick={() => {
        setBusy(true);
        // 保存（Cookie・localStorage への書き込み）が済んでから開き直す
        update(() => {});
        window.setTimeout(reloadToLatest, 150);
      }}
    >
      {tr.update.reload}
    </RoughButton>
  );
}

/** メニュー画面の上の ふせん（古い版の時だけ） */
export function UpdateNote() {
  const tr = useT();
  const outdated = useOutdated();
  if (!outdated) return null;
  return (
    <div className="update-note" data-testid="update-note">
      <Sticky seed="update-note" color="yellow" angle={-2}>
        <span className="update-note__text">{tr.update.note}</span>
      </Sticky>
      <ReloadButton seed="update-note-reload" className="update-note__btn" />
    </div>
  );
}

/** 古い版のまま入れない時のダイアログ */
export function OutdatedDialog({ text, onClose }: { text?: string; onClose: () => void }) {
  const tr = useT();
  return (
    <Dialog
      seed="update-dialog"
      onClose={onClose}
      actions={
        <>
          <RoughButton seed="update-dialog-close" onClick={onClose}>
            {tr.common.back}
          </RoughButton>
          <ReloadButton seed="update-dialog-reload" />
        </>
      }
    >
      <p className="update-dialog__text" data-testid="update-dialog">
        {text ?? tr.update.note}
      </p>
    </Dialog>
  );
}

/**
 * オンラインの入り口（フレンド対戦・レート対戦・トレード）で使う：古い版なら入らずにダイアログ。
 * 押した時にもう一度 version.json を確かめる（取れなければ、そのまま入れる）
 */
export function useOnlineGate(): { gate: (enter: () => void) => void; dialog: JSX.Element | null } {
  const [open, setOpen] = useState(false);
  /** 確かめている途中（2回押しても1回だけ入る） */
  const pending = useRef(false);
  /** 画面を出た後は入らない */
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const gate = (enter: () => void) => {
    if (outdatedNow()) {
      setOpen(true);
      return;
    }
    if (pending.current) return;
    pending.current = true;
    void checkForUpdate().then(() => {
      pending.current = false;
      if (!alive.current) return;
      if (outdatedNow()) setOpen(true);
      else enter();
    });
  };
  return { gate, dialog: open ? <OutdatedDialog onClose={() => setOpen(false)} /> : null };
}

/**
 * フレンド対戦・レート対戦・トレードの画面に置く：古い版と分かっていれば、入れずにダイアログ（閉じると onBack）。
 * メニューの入り口を通らずに来た時（リザルトの「つぎの しあいへ」など）のため
 */
export function OutdatedGuard({ onBack }: { onBack: () => void }) {
  // 画面を開いた時だけ見る（トレードや部屋の途中で新しい版が分かっても、途中では出さない）
  const [outdated] = useState(outdatedNow);
  if (!outdated) return null;
  return <OutdatedDialog onClose={onBack} />;
}
