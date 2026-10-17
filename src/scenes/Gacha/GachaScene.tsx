import { gsap } from 'gsap';
import { preloadCards } from '../../ui/imageLoader';
import { useEffect, useRef, useState } from 'react';
import { useGiftHold } from '../../online/giftHold';
import { flushSync } from 'react-dom';
import { audio } from '../../audio/audioManager';
import { CARD_DB, cardById } from '../../data/cards';
import { type PackDef, SHOP_PACKS, packName } from '../../data/packs';
import { consumeOwnedPack, drawOwnedPack, ownedPackList } from '../../gift/ownedPacks';
import { addDailyProgress, dailyPack } from '../../daily/daily';
import { addDailyNotice } from '../../daily/noticeStore';
import { postState, setPostState } from '../../tutorial/post';
import { nextU32, seedRng } from '../../engine/rng';
import { TUTORIAL_PACK } from '../Tutorial/PostGuide';
import { useIsSandbox } from '../../state/SaveContext';
import { useFx } from '../../fx/fxSettings';
import { setFxSpeed } from '../../fx/timing';
import { DRAW, type Bag, type Offer, type PullResult, applyPull, canAfford, coinsRoomFor, cardRate, convertSuper, cryptoRand, drawOffer, superRate } from '../../gacha/gacha';
import { useLang, useT } from '../../i18n/useT';
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
 * 画面に渡す値。daily：デイリーミッションの報酬のデイリーパックを開ける（SPEC §7 S17）
 */
export type GachaPayload = { daily?: DailyRun } | null;

/** offer が null はデイリーパック（買ったのではない） */
type Run = { pack: PackDef; packIndex: number; offer: Offer | null; bags: Bag[]; results: PullResult[] };

