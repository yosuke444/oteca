import { useEffect, useState } from 'react';
import { useFx } from '../../fx/fxSettings';
import { trophyCardNo } from '../../data/cards';
import { useT } from '../../i18n/useT';
import { arrivedTrophies, onArrived, shownArrived } from '../../online/mailbox';
import { giftHeld, onGiftHold } from '../../online/giftHold';
import { preloadCards } from '../../ui/imageLoader';
import type { RouteId } from '../../router';
import { LimitedCardFx } from '../Story/LimitedCardFx';
import { useSave } from '../../state/SaveContext';
import '../Story/story.css';

/**
 * トロフィあげが届いた（v2.7。SPEC §7 S20）：ストーリーのボスを倒して限定カードを手に入れた時と同じ演出で見せる。
 * どの画面の上にも出す（App の Stage の中）。ただし対戦中・ガチャの演出中・トレードの途中などは割り込まず、終わった直後に出す。
 * セーブには受け取った時に入っている（演出の途中でセーブは書き換えない）。1枚ずつ順に出す
 */

/** この画面にいる間は出さない（対戦・観戦・はじめの画面・チュートリアル・レート対戦の待合所〜VS） */
export const GIFT_HOLD_ROUTES: readonly RouteId[] = ['battle', 'spectate', 'title', 'lang', 'name', 'tutorial', 'rate'];

/** 今、演出を出してよいか（出す番号がある・印が立っていない・止める画面でない） */
/** 画面が変わってから出すまでの待ち（ミリ秒。演出スピードに合わせる）。勝ち負けの画面は、その演出が落ち着いてから */
export const GIFT_SETTLE_MS: Partial<Record<RouteId, number>> = { result: 3500 };
const SETTLE_DEFAULT_MS = 600;

export function giftVisible(shown: number | undefined, route: RouteId, hold: boolean): shown is number {
  return shown !== undefined && !hold && !giftHeld() && !GIFT_HOLD_ROUTES.includes(route);
}

export function GiftArrival({ route, hold }: { route: RouteId; hold: boolean }) {
  const tr = useT();
  const [queue, setQueue] = useState<number[]>(() => arrivedTrophies());
  const [held, setHeld] = useState(() => giftHeld());
  useEffect(() => onArrived(() => setQueue(arrivedTrophies())), []);
  useEffect(() => onGiftHold(() => setHeld(giftHeld())), []);
  const shown = queue[0];
  // 今のセーブに無い番号（データを消した・別のデータを入れた）は出さずに捨てる
  const { save } = useSave();
  const inSave = shown !== undefined && save.trophies.some((t) => t.number === shown);
  useEffect(() => {
    if (shown !== undefined && !inSave) shownArrived(shown);
  }, [shown, inSave]);
  // 画面が変わった直後は少し待つ（ほかの演出と重ねない）
  const fx = useFx();
  const [settled, setSettled] = useState<RouteId | null>(null);
  useEffect(() => {
    setSettled(null);
    const id = window.setTimeout(() => setSettled(route), fx.dur(GIFT_SETTLE_MS[route] ?? SETTLE_DEFAULT_MS));
    return () => window.clearTimeout(id);
  }, [route]);
  // 絵を先に読んでおく
  useEffect(() => {
    if (shown !== undefined) void preloadCards([trophyCardNo(shown)]);
  }, [shown]);
  // held（印）が変わると描き直す
  if (!inSave || settled !== route || !giftVisible(shown, route, hold) || held !== giftHeld()) return null;
  return (
    <div className="gift-arrival" data-testid="trophy-arrival">
      <LimitedCardFx key={shown} cardNo={trophyCardNo(shown)} title={tr.trophyGet.title} onDone={() => shownArrived(shown)} />
    </div>
  );
}
