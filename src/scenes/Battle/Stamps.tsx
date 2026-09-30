import { useEffect, useState } from 'react';
import { OtegeArt } from '../../ui/common/OtegeArt';

/**
 * スタンプ（SPEC §8-4。P1）
 * 定型文だけ（自由入力は付けない＝子どもが遊ぶ前提の安全対策）。
 * 3秒のクールタイム。名前の横に吹き出しで2秒表示（ポンと出て、しぼむ）。
 */
export const STAMPS = ['よろしく！', 'ナイス！', 'うそでしょ！？', 'まだまだ！', 'ありがとう', 'おてあげ〜'] as const;
/** おてあげのイラスト付きのスタンプ */
export const STAMP_WITH_ART = 5;
export const STAMP_COOLDOWN_MS = 3000;
export const STAMP_SHOW_MS = 2000;

export function isStampId(id: unknown): id is number {
  return typeof id === 'number' && Number.isInteger(id) && id >= 0 && id < STAMPS.length;
}

/** 吹き出し（n が変わるたびに出し直す） */
export function StampBalloon({ stamp, side }: { stamp: { id: number; n: number } | null; side: 'me' | 'opp' }) {
  const [shown, setShown] = useState<{ id: number; n: number } | null>(null);
  useEffect(() => {
    if (!stamp) return;
    setShown(stamp);
    const t = window.setTimeout(() => setShown(null), STAMP_SHOW_MS + 300);
    return () => window.clearTimeout(t);
  }, [stamp?.n]);
  if (!shown || !isStampId(shown.id)) return null;
  return (
    <div key={shown.n} className={`stamp-balloon stamp-balloon--${side}`} role="status" data-testid={`stamp-${side}`}>
      {shown.id === STAMP_WITH_ART && <OtegeArt width={50} />}
      <span>{STAMPS[shown.id]}</span>
    </div>
  );
}

/** スタンプを選ぶ板（右上の「スタンプ」ボタンで開く） */
export function StampPicker({ onSend, cooldownUntil }: { onSend: (id: number) => void; cooldownUntil: number }) {
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(Date.now());
  const cooling = now < cooldownUntil;
  useEffect(() => {
    if (!cooling) return;
    const t = window.setInterval(() => setNow(Date.now()), 200);
    return () => window.clearInterval(t);
  }, [cooling, cooldownUntil]);
  useEffect(() => setNow(Date.now()), [cooldownUntil]);
  const left = Math.max(0, cooldownUntil - now);

  return (
    <div className="stamp-picker">
      <button type="button" className={`stamp-picker__open ${open ? 'is-open' : ''}`} aria-label="スタンプ" onClick={() => setOpen((o) => !o)}>
        💬 スタンプ
      </button>
      {open && (
        <div className="stamp-picker__panel" role="menu">
          {STAMPS.map((text, id) => (
            <button
              key={id}
              type="button"
              role="menuitem"
              className="stamp-picker__item"
              disabled={cooling}
              onClick={() => {
                onSend(id);
                setOpen(false);
              }}
            >
              {id === STAMP_WITH_ART && <OtegeArt width={32} />}
              {text}
            </button>
          ))}
          {cooling && <p className="stamp-picker__cool pencil">あと {Math.ceil(left / 1000)}びょう まってね</p>}
        </div>
      )}
    </div>
  );
}
