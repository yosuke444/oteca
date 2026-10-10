import { useEffect, useRef, useState, type MouseEvent, type PointerEvent, type SyntheticEvent } from 'react';
import { useT } from '../../i18n/useT';
import { isAdmin, loginAdmin } from '../../online/adminApi';
import { useNav } from '../../router';
import { Dialog } from '../../ui/common/Dialog';
import { RoughButton } from '../../ui/rough/RoughButton';
import './admin.css';

/** 「せってい」の字を押し続ける時間（v2.0-J・v2.3。SPEC §7 S20） */
export const ADMIN_HOLD_MS = 10000;
/** 押している間に、これより大きく指・マウスが動いたら数え直し（スクロールなど。舞台の拡大縮小前の画面の px） */
export const ADMIN_HOLD_SLOP = 12;

/**
 * 設定（S06）の左上の「せってい」の字を10秒押し続けると、パスワードの入力欄がすぐ開く（v2.3。隠しボタンは無くした）。
 * 正しいかは Worker が確かめる（パスワードはゲームに書かない）。正しければ管理者メニューへ（ページを閉じるまでは もう一度入れなくてよい）。
 * - マウスでも指でも。途中で離した・字の外に出た・大きく動いた時は数え直し
 * - 押している間も、見た目・音・振動は変えない。ふつうのタップ・クリックでは何も起きない
 * - 文字の選択・コピーのメニュー・右クリックのメニュー・虫めがねを出さない（CSS の admin-hold と、ここの preventDefault）
 */
export function useAdminHold() {
  const { go } = useNav();
  const [login, setLogin] = useState(false);
  const timer = useRef<number | null>(null);
  const start = useRef<{ x: number; y: number; id: number } | null>(null);
  const cancel = () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
    start.current = null;
  };
  useEffect(() => cancel, []);
  const props = {
    className: 'admin-hold',
    'data-testid': 'admin-hold',
    onPointerDown: (e: PointerEvent<HTMLElement>) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      cancel();
      start.current = { x: e.clientX, y: e.clientY, id: e.pointerId };
      timer.current = window.setTimeout(() => {
        timer.current = null;
        start.current = null;
        if (isAdmin()) go('admin');
        else setLogin(true);
      }, ADMIN_HOLD_MS);
    },
    onPointerMove: (e: PointerEvent<HTMLElement>) => {
      const st = start.current;
      if (!st || e.pointerId !== st.id) return;
      // 字の外に出た（指は押した所に とらわれるので、位置で見る）・大きく動いた
      const r = e.currentTarget.getBoundingClientRect();
      const outside = e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
      if (outside || Math.hypot(e.clientX - st.x, e.clientY - st.y) > ADMIN_HOLD_SLOP) cancel();
    },
    onPointerUp: cancel,
    onPointerLeave: cancel,
    onPointerCancel: cancel,
    onContextMenu: (e: MouseEvent) => e.preventDefault(),
    // 長押しで文字を選んだり、ドラッグで画像のように持ち上げたりしない
    onSelectStart: (e: SyntheticEvent) => e.preventDefault(),
    onDragStart: (e: SyntheticEvent) => e.preventDefault(),
  };
  const dialog = login ? <AdminLoginDialog onClose={() => setLogin(false)} onOk={() => go('admin')} /> : null;
  return { props, dialog };
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
    // うしろをタップしても閉じない（指で10秒押して開いた時、離した指のタップで すぐ閉じてしまうため。v2.3）。閉じるのは「やめる」
    <Dialog
      seed="admin-login"
      title={tr.admin.loginTitle}
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
