import { useRef, useState } from 'react';
import type { SaveData } from '../../save/saveData';
import { decodeTransferCode, encodeTransferCode } from '../../save/transferCode';
import { Dialog } from '../../ui/common/Dialog';
import { RoughButton } from '../../ui/rough/RoughButton';
import { useT } from '../../i18n/useT';

/**
 * データひきつぎ（SPEC §12-4）
 * 「コードを つくる」：コードを全選択できる欄に出す＋コピーボタン。
 *   クリップボードが使えない時は、欄を全選択して「ながおしで コピーしてね」と案内する。
 * 「コードを いれる」：貼り付け欄 → 確認「いまの データは うわがき されるよ」→ 復元。
 */

/** コードを見せて「つくった」と数える時間（書き写すのに使ったとみなす） */
const SHOWN_ENOUGH_MS = 5000;

export function MakeCodeDialog({ save, onClose, onCreated }: { save: SaveData; onClose: () => void; onCreated: () => void }) {
  const [code] = useState(() => encodeTransferCode(save));
  const [openedAt] = useState(() => Date.now());
  const close = () => {
    if (Date.now() - openedAt >= SHOWN_ENOUGH_MS) onCreated();
    onClose();
  };
  const tr = useT();
  const [msg, setMsg] = useState<'copied' | 'failed' | null>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const digits = code.replace(/-/g, '').length;

  const selectAll = () => {
    const el = field.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(0, el.value.length);
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      onCreated();
      setMsg('copied');
      return;
    } catch {
      // クリップボードが使えない（http・古いブラウザ・許可なし）→ 次の方法へ
    }
    selectAll();
    try {
      if (document.execCommand('copy')) {
        onCreated();
        setMsg('copied');
        return;
      }
    } catch {
      // 使えない
    }
    selectAll();
    setMsg('failed');
  };

  return (
    <Dialog
      seed="make-code"
      title={tr.transfer.codeTitle}
      width={760}
      actions={
        <>
          <RoughButton seed="make-code-close" onClick={close}>
            {tr.common.close}
          </RoughButton>
          <RoughButton seed="make-code-copy" highlight onClick={copy}>
            {tr.transfer.copy}
          </RoughButton>
        </>
      }
    >
      <p className="settings-dialog__note">
        {tr.transfer.codeText}
        <span className="pencil">{tr.transfer.digits(digits)}</span>
      </p>
      <textarea
        ref={field}
        className="pen-textarea settings-dialog__code"
        readOnly
        rows={6}
        value={code}
        onFocus={selectAll}
        onClick={selectAll}
        aria-label={tr.transfer.codeTitle}
      />
      {msg && <p className={`settings-dialog__msg ${msg === 'copied' ? 'is-ok' : 'red-pen'}`}>{msg === 'copied' ? tr.transfer.copied : tr.transfer.copyFailed}</p>}
    </Dialog>
  );
}

export function EnterCodeDialog({ onRestore, onClose }: { onRestore: (data: SaveData) => void; onClose: () => void }) {
  const [text, setText] = useState('');
  const [error, setError] = useState(false);
  const [pending, setPending] = useState<SaveData | null>(null);
  const [done, setDone] = useState(false);
  const tr = useT();

  if (done) {
    return (
      <Dialog
        seed="enter-code-done"
        title={tr.transfer.restoredTitle}
        actions={
          <RoughButton seed="enter-code-done-ok" onClick={onClose}>
            OK
          </RoughButton>
        }
      >
        {tr.transfer.restoredText}
      </Dialog>
    );
  }

  if (pending) {
    return (
      <Dialog
        seed="enter-code-confirm"
        title={tr.transfer.confirmTitle}
        actions={
          <>
            <RoughButton seed="enter-code-no" onClick={() => setPending(null)}>
              {tr.common.cancel}
            </RoughButton>
            <RoughButton
              seed="enter-code-yes"
              stroke="var(--pen-red)"
              onClick={() => {
                onRestore(pending);
                setDone(true);
              }}
            >
              {tr.transfer.overwrite}
            </RoughButton>
          </>
        }
      >
        <span className="red-pen">{tr.transfer.overwriteWarn}</span>
        <br />
        {tr.transfer.codeData(pending.playerName, pending.decks.filter((d) => d.cards.length > 0).length)}
      </Dialog>
    );
  }

  return (
    <Dialog
      seed="enter-code"
      title={tr.transfer.enterTitle}
      width={760}
      actions={
        <>
          <RoughButton seed="enter-code-cancel" onClick={onClose}>
            {tr.common.cancel}
          </RoughButton>
          <RoughButton
            seed="enter-code-go"
            highlight={text.trim().length > 0}
            disabled={text.trim().length === 0}
            onClick={() => {
              const r = decodeTransferCode(text);
              if (r.ok) setPending(r.data);
              else setError(true);
            }}
          >
            {tr.transfer.restore}
          </RoughButton>
        </>
      }
    >
      <p className="settings-dialog__note">{tr.transfer.enterNote}</p>
      <textarea
        className="pen-textarea settings-dialog__code"
        rows={6}
        value={text}
        autoFocus
        inputMode="numeric"
        onChange={(e) => {
          setText(e.target.value);
          setError(false);
        }}
        aria-label={tr.transfer.inputAria}
      />
      {error && <p className="settings-dialog__msg red-pen">{tr.transfer.wrong}</p>}
    </Dialog>
  );
}
