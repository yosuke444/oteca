import { useEffect, useRef, useState } from 'react';
import { useT } from '../../i18n/useT';
import { isAdmin, loginAdmin } from '../../online/adminApi';
import { useNav } from '../../router';
import { Dialog } from '../../ui/common/Dialog';
import { RoughButton } from '../../ui/rough/RoughButton';
import './admin.css';

/** かくし場所を押し続ける時間（v2.0-J。SPEC §7 S20） */
export const ADMIN_HOLD_MS = 10000;

/**
 * 設定（S06）の左上の目に見えない場所。10秒押し続けると、ほぼ透明の「かんりしゃ」ボタンが現れる（押している途中では何も出さない）。
 * 押すとパスワードの入力欄。正しければ管理者メニューへ（ページを閉じるまでは もう一度入れなくてよい）
 */
export function AdminCorner() {
  const tr = useT();
  const { go } = useNav();
  const [shown, setShown] = useState(false);
  const [login, setLogin] = useState(false);
  const timer = useRef<number | null>(null);
  const cancel = () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
  };
  useEffect(() => cancel, []);
  return (
    <>
      <div
        className="admin-corner"
        data-testid="admin-corner"
        aria-hidden
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          cancel();
          timer.current = window.setTimeout(() => setShown(true), ADMIN_HOLD_MS);
        }}
        onPointerUp={cancel}
        onPointerLeave={cancel}
        onPointerCancel={cancel}
        onContextMenu={(e) => e.preventDefault()}
      />
      {shown && (
        <button type="button" className="admin-corner__button" data-testid="admin-button" onClick={() => (isAdmin() ? go('admin') : setLogin(true))}>
          {tr.admin.button}
        </button>
      )}
      {login && <AdminLoginDialog onClose={() => setLogin(false)} onOk={() => go('admin')} />}
    </>
  );
}

function AdminLoginDialog({ onClose, onOk }: { onClose: () => void; onOk: () => void }) {
  const tr = useT();
  const [password, setPassword] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (busy || !password) return;
    setBusy(true);
    setNote(tr.admin.working);
    const r = await loginAdmin(password);
    setBusy(false);
    // パスワードは覚えない
    setPassword('');
    if (r.kind === 'ok') return onOk();
    if (r.kind === 'wrong') return setNote(tr.admin.wrong(r.left));
    if (r.kind === 'locked') {
      const d = new Date(r.until);
      return setNote(tr.admin.locked(tr.admin.time(d.getMonth() + 1, d.getDate(), d.getHours(), d.getMinutes())));
    }
    setNote(tr.admin.offline);
  };
  return (
    <Dialog
      seed="admin-login"
      title={tr.admin.loginTitle}
      onClose={onClose}
      width={520}
      actions={
        <>
          <RoughButton seed="admin-login-cancel" className="dialog__btn" onClick={onClose}>
            {tr.admin.cancel}
          </RoughButton>
          <RoughButton seed="admin-login-go" className="dialog__btn" highlight disabled={busy || !password} onClick={() => void submit()} data-testid="admin-login-go">
            {tr.admin.enter}
          </RoughButton>
        </>
      }
    >
      <label className="admin-field">
        <span>{tr.admin.password}</span>
        <input
          className="pen-input admin-field__input"
          type="password"
          autoComplete="off"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) void submit();
          }}
          data-testid="admin-password"
          autoFocus
        />
      </label>
      {note && (
        <p className="admin-note red-pen" data-testid="admin-login-note">
          {note}
        </p>
      )}
    </Dialog>
  );
}
