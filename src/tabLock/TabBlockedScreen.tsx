import { useState } from 'react';
import { t } from '../i18n';
import { Dialog } from '../ui/common/Dialog';
import { OtegeArt } from '../ui/common/OtegeArt';
import { Stage } from '../ui/common/Stage';
import { RoughBox } from '../ui/rough/RoughBox';
import { RoughButton } from '../ui/rough/RoughButton';
import { tiltStyle } from '../ui/rough/seed';
import './tabLock.css';

/**
 * 止まったタブの画面（v2.3）。
 * - other：あとから開いた2つ目のタブ「ほかの タブで ひらいています」
 * - stolen：べつのタブに移ったタブ「べつの タブで ひらかれました」
 * 「この タブで あそぶ」で、このタブを動かす（もう1つのタブが対戦中なら、先に確かめる）。
 * この画面ではセーブ・通信・BGM を動かさない（音も鳴らさない。audio は止めてある）
 */
export function TabBlockedScreen({
  kind,
  otherInBattle,
  onPlayHere,
}: {
  kind: 'other' | 'stolen';
  otherInBattle: () => boolean;
  onPlayHere: () => Promise<void>;
}) {
  const tr = t().tabLock;
  const [ask, setAsk] = useState(false);
  const [busy, setBusy] = useState(false);
  const go = () => {
    if (busy) return;
    setBusy(true);
    setAsk(false);
    // 切り替えられなかった時は、もう一度押せるように戻す
    onPlayHere().then(
      () => setBusy(false),
      () => setBusy(false),
    );
  };
  return (
    <Stage>
      <div className="tab-blocked" data-testid={`tab-blocked-${kind}`}>
        <RoughBox seed={`tab-blocked-${kind}`} paper strokeWidth={3} radius={16} className="tab-blocked__card">
          <div className="tab-blocked__inner">
            <OtegeArt width={150} className="tab-blocked__art" />
            <h1 className="tab-blocked__title">
              <span className="tilt" style={tiltStyle(`tab-blocked-${kind}-title`)}>
                {kind === 'other' ? tr.otherTitle : tr.stolenTitle}
              </span>
            </h1>
            <p className="tab-blocked__text pencil">{kind === 'other' ? tr.otherText : tr.stolenText}</p>
            <RoughButton
              seed="tab-blocked-play"
              className="tab-blocked__btn"
              strokeWidth={3}
              disabled={busy}
              onClick={() => (otherInBattle() ? setAsk(true) : go())}
              data-testid="tab-play-here"
            >
              {tr.playHere}
            </RoughButton>
          </div>
        </RoughBox>
        {ask && (
          <Dialog
            seed="tab-blocked-ask"
            width={760}
            title={tr.confirmTitle}
            onClose={() => setAsk(false)}
            actions={
              <>
                <RoughButton seed="tab-blocked-cancel" className="tab-blocked__dlg-btn" onClick={() => setAsk(false)} data-testid="tab-play-cancel">
                  {tr.cancel}
                </RoughButton>
                <RoughButton seed="tab-blocked-ok" className="tab-blocked__dlg-btn" stroke="var(--pen-red)" onClick={go} data-testid="tab-play-ok">
                  {tr.playHere}
                </RoughButton>
              </>
            }
          >
            <p className="tab-blocked__warn" data-testid="tab-play-warn">
              {tr.confirmBattle}
            </p>
          </Dialog>
        )}
      </div>
    </Stage>
  );
}
