import { useEffect, useRef, useState } from 'react';
import { CARD_DB } from '../../data/cards';
import { DRAW, type PullResult } from '../../gacha/gacha';
import { useT } from '../../i18n/useT';
import { CardMini } from '../../ui/card/CardMini';
import { Dialog } from '../../ui/common/Dialog';
import { Sticky } from '../../ui/common/Sticky';
import { RoughButton } from '../../ui/rough/RoughButton';

/**
 * まとめ画面（SPEC §7 S09）：手に入れたカードを並べる。初めてのカードに「NEW」のふせん、スーパーレアは金の枠。
 * 引いた後の所持数。すでに持っていたスーパーレアは「50コインに かえる」（引いた直後のここでだけ）。
 */
export function Summary({
  results,
  owned,
  onConvert,
  onAgain,
  onShop,
  canAgain,
  onNoCoins,
  roomForCoins,
  simple,
}: {
  results: PullResult[];
  /** デイリーパック（v2.1-M）：「もういちど」「パックを えらぶ」の代わりにボタン1つ。onShown はまとめ画面が出た時（コインを飛ばす） */
  simple?: { label: string; onClose: () => void; onShown: (from: HTMLElement | null) => void; testId?: string };
  /** 今の所持数（換金すると減る） */
  owned: (no: number) => number;
  /** i 番目のカードを換金する（保存は呼ぶ側） */
  onConvert: (i: number, from: HTMLElement | null) => void;
  onAgain: () => void;
  onShop: () => void;
  canAgain: boolean;
  /** コインが足りないのに「もういちど」を押した */
  onNoCoins: () => void;
  /** 換金してもコインが上限を超えない */
  roomForCoins: boolean;
}) {
  const tr = useT();
  const [converted, setConverted] = useState<Set<number>>(new Set());
  const [asking, setAsking] = useState<number | null>(null);
  const many = results.length > 8;
  const titleRef = useRef<HTMLHeadingElement>(null);
  const shown = useRef(false);
  useEffect(() => {
    if (!simple || shown.current) return;
    shown.current = true;
    const id = window.setTimeout(() => simple.onShown(titleRef.current), 600);
    return () => {
      window.clearTimeout(id);
      shown.current = false;
    };
  }, []);
  return (
    <div className="gacha-summary" data-testid="gacha-summary">
      <h2 className="gacha-summary__title" ref={titleRef}>
        {tr.gacha.summaryTitle}
      </h2>
      <div className={`gacha-summary__grid ${many ? 'gacha-summary__grid--many' : ''}`}>
        {results.map((r, i) => {
          const def = CARD_DB[r.no];
          return (
            <div key={i} className={`gacha-summary__card ${r.super ? 'is-super' : ''}`} data-testid={`gacha-result-${i}`}>
              <CardMini def={def} seed={`sum-${r.no}-${i}`} variant={many ? 'slot' : 'tile'} />
              {r.isNew && (
                <Sticky seed={`new-${i}`} color="red" angle={-10} className="gacha-summary__new">
                  {tr.gacha.newTag}
                </Sticky>
              )}
              <span className="gacha-summary__owned pencil">{tr.gacha.ownedAfter(owned(r.no))}</span>
              {r.convertible &&
                (converted.has(i) ? (
                  <span className="gacha-summary__done blue-pen">{tr.gacha.converted}</span>
                ) : (
                  <RoughButton seed={`convert-${i}`} className="gacha-summary__convert" disabled={!roomForCoins} onClick={() => setAsking(i)}>
                    {roomForCoins ? tr.gacha.convert(DRAW.superToCoins) : tr.gacha.coinsFull}
                  </RoughButton>
                ))}
            </div>
          );
        })}
      </div>
      {simple ? (
        <div className="gacha-summary__buttons">
          <RoughButton seed="gacha-daily-close" className="gacha-summary__btn" highlight onClick={simple.onClose} data-testid={simple.testId ?? 'gacha-daily-close'}>
            {simple.label}
          </RoughButton>
        </div>
      ) : (
      <div className="gacha-summary__buttons">
        <RoughButton seed="gacha-again" className="gacha-summary__btn" highlight={canAgain} disabled={!canAgain} onDisabledClick={onNoCoins} onClick={onAgain}>
          {tr.gacha.again}
        </RoughButton>
        <RoughButton seed="gacha-shop" className="gacha-summary__btn" onClick={onShop}>
          {tr.gacha.toShop}
        </RoughButton>
      </div>
      )}
      {asking !== null && (
        <Dialog
          seed="gacha-convert"
          title={tr.gacha.convertTitle}
          onClose={() => setAsking(null)}
          actions={
            <>
              <RoughButton seed="convert-no" onClick={() => setAsking(null)}>
                {tr.common.cancel}
              </RoughButton>
              <RoughButton
                seed="convert-yes"
                highlight
                onClick={() => {
                  const i = asking;
                  setAsking(null);
                  onConvert(i, document.querySelector<HTMLElement>(`[data-testid="gacha-result-${i}"]`));
                  setConverted((s) => new Set(s).add(i));
                }}
              >
                {tr.gacha.convertYes}
              </RoughButton>
            </>
          }
        >
          {tr.gacha.convertText(CARD_DB[results[asking].no].name, DRAW.superToCoins)}
        </Dialog>
      )}
    </div>
  );
}