/** S09 パックガチャ（SPEC §7 S09・UPDATE_v2 §6） */
export function GachaScene() {
  const { go, payload } = useNav();
  const guide = payload as GachaPayload;
  const { save, update } = useSave();
  const tr = useT();
  const lang = useLang();
  const fx = useFx();
  const packs = SHOP_PACKS;
  // チュートリアルの延長の中は、案内しているパック（元祖パック）から
  const [index, setIndex] = useState(() => (postState().active ? Math.max(0, packs.findIndex((p) => p.id === TUTORIAL_PACK)) : 0));
  const daily = guide?.daily ?? null;
  const [view, setView] = useState<'shop' | 'open' | 'summary'>(daily ? 'open' : 'shop');
  // 袋を開けている間は、トロフィあげが届いた演出を出さない（v2.7。終わってから）
  useGiftHold('gacha', view === 'open');
  const [run, setRun] = useState<Run | null>(() => (daily ? { pack: dailyPack(), packIndex: -1, offer: null, bags: daily.bags, results: daily.results } : null));
  /** デイリーパックの50コインは、まとめ画面に出てから飛んでくる。それまでコイン表示は前の枚数 */
  const [heldCoins, setHeldCoins] = useState<number | null>(daily ? daily.coinsBefore : null);
  const [contents, setContents] = useState(false);
  const [msg, setMsg] = useState<{ text: string; n: number } | null>(null);
  const artRef = useRef<HTMLDivElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  /** スワイプで切り替えた直後の click は「なかみ」を開かない */
  const swiped = useRef(false);
  // チュートリアルの延長の中（UPDATE_v2_1 §6-2 #16〜#19）。見返しの時は見本（決まった見本のカード。§6-3）
  const [tutorial] = useState(() => postState().active);
  const [sample] = useState(() => postState().active && postState().review);
  const sandbox = useIsSandbox();
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
    // 10まいは最後の袋がスーパーレア確定（v2.2。packs.json の lastBagSuper）
    const bags = drawOffer(packs[packIndex], offer, sample ? sampleRand() : cryptoRand);
    // チュートリアル：スーパーおてあげを2種類以上引いたら、#24 で「1まいまで。どれを つかうか えらんでね」
    // デイリーミッション「パックガチャを 1かい ひく」も同じ保存で数える（その日が変わっていたら入れ替え、前の日の報酬の知らせを置く）
    const now = Date.now();
    const carry = addDailyProgress(structuredClone(save), now, { gacha: true });
    // 保存したのと同じ計算の結果（NEW・換金できるか）を画面に出す。flushSync で、保存をこの場で済ませてから読む
    let results: PullResult[] | null = null;
    flushSync(() =>
      update((d) => {
        results = applyPull(d, offer, bags);
        if (results) addDailyProgress(d, now, { gacha: true });
        // チュートリアルの延長（本物のガチャ）：引いたら、次の再開はデッキ編集から（もう一度引かないように）
        if (results && tutorial && !sample && !d.tutorial.done) d.tutorial.step = Math.max(d.tutorial.step, 20);
      }),
    );
    if (!results) return;
    const got = results as PullResult[];
    // 結果が決まった：当たったカードの絵を、すぐ読み始める（めくる時に出ているように。v2.4）
    void preloadCards(got.map((r) => r.no), 'high');
    // チュートリアル：スーパーの種類の数（#24 の補足）と、初めて手に入れたカード（デッキ編集の一覧に NEW の印）
    if (tutorial) setPostState({ supers: new Set(got.filter((r) => r.super).map((r) => r.no)).size, newCards: [...new Set(got.filter((r) => r.isNew).map((r) => r.no))] });
    // 練習用の写しの中では、セーブの外の知らせを書かない
    if (carry && !sandbox) addDailyNotice(carry);
    audio.play('se_coin');
    setRun({ pack: packs[packIndex], packIndex, offer, bags, results });
    setView('open');
  };

  /** もっている パック（大会パックなど。v2.7）を1つ開ける：減らすのとカードを足すのを1回の保存で行ってから、デイリーパックと同じ演出 */
  const openOwned = (p: PackDef) => {
    const bags = drawOwnedPack(p, cryptoRand);
    let results: PullResult[] | null = null;
    flushSync(() =>
      update((d) => {
        results = consumeOwnedPack(d, p.id, bags);
      }),
    );
    if (!results) return;
    void preloadCards((results as PullResult[]).map((r) => r.no), 'high');
    audio.play('se_card_place');
    setRun({ pack: p, packIndex: -1, offer: null, bags, results });
    setView('open');
  };
  // チュートリアル（見返しの写しのセーブ）の中では出さない
  const ownedList = tutorial || sandbox ? [] : ownedPackList(save);

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
          {/* もっている パック（v2.7。大会パックなど。好きな時に開ける） */}
          {ownedList.length > 0 && (
            <div className="gacha-owned" data-testid="gacha-owned">
              <h2 className="gacha-owned__title">{tr.gacha.ownedTitle}</h2>
              {ownedList.map(({ pack: p, count }) => (
                <div key={p.id} className="gacha-owned__row" data-testid={`gacha-owned-${p.id}`}>
                  <div className="gacha-owned__art">
                    <PackArt pack={p} className="pack-art--thumb" />
                  </div>
                  <div className="gacha-owned__info">
                    <span className="gacha-owned__name">{packName(p, lang)}</span>
                    <span className="gacha-owned__count num" data-testid={`gacha-owned-count-${p.id}`}>
                      {tr.gacha.ownedPacks(count)}
                    </span>
                    <RoughButton seed={`owned-open-${p.id}`} className="gacha-owned__open" highlight strokeWidth={3} onClick={() => openOwned(p)} data-testid={`gacha-owned-open-${p.id}`}>
                      {tr.gacha.ownedOpen}
                    </RoughButton>
                  </div>
                </div>
              ))}
            </div>
          )}
          <p className="gacha-scene__tap pencil">{tr.gacha.tapPack}</p>
          <div className="gacha-scene__offers">
            {DRAW.offers.map((o) => {
              const ok = canAfford(save, o);
              return (
                <div key={o.id} className="gacha-offer">
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
          simple={
            daily
              ? { label: tr.daily.toMenu, onClose: () => go('menu'), onShown: (from) => landDailyCoins(from) }
              : tutorial
                ? { label: tr.tutorial.toDeck, onClose: () => go('deck'), onShown: () => {}, testId: 'gacha-tutorial-deck' }
                : undefined
          }
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
          <p className="gacha-contents__note">{tr.gacha.rateNote(pct(superRate(pack)))}</p>
          {/* 10まいの確定と、光る袋（v2.2） */}
          {DRAW.offers
            .filter((o) => o.lastBagSuper)
            .map((o) => (
              <p key={o.id} className="gacha-contents__note gacha-contents__note--big red-pen" data-testid="gacha-guarantee-note">
                {tr.gacha.guaranteeNote(o.bags)}
              </p>
            ))}
          <p className="gacha-contents__note gacha-contents__note--glow" data-testid="gacha-glow-note">
            {tr.gacha.glowNote}
          </p>
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

/** チュートリアルの見返しの見本：いつも同じ袋が出る種付きの乱数（UPDATE_v2_1 §6-3「決まった見本のカード」。エンジンと同じ乱数） */
function sampleRand(): () => number {
  const st = seedRng('oteca-tutorial-sample');
  return () => nextU32(st) / 4294967296;
}

/** 同じコインで、いちばん安い買い方より何袋多いか */
function bonusOf(o: Offer, base: Offer): number {
  return o.bags - Math.floor((o.price / base.price) * base.bags);
}

/** 確率を % の文字に（小数2桁まで。0 は付けない） */
function pct(p: number): string {
  return String(Math.round(p * 10000) / 100);
}

