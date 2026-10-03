import { gsap } from 'gsap';
import { useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { audio } from '../../audio/audioManager';
import { CARD_DB, cardById } from '../../data/cards';
import { type PackDef, SHOP_PACKS } from '../../data/packs';
import { addDailyProgress, dailyPack } from '../../daily/daily';
import { addDailyNotice } from '../../daily/noticeStore';
import { useFx } from '../../fx/fxSettings';
import { setFxSpeed } from '../../fx/timing';
import { DRAW, type Bag, type Offer, type PullResult, applyPull, canAfford, coinsRoomFor, cardRate, convertSuper, cryptoRand, drawBags, superRate } from '../../gacha/gacha';
import { useT } from '../../i18n/useT';
import { useNav } from '../../router';
import { useSave } from '../../state/SaveContext';
import { CardMini } from '../../ui/card/CardMini';
import { CoinCounter, centerIn, flyCoins } from '../../ui/coin/Coin';
import { Dialog } from '../../ui/common/Dialog';
import { RoughButton } from '../../ui/rough/RoughButton';
import { Opening } from './Opening';
import { PackArt } from './PackArt';
import { Summary } from './Summary';
import { ModeGuide } from '../../ui/guide/ModeGuide';
import './gacha.css';

/** デイリーパックの開封（確定のミッションの報酬。保存は済んでいる。v2.1-M） */
export type DailyRun = { bags: Bag[]; results: PullResult[]; coinsBefore: number; coins: number };

/**
 * 画面に渡す値。packId・guideOffer：チュートリアルの最後の案内から来た時に選んでおくパックと、蛍光ペンで囲むボタン（UPDATE_v2 §6T-6）。
 * daily：デイリーミッションの報酬のデイリーパックを開ける（SPEC §7 S17）
 */
export type GachaPayload = { packId?: string; guideOffer?: string; daily?: DailyRun } | null;

/** offer が null はデイリーパック（買ったのではない） */
type Run = { pack: PackDef; packIndex: number; offer: Offer | null; bags: Bag[]; results: PullResult[] };

/** S09 パックガチャ（SPEC §7 S09・UPDATE_v2 §6） */
export function GachaScene() {
  const { go, payload } = useNav();
  const guide = payload as GachaPayload;
  const { save, update } = useSave();
  const tr = useT();
  const fx = useFx();
  const packs = SHOP_PACKS;
  const [index, setIndex] = useState(() => Math.max(0, packs.findIndex((p) => p.id === guide?.packId)));
  const daily = guide?.daily ?? null;
  const [view, setView] = useState<'shop' | 'open' | 'summary'>(daily ? 'open' : 'shop');
  const [run, setRun] = useState<Run | null>(() => (daily ? { pack: dailyPack(), packIndex: -1, offer: null, bags: daily.bags, results: daily.results } : null));
  /** デイリーパックの50コインは、まとめ画面に出てから飛んでくる。それまでコイン表示は前の枚数 */
  const [heldCoins, setHeldCoins] = useState<number | null>(daily ? daily.coinsBefore : null);
  const [contents, setContents] = useState(false);
  const [msg, setMsg] = useState<{ text: string; n: number } | null>(null);
  const artRef = useRef<HTMLDivElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  /** スワイプで切り替えた直後の click は「なかみ」を開かない */
  const swiped = useRef(false);
  /** いちばん安い買い方の1袋あたりの値段（「○まい おとく」の計算に使う） */
  const base = DRAW.offers[0];
  const pack = packs[index];

  useEffect(() => setFxSpeed(fx.speed), [fx.speed]);
  useEffect(() => {
    if (!msg) return;
    const id = window.setTimeout(() => setMsg(null), 1800);
    return () => window.clearTimeout(id);
  }, [msg]);

  /** パックを切り替える（パックが横に滑る） */
  const slide = (dir: 1 | -1) => {
    const next = (index + dir + packs.length) % packs.length;
    setIndex(next);
    audio.play('se_page');
    if (artRef.current) gsap.fromTo(artRef.current, { x: dir * 360, rotate: dir * 8, opacity: 0 }, { x: 0, rotate: 0, opacity: 1, duration: fx.reduceFx ? 0.15 : 0.4, ease: 'power3.out' });
  };

  /** コインが たりないよ（押せないボタンを押した時。音はボタンが鳴らす） */
  const noCoins = () => setMsg((m) => ({ text: tr.gacha.noCoins, n: (m?.n ?? 0) + 1 }));

  /** 引く：コインを減らし、カードを足すのを1回の保存で行ってから、演出する（SPEC §7 S09） */
  const buy = (offer: Offer, packIndex = index) => {
    if (!canAfford(save, offer)) {
      noCoins();
      return;
    }
    const bags = drawBags(packs[packIndex], offer.bags, cryptoRand);
    // デイリーミッション「パックガチャを 1かい ひく」も同じ保存で数える（その日が変わっていたら入れ替え、前の日の報酬の知らせを置く）
    const now = Date.now();
    const carry = addDailyProgress(structuredClone(save), now, { gacha: true });
    // 保存したのと同じ計算の結果（NEW・換金できるか）を画面に出す。flushSync で、保存をこの場で済ませてから読む
    let results: PullResult[] | null = null;
    flushSync(() =>
      update((d) => {
        results = applyPull(d, offer, bags);
        if (results) addDailyProgress(d, now, { gacha: true });
      }),
    );
    if (!results) return;
    if (carry) addDailyNotice(carry);
    audio.play('se_coin');
    setRun({ pack: packs[packIndex], packIndex, offer, bags, results });
    setView('open');
  };

  /** デイリーパックのまとめ画面が出た：確定のミッションのコイン（+50）が飛んでくる */
  const landDailyCoins = (from: HTMLElement | null) => {
    const L = layerRef.current;
    if (!daily || heldCoins === null) return;
    if (!L || !from || daily.coins <= 0) {
      setHeldCoins(null);
      return;
    }
    audio.play('se_coin_burst');
    void flyCoins(L, centerIn(L, from), 16, { reduce: fx.reduceFx, burst: true }).then(() => setHeldCoins(null));
  };

  // 所持数はセーブの数そのもの（デバッグの「ぜんぶ もっている」でも ∞ と出さない）
  const owned = (no: number) => save.collection[no] ?? 0;

  return (
    <div className={`gacha-scene gacha-scene--${pack.color}`} data-testid="gacha-scene">
      <h1 className="gacha-scene__title">{daily ? run?.pack.name : tr.gacha.title}</h1>
      <CoinCounter value={heldCoins ?? save.coins} className="gacha-scene__coins" />
      {view !== 'open' && (
        <RoughButton seed="gacha-back" className="gacha-scene__back" onClick={() => (view === 'summary' && !daily ? setView('shop') : go('menu'))}>
          {tr.common.back}
        </RoughButton>
      )}

      {view === 'shop' && (
        <>
          <ModeGuide mode="gacha" className="gacha-scene__guide" />
          <RoughButton seed="gacha-prev" className="gacha-scene__arrow gacha-scene__arrow--prev" ariaLabel={tr.gacha.prev} onClick={() => slide(-1)}>
            ◀
          </RoughButton>
          <RoughButton seed="gacha-next" className="gacha-scene__arrow gacha-scene__arrow--next" ariaLabel={tr.gacha.next} onClick={() => slide(1)}>
            ▶
          </RoughButton>
          <div
            className="gacha-scene__pack"
            ref={artRef}
            role="button"
            tabIndex={0}
            aria-label={tr.gacha.tapPack}
            onClick={() => {
              if (swiped.current) {
                swiped.current = false;
                return;
              }
              setContents(true);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                setContents(true);
              }
            }}
            onPointerDown={(e) => {
              swiped.current = false;
              artRef.current!.dataset.x = String(e.clientX);
            }}
            onPointerUp={(e) => {
              // スワイプでも切り替える
              const x0 = Number(artRef.current?.dataset.x ?? e.clientX);
              if (Math.abs(e.clientX - x0) > 50) {
                swiped.current = true;
                slide(e.clientX < x0 ? 1 : -1);
              }
            }}
            data-testid="gacha-pack"
          >
            <PackArt pack={pack} />
          </div>
          <p className="gacha-scene__packname">{pack.name}</p>
          <p className="gacha-scene__tap pencil">{tr.gacha.tapPack}</p>
          <div className="gacha-scene__offers">
            {DRAW.offers.map((o) => {
              const ok = canAfford(save, o);
              return (
                <div key={o.id} className={`gacha-offer ${guide?.guideOffer === o.id ? 'is-guide' : ''}`}>
                  <RoughButton
                    seed={`offer-${o.id}`}
                    className="gacha-offer__btn"
                    highlight={ok}
                    disabled={!ok}
                    onDisabledClick={noCoins}
                    strokeWidth={3}
                    onClick={() => buy(o)}
                    data-testid={`gacha-buy-${o.id}`}
                  >
                    <span className="gacha-offer__bags">{tr.gacha.bags(o.bags)}</span>
                    <span className="gacha-offer__price num">{tr.gacha.price(o.price)}</span>
                    {bonusOf(o, base) > 0 && <span className="gacha-offer__bonus">{tr.gacha.bonus(bonusOf(o, base))}</span>}
                  </RoughButton>
                  {guide?.guideOffer === o.id && <GuideCircle />}
                </div>
              );
            })}
          </div>
        </>
      )}

      {view === 'open' && run && (
        <Opening pack={run.pack} bags={run.bags} results={run.results} onDone={() => setView('summary')} />
      )}

      {view === 'summary' && run && (
        <Summary
          results={run.results}
          owned={owned}
          simple={daily ? { label: tr.daily.toMenu, onClose: () => go('menu'), onShown: (from) => landDailyCoins(from) } : undefined}
          canAgain={!!run.offer && canAfford(save, run.offer)}
          onNoCoins={noCoins}
          roomForCoins={coinsRoomFor(save)}
          onConvert={(i, from) => {
            update((d) => void convertSuper(d, run.results[i].no));
            audio.play('se_coin_burst');
            // コインがカードから飛んで、右上のコイン表示へ
            const L = layerRef.current;
            if (L && from) void flyCoins(L, centerIn(L, from), 12, { reduce: fx.reduceFx, burst: true });
          }}
          onAgain={() => run.offer && buy(run.offer, run.packIndex)}
          onShop={() => setView('shop')}
        />
      )}

      {contents && (
        <Dialog seed="gacha-contents" title={tr.gacha.contentsTitle(pack.name)} width={960} onClose={() => setContents(false)} actions={
          <RoughButton seed="contents-close" onClick={() => setContents(false)}>
            {tr.common.close}
          </RoughButton>
        }>
          <p className="gacha-contents__note">{tr.gacha.rateNote(pct(superRate(pack)), pct(DRAW.doubleRate))}</p>
          {(['super', 'normal'] as const).map((kind) => (
            <div key={kind} className={`gacha-contents__group gacha-contents__group--${kind}`}>
              <h3 className="gacha-contents__head">{kind === 'super' ? tr.gacha.super : tr.gacha.normal}</h3>
              <div className="gacha-contents__grid">
                {[...new Set(pack[kind])].map((id) => {
                  const def = cardById(id)!;
                  const n = owned(def.no);
                  return (
                    <div key={id} className="gacha-contents__item" data-testid={`gacha-rate-${id}`}>
                      <CardMini def={CARD_DB[def.no]} seed={`contents-${id}`} variant="slot" unowned={n === 0} />
                      <span className="gacha-contents__rate num">{tr.gacha.rate(pct(cardRate(pack, id)))}</span>
                      <span className="gacha-contents__owned">{n > 0 ? tr.gacha.ownedCount(n) : tr.gacha.unknown}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </Dialog>
      )}

      <div className="gacha-scene__layer" ref={layerRef} aria-hidden />

      {msg && (
        <div key={msg.n} className="gacha-scene__msg red-pen" role="status">
          {msg.text}
        </div>
      )}
    </div>
  );
}

/** 同じコインで、いちばん安い買い方より何袋多いか */
function bonusOf(o: Offer, base: Offer): number {
  return o.bags - Math.floor((o.price / base.price) * base.bags);
}

/** 確率を % の文字に（小数2桁まで。0 は付けない） */
function pct(p: number): string {
  return String(Math.round(p * 10000) / 100);
}

/** チュートリアルの案内：ボタンを蛍光ペンで丸く囲む */
function GuideCircle() {
  return (
    <svg className="gacha-guide" viewBox="0 0 340 130" aria-hidden>
      <path d="M30 70 Q28 14 170 12 Q318 10 322 64 Q326 120 168 120 Q20 122 26 60 Q30 30 90 18" fill="none" stroke="var(--marker-yellow)" strokeWidth="14" strokeLinecap="round" />
      <path d="M30 70 Q28 14 170 12 Q318 10 322 64 Q326 120 168 120 Q20 122 26 60 Q30 30 90 18" fill="none" stroke="var(--pen-red)" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}
