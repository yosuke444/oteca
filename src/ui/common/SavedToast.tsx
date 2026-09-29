import { useSave } from '../../state/SaveContext';
import './common.css';

/** 保存のたびに右上へ一瞬出る「ほぞんしたよ ✓」（SPEC §7 S02） */
export function SavedToast() {
  const { savedTick } = useSave();
  if (savedTick === 0) return null;
  return (
    <span key={savedTick} className="saved-toast" role="status">
      ほぞんしたよ <span className="saved-toast__check">✓</span>
    </span>
  );
}
