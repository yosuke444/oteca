import { useEffect, useState } from 'react';
import { useFx } from '../../fx/fxSettings';
import { trophyCardNo } from '../../data/cards';
import { useT } from '../../i18n/useT';
import { type ArrivalItem, arrivedItems, onArrived, shownItem } from '../../online/mailbox';
import { giftHeld, onGiftHold } from '../../online/giftHold';
import { preloadCards } from '../../ui/imageLoader';
import type { RouteId } from '../../router';
import { LimitedCardFx } from '../Story/LimitedCardFx';
import { GiftFx } from './GiftFx';
import { useSave } from '../../state/SaveContext';
import '../Story/story.css';

/**
 * 届いた演出（v2.7。SPEC §7 S20）：
 * - トロフィあげ：ストーリーのボスを倒して限定カードを手に入れた時と同じ演出
 * - 贈り物（大会パックなど）：「たいかいの さんかしょう」と、パックが届く場面（GiftFx）
 * どの画面の上にも出す（App の Stage の中）。ただし対戦中・ガチャの演出中・トレードの途中などは割り込まず、終わった直後に出す。
 * セーブには受け取った時に入っている（演出の途中でセーブは書き換えない）。1つずつ順に出す
 */

/** この画面にいる間は出さない（対戦・観戦・はじめの画面・チュートリアル・レート対戦の待合所〜VS） */
export const GIFT_HOLD_ROUTES: readonly RouteId[] = ['battle', 'spectate', 'title', 'lang', 'name', 'tutorial', 'rate'];

/** 画面が変わってから出すまでの待ち（ミリ秒。演出スピードに合わせる）。勝ち負けの画面は、その演出が落ち着いてから */
export const GIFT_SETTLE_MS: Partial<Record<RouteId, number>> = { result: 3500 };
const SETTLE_DEFAULT_MS = 600;

/** 今、演出を出してよいか（出すものがある・印が立っていない・止める画面でない） */
export function giftVisible<T>(shown: T | undefined, route: RouteId, hold: boolean): shown is T {
  return shown !== undefined && !hold && !giftHeld() && !GIFT_HOLD_ROUTES.includes(route);
}

/** 今のセーブに入っているか（データを消した・別のデータを入れた後に、前の人あての演出を出さない） */
function inSaveOf(item: ArrivalItem | undefined, save: { trophies: { number: number }[]; giftIds: number[] }): boolean {
  if (!item) return false;
  return item.kind === 'trophy' ? save.trophies.some((t) => t.number === item.number) : save.giftIds.includes(item.giftId);
}

export function GiftArrival({ route, hold }: { route: RouteId; hold: boolean }) {
  const tr = useT();
  const [queue, setQueue] = useState<ArrivalItem[]>(() => arrivedItems());
  const [held, setHeld] = useState(() => giftHeld());
  useEffect(() => onArrived(() => setQueue(arrivedItems())), []);
  useEffect(() => onGiftHold(() => setHeld(giftHeld())), []);
  const shown = queue[0];
  const { save } = useSave();
  const inSave = inSaveOf(shown, save);
  // 止めている間（チュートリアルの続き・見返しの写しのセーブの中）は捨てない
  useEffect(() => {
    if (shown && !inSave && !hold) shownItem(shown.key);
  }, [shown?.key, inSave, hold]);
  // 画面が変わった直後は少し待つ（ほかの演出と重ねない）
  const fx = useFx();
  const [settled, setSettled] = useState<RouteId | null>(null);
  useEffect(() => {
    setSettled(null);
    const id = window.setTimeout(() => setSettled(route), fx.dur(GIFT_SETTLE_MS[route] ?? SETTLE_DEFAULT_MS));
    return () => window.clearTimeout(id);
  }, [route]);
  // トロフィあげの絵を先に読んでおく
  useEffect(() => {
    if (shown?.kind === 'trophy') void preloadCards([trophyCardNo(shown.number)]);
  }, [shown?.key]);
  // held（印）が変わると描き直す
  if (!inSave || settled !== route || !giftVisible(shown, route, hold) || held !== giftHeld()) return null;
  if (shown.kind === 'trophy')
    return (
      <div className="gift-arrival" data-testid="trophy-arrival">
        <LimitedCardFx key={shown.key} cardNo={trophyCardNo(shown.number)} title={tr.trophyGet.title} onDone={() => shownItem(shown.key)} />
      </div>
    );
  return (
    <div className="gift-arrival" data-testid="gift-arrival">
      <GiftFx key={shown.key} kind={shown.giftKind} count={shown.count} onDone={() => shownItem(shown.key)} />
    </div>
  );
}
