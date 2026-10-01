import { useSave } from '../../state/SaveContext';
import { useT } from '../../i18n/useT';
import './common.css';

/** 保存のたびに右上へ一瞬出る「ほぞんしたよ ✓」（SPEC §7 S02） */
export function SavedToast() {
  const { savedTick } = useSave();
  const tr = useT();
  if (savedTick === 0) return null;
  return (
    <span key={savedTick} className="saved-toast" role="status">
      {tr.ui.saved} <span className="saved-toast__check">✓</span>
    </span>
  );
}
