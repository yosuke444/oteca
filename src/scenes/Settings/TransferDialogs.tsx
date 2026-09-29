import { useRef, useState } from 'react';
import type { SaveData } from '../../save/saveData';
import { decodeTransferCode, encodeTransferCode } from '../../save/transferCode';
import { Dialog } from '../../ui/common/Dialog';
import { RoughButton } from '../../ui/rough/RoughButton';

/**
 * データひきつぎ（SPEC §12-4）
 * 「コードを つくる」：コードを全選択できる欄に出す＋コピーボタン。
 *   クリップボードが使えない時は、欄を全選択して「ながおしで コピーしてね」と案内する。
 * 「コードを いれる」：貼り付け欄 → 確認「いまの データは うわがき されるよ」→ 復元。
 */

export function MakeCodeDialog({ save, onClose }: { save: SaveData; onClose: () => void }) {
  const [code] = useState(() => encodeTransferCode(save));
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
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
      setMsg({ text: 'コピーしたよ！ メモアプリなどに はりつけて とっておいてね', ok: true });
      return;
    } catch {
      // クリップボードが使えない（http・古いブラウザ・許可なし）→ 次の方法へ
    }
    selectAll();
    try {
      if (document.execCommand('copy')) {
        setMsg({ text: 'コピーしたよ！ メモアプリなどに はりつけて とっておいてね', ok: true });
        return;
      }
    } catch {
      // 使えない
    }
    selectAll();
    setMsg({ text: 'じどうで コピー できなかったよ。えらばれている コードを ながおし（みぎクリック）して コピーしてね', ok: false });
  };

  return (
    <Dialog
      seed="make-code"
      title="ひきつぎコード"
      width={760}
      actions={
        <>
          <RoughButton seed="make-code-close" onClick={onClose}>
            とじる
          </RoughButton>
          <RoughButton seed="make-code-copy" highlight onClick={copy}>
            コピー
          </RoughButton>
        </>
      }
    >
      <p className="settings-dialog__note">
        べつの たんまつで この コードを いれると、いまの データが つかえるよ。<span className="pencil">（{digits}けた）</span>
      </p>
      <textarea
        ref={field}
        className="pen-textarea settings-dialog__code"
        readOnly
        rows={6}
        value={code}
        onFocus={selectAll}
        onClick={selectAll}
        aria-label="ひきつぎコード"
      />
      {msg && <p className={`settings-dialog__msg ${msg.ok ? 'is-ok' : 'red-pen'}`}>{msg.text}</p>}
    </Dialog>
  );
}

export function EnterCodeDialog({ onRestore, onClose }: { onRestore: (data: SaveData) => void; onClose: () => void }) {
  const [text, setText] = useState('');
  const [error, setError] = useState(false);
  const [pending, setPending] = useState<SaveData | null>(null);
  const [done, setDone] = useState(false);

  if (done) {
    return (
      <Dialog
        seed="enter-code-done"
        title="ふっかつ したよ！"
        actions={
          <RoughButton seed="enter-code-done-ok" onClick={onClose}>
            OK
          </RoughButton>
        }
      >
        デッキや せっていが もどったよ。
      </Dialog>
    );
  }

  if (pending) {
    return (
      <Dialog
        seed="enter-code-confirm"
        title="ほんとうに いい？"
        actions={
          <>
            <RoughButton seed="enter-code-no" onClick={() => setPending(null)}>
              やめる
            </RoughButton>
            <RoughButton
              seed="enter-code-yes"
              stroke="var(--pen-red)"
              onClick={() => {
                onRestore(pending);
                setDone(true);
              }}
            >
              うわがき する
            </RoughButton>
          </>
        }
      >
        <span className="red-pen">いまの データは うわがき されるよ。</span>
        <br />
        コードの データ：なまえ「{pending.playerName}」／ デッキ{' '}
        {pending.decks.filter((d) => d.cards.length > 0).length}こ
      </Dialog>
    );
  }

  return (
    <Dialog
      seed="enter-code"
      title="コードを いれる"
      width={760}
      actions={
        <>
          <RoughButton seed="enter-code-cancel" onClick={onClose}>
            やめる
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
            ふっかつ する
          </RoughButton>
        </>
      }
    >
      <p className="settings-dialog__note">コードを はりつけてね（ハイフンや くうはくは あっても だいじょうぶ）</p>
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
        aria-label="ひきつぎコードの にゅうりょく"
      />
      {error && <p className="settings-dialog__msg red-pen">コードが ちがうみたい。もういちど たしかめてね</p>}
    </Dialog>
  );
}
