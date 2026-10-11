import { useEffect, useRef, useState } from 'react';
import { useT } from '../../i18n/useT';
import { isAdmin, loginAdmin } from '../../online/adminApi';
import { type RouteId, useNav } from '../../router';
import { Dialog } from '../../ui/common/Dialog';
import { RoughButton } from '../../ui/rough/RoughButton';
import './admin.css';

/** 管理画面の入り口のキー（v2.4。SPEC §7 S20）：O と T。event.code で見る（日本語入力・大文字小文字に関係なく） */
export const ADMIN_KEYS: readonly string[] = ['KeyO', 'KeyT'];

/** 文字を打つ欄か（名前・チャット・パスワードなど。ここにカーソルがある時は O・T に反応しない） */
export function isTypingTarget(el: EventTarget | null): boolean {
  if (!el || typeof (el as HTMLElement).tagName !== 'string') return false;
  const h = el as HTMLElement;
  if (h.isContentEditable) return true;
  if (h.tagName === 'TEXTAREA' || h.tagName === 'SELECT') return true;
  if (h.tagName !== 'INPUT') return false;
  return !['button', 'checkbox', 'radio', 'range', 'submit', 'reset', 'image', 'color', 'file'].includes((h as HTMLInputElement).type);
}

/**
 * キーの同時押しの見張り（ふつうの処理だけ）。決めたキーが全部「押されている」状態になった瞬間だけ true を返す。
 * どの順に押してもよい。押しっぱなし（キーの繰り返し）では、どれかを離すまで もう true を返さない
 */
export function createChordWatcher(codes: readonly string[]) {
  const down = new Set<string>();
  let fired = false;
  const all = () => codes.every((c) => down.has(c));
  return {
    keydown(code: string): boolean {
      if (!codes.includes(code)) return false;
      down.add(code);
      if (fired || !all()) return false;
      fired = true;
      return true;
    },
    keyup(code: string): void {
      down.delete(code);
      if (!all()) fired = false;
    },
    /** 画面が裏に回った時など（離したことが届かないので、押していないことにする） */
    reset(): void {
      down.clear();
      fired = false;
    },
  };
}

/** O・T に反応しない画面（対戦中。管理者メニューの中も） */
const QUIET_ROUTES: ReadonlySet<RouteId> = new Set<RouteId>(['battle', 'admin']);

/**
 * 管理画面の入り口（v2.4。SPEC §7 S20）：キーボードの O と T が両方押された瞬間に、パスワードの入力欄を開く（どちらが先でもよい）。
 * 対戦中と、文字を打つ欄にカーソルがある時は反応しない。押しっぱなしでも1回だけ。開く時に見た目・音の合図は出さない。
 * 正しいかは Worker が確かめる（パスワードはゲームに書かない）。正しければ管理者メニューへ（ページを閉じるまでは もう一度入れなくてよい）
 */
export function AdminKeys({ route }: { route: RouteId }) {
  const { go } = useNav();
  const [login, setLogin] = useState(false);
  const state = useRef({ route, login });
  state.current = { route, login };
  useEffect(() => {
    const chord = createChordWatcher(ADMIN_KEYS);
    const onDown = (e: KeyboardEvent) => {
      // 文字を打つ欄では数えない（そこで打った O・T で開かないように）
      if (isTypingTarget(e.target) || isTypingTarget(document.activeElement)) return;
      if (!chord.keydown(e.code)) return;
      const cur = state.current;
      if (QUIET_ROUTES.has(cur.route) || cur.login) return;
      // 開いたパスワードの欄に、押した T（や O）の字が入らないように
      e.preventDefault();
      if (isAdmin()) go('admin');
      else setLogin(true);
    };
    const onUp = (e: KeyboardEvent) => chord.keyup(e.code);
    const onBlur = () => chord.reset();
    window.addEventListener('keydown', onDown, true);
    window.addEventListener('keyup', onUp, true);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onDown, true);
      window.removeEventListener('keyup', onUp, true);
      window.removeEventListener('blur', onBlur);
    };
  }, [go]);
  if (!login) return null;
  return (
    <AdminLoginDialog
      onClose={() => setLogin(false)}
      onOk={() => {
        setLogin(false);
        go('admin');
      }}
    />
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
    // うしろをタップしても閉じない（閉じるのは「やめる」。v2.3）
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
