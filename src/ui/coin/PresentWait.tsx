import { useEffect, useState } from 'react';
import { formatCountdown } from '../../economy/rewards';
import { useT } from '../../i18n/useT';
import { imageUrl } from '../imageFiles';
import './coin.css';

/**
 * ログボを受け取った後のプレゼントボックスの場所（SPEC §7 S11・v2.1-L）：
 * 空いた箱の絵と、次にもらえるまでの残り時間（時:分:秒）。public/images/present_open.png があればそれを使う。
 * 押しても何も起きない（もらえる時刻はまだ）。1秒ごとに数え直し、0 になったら onZero で知らせる。
 * @param remaining 今の時刻での残り（ミリ秒）を返す
 */
export function PresentWait({ remaining, onZero }: { remaining: (now: number) => number; onZero: () => void }) {
  const tr = useT();
  const img = imageUrl('images/present_open.png');
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    // 秒の切り替わりに合わせて数え直す
    let id = 0;
    const tick = () => {
      const t = Date.now();
      setNow(t);
      if (remaining(t) <= 0) {
        onZero();
        return;
      }
      id = window.setTimeout(tick, 1000 - (t % 1000) + 5);
    };
    id = window.setTimeout(tick, 1000 - (Date.now() % 1000) + 5);
    return () => window.clearTimeout(id);
  }, []);
  const time = formatCountdown(remaining(now));
  return (
    <div className="present-wait" role="timer" aria-label={tr.coin.waitAria(time)} data-testid="present-wait">
      {img ? (
        <img src={img} alt="" className="present-wait__img" draggable={false} />
      ) : (
        <svg viewBox="0 30 120 90" width="100" height="75" aria-hidden className="present-wait__svg">
          {/* 開いた箱：ふたは横に立てかけ、ちょうちょ結びはもう無い */}
          <path d="M8 66 L28 46 L36 48 L17 70 Z" fill="var(--note-red)" stroke="var(--ink)" strokeWidth="2.6" strokeLinejoin="round" />
          {/* 箱の口（中は空っぽ） */}
          <path d="M28 64 L94 63 L100 72 L22 73 Z" fill="var(--paper)" stroke="var(--ink)" strokeWidth="2.6" strokeLinejoin="round" />
          <path d="M28 64 L36 70 L88 69 L94 63" fill="none" stroke="var(--pencil)" strokeWidth="1.6" />
          <path d="M22 73 L100 72 L97 112 L25 113 Z" fill="var(--note-red)" stroke="var(--ink)" strokeWidth="3" strokeLinejoin="round" />
          <path d="M54 72 L66 72 L66 112 L54 112 Z" fill="var(--super-gold)" stroke="var(--ink)" strokeWidth="2" opacity="0.55" />
          {/* ほこりの落書き（もう からっぽ） */}
          <path d="M44 56 Q48 50 52 56 M68 54 Q72 48 76 54" fill="none" stroke="var(--pencil)" strokeWidth="1.6" strokeLinecap="round" />
          <path d="M60 46 L60 40 M56 43 L64 43" stroke="var(--pencil)" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      )}
      <span className="present-wait__text">
        <span className="present-wait__label">{tr.coin.wait}</span>
        <span className="present-wait__time num">{time}</span>
      </span>
    </div>
  );
}
