import { useSave } from '../state/SaveContext';
import { DICTS, type Dict, type Lang } from './index';

/** 画面のコンポーネント用：今の言語の辞書（設定の ことば を変えると、その場で描き直される） */
export function useT(): Dict {
  return DICTS[useLang()];
}

export function useLang(): Lang {
  const { save } = useSave();
  return save.settings.lang === 'kanji' ? 'kanji' : 'hira';
}
