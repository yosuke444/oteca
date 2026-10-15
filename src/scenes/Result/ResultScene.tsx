import { gsap } from 'gsap';
import { buildMatchLog, sendMatchLog, shouldSendMatchLog } from '../../online/matchLog';
import { preloadCards } from '../../ui/imageLoader';
import { useEffect, useRef, useState } from 'react';
import { audio } from '../../audio/audioManager';
import { useFx } from '../../fx/fxSettings';
import { Particles } from '../../fx/particles';
import { playLose, playWin, stopResultFx } from '../../fx/resultFx';
import { buildActionLog, downloadActionLog } from '../../battle/actionLog';
import { type BattleSetup, badOnlineStart, onlineSetup } from '../../battle/setup';
import { currentOnline, endOnline } from '../../net/online';
import { isDebugMode } from '../../router';
import type { MatchStats } from '../../battle/stats';
import { CARD_DB } from '../../data/cards';
import type { Action, EndReason, Side } from '../../engine/types';
import { useNav } from '../../router';
import { useSave } from '../../state/SaveContext';
import { CardMini } from '../../ui/card/CardMini';
import { CPU_LEVELS } from '../../cpu/brains';
import { OtegeArt } from '../../ui/common/OtegeArt';
import { RoughBox } from '../../ui/rough/RoughBox';
import { RoughButton } from '../../ui/rough/RoughButton';
import { rematchSetup } from '../Battle/BattleScene';
import './result.css';
import { useT } from '../../i18n/useT';
import { ECONOMY, type MatchInfo, type RewardResult, applyMatchReward, matchReward, rewardKindFor, todayKey } from '../../economy/rewards';
import { CoinCounter, CoinIcon, centerIn, flyCoins } from '../../ui/coin/Coin';
import { type StoryReward, applyStoryResult, opensAfter, stageByNo } from '../../story/story';
import { LimitedCardFx } from '../Story/LimitedCardFx';
import { useGiftHold } from '../../online/giftHold';
import type { StoryPayload } from '../Story/StoryScene';
import '../Story/story.css';
import { DeckPickerDialog } from '../../ui/deck/DeckPicker';
import { type RateChange, applyRateResult, rateOutcome } from '../../online/rate';
import { markProvisional, queueReport, reportWinner } from '../../online/ranking';
import { features } from '../../config/features';
import { KariMark } from '../../ui/common/RateValue';
import { type DailyMatchKind, addDailyProgress, cycleKeyAt, dailyMatchKind, matchProgress } from '../../daily/daily';
import { addDailyNotice } from '../../daily/noticeStore';
import type { SaveData } from '../../save/saveData';
import type { LobbyPayload } from '../Lobby/LobbyScene';
import type { RatePayload } from '../Online/RateScene';

export type ResultPayload = {
  setup: BattleSetup;
  winner: Side;
  /** disconnect：オンライン対戦で相手の通信が切れた・部屋を出た（残った側の勝ち。v2.0-G・v2.4 でフレンド対戦も） */
  reason: EndReason | 'disconnect';
  stats: MatchStats;
  log: Action[];
  /** 最後の状態ハッシュ（行動ログの保存用） */
  finalHash: string;
};

/** S05 リザルト（SPEC §7） */
export function ResultScene() {
  const { payload, go } = useNav();
  const r = payload as ResultPayload;
  const { save, update } = useSave();
  const tr = useT();
  const recorded = useRef(false);
  const me = r.setup.me;
  const opp: Side = me === 'p1' ? 'p2' : 'p1';
  const hotSeat = r.setup.mode === 'local';
  const win = r.winner === me;
  const s = r.stats.sides[hotSeat ? r.winner : me];
  const mvp = s.mvpNo !== null ? CARD_DB[s.mvpNo] : null;
  // フレンド対戦の再戦（両者が「もういっかい」を押したら先攻決めから。SPEC §7 S05）
  const link = r.setup.mode === 'online' ? currentOnline() : null;
  const [waitingRematch, setWaitingRematch] = useState(false);
  const [oppWants, setOppWants] = useState(link?.oppRematch ?? false);
  const [oppGone, setOppGone] = useState(r.setup.mode === 'online' && !link);
  // 決着の結果が2人でそろったか（同時に降参した時など、食い違ったら記録しない）
  const [agree, setAgree] = useState<boolean | null>(link ? link.resultAgree : null);
  useEffect(() => (link ? link.on('result', setAgree) : undefined), [link]);


  useEffect(() => {
    if (!link) return;
    const offs = [
      link.on('oppRematch', () => setOppWants(true)),
      link.on('start', (g) => {
        if (g.game <= (r.setup.game ?? 0)) return;
        if (badOnlineStart(g)) {
          endOnline();
          setOppGone(true);
          return;
        }
        go('battle', onlineSetup(g, isDebugMode()));
      }),
      link.on('status', (st) => {
        if (st.kind === 'aborted') setOppGone(true);
      }),
    ];
    return () => offs.forEach((f) => f());
  }, [link, go, r.setup.game]);

  // 「デッキを かえる」（v2.0-G）：次の試合から。CPU対戦の「もういっかい」も新しいデッキで
  const [picking, setPicking] = useState(false);
  const [myCards, setMyCards] = useState<number[] | null>(null);
  const changeDeck = (i: number) => {
    update((d) => void (d.selectedDeck = i));
    setMyCards(save.decks[i].cards);
    link?.session.setDeck(save.decks[i].cards, save.decks[i].name);
    setPicking(false);
  };
  // 相手が「ほかの ひとと あそぶ」で部屋に戻った・部屋に まちあい の人がいる（v2.0-G）
  const [oppBack, setOppBack] = useState(link?.oppBack ?? false);
  const [othersWaiting, setOthersWaiting] = useState(link?.session.othersWaiting ?? false);
  useEffect(() => {
    if (!link) return;
    const offs = [link.on('oppBack', () => setOppBack(true)), link.on('members', () => setOthersWaiting(link.session.othersWaiting))];
    return () => offs.forEach((f) => f());
  }, [link]);
  const toRoom = () => {
    link?.backToRoom();
    go('lobby', { backToRoom: true } satisfies LobbyPayload);
  };
  // 相手が部屋に戻った（自分も まちあい になった）：「あいては へやに もどったよ」を少し見せてから へやの なかま へ
  // （リザルトに居たまま申し込まれたり、2人の部屋で自動で始まったりしないように）
  useEffect(() => {
    if (!oppBack || !link || rated) return;
    const id = window.setTimeout(() => go('lobby', { backToRoom: true } satisfies LobbyPayload), fxRef.current.dur(2200));
    return () => window.clearTimeout(id);
  }, [oppBack]);

  const again = () => {
    if (!link) {
      const s = rematchSetup(r.setup);
      go('battle', myCards ? { ...s, decks: { ...s.decks, [me]: myCards } } : s);
      return;
    }
    setWaitingRematch(true);
    link.requestRematch();
  };
  const toMenu = () => {
    if (r.setup.mode === 'online') endOnline();
    go('menu');
  };
  const rematchNote = r.reason === 'disconnect'
    ? ''
    : agree === false
    ? tr.result.disagree
    : oppBack
    ? tr.result.oppBack
    : oppGone
    ? tr.result.oppLeft
    : waitingRematch
      ? oppWants
        ? tr.result.starting
        : tr.result.waitingOpp
      : oppWants
        ? tr.result.oppWaiting
        : '';

  /** もらった報酬（表示用）。before はもらう前の枚数（コインが飛んでくるまで前の枚数を見せる） */
  const [reward, setReward] = useState<(RewardResult & { before: number }) | null>(null);
  const [coinsLanded, setCoinsLanded] = useState(false);

  /**
   * デイリーミッション（SPEC §7 S17）：この試合の分を数える準備。保存は勝敗の記録と同じ update の中で apply(d) を呼ぶ。
   * その日が変わっていて前の日の報酬を自動で受け取った時の知らせは、写しで先に計算して置く（保存は同じ計算で1回）
   */
  const dailyKind = (rateDecided?: boolean) =>
    dailyMatchKind({
      mode: r.setup.mode,
      record: r.setup.record,
      debug: r.setup.debug,
      rated: !!r.setup.rated,
      story: !!r.setup.story,
      reason: r.reason,
      agree,
      rateDecided,
      win,
      turnCounts: r.stats.turnCounts,
      minTurns: ECONOMY.minTurnsEach,
    });
  const dailyFor = (kind: DailyMatchKind | null) => {
    if (!kind) return null;
    const now = Date.now();
    const p = matchProgress(kind, win, r.stats.sides[me]);
    const carry = addDailyProgress(structuredClone(save), now, p);
    if (carry) addDailyNotice(carry);
    return (d: SaveData) => void addDailyProgress(d, now, p);
  };

  // 勝敗数をセーブデータに記録（フレンド対戦は stats、CPU対戦は強さごとの cpuStats。中断は記録しない。相手の切断は残った側の勝ち（v2.4））
  useEffect(() => {
    if (recorded.current || !r.setup.record || r.setup.rated) return;
    // 相手の通信が切れて勝った試合（v2.4）は、結果がそろわなくても勝ちとして書く（ふだんの勝ちと同じコイン。両者2ターン以上の決まりは同じ）
    const settled = r.reason === 'disconnect' ? true : agree;
    if (r.setup.mode === 'online' && settled !== true) return;
    recorded.current = true;
    // 対戦の報酬（SPEC §7 S11）：勝敗の記録と同じ保存で、コイン（と今日の試合数）を足す
    const kind = rewardKindFor(r.setup, settled);
    const today = todayKey(new Date());
    // CPU対戦の回数の区切り（見積もりと保存で同じ値を使う。v2.7）
    const cycle = cycleKeyAt(Date.now());
    const info: MatchInfo = { kind, cpuLevel: r.setup.cpuLevel, win, turnCounts: r.stats.turnCounts };
    // 表示用の見積もり（保存は下の update の中で、同じ計算で行う）
    const got = matchReward(save, info, today, cycle);
    const before = save.coins;
    // デイリーミッション：CPU・フレンド（デバッグ・ひとりで両方・切断・すぐ終わった試合は数えない。daily.ts dailyMatchKind）
    const daily = dailyFor(dailyKind());
    update((d) => {
      const rec = r.setup.mode === 'cpu' ? d.cpuStats[CPU_LEVELS.indexOf(r.setup.cpuLevel ?? 'normal')] : d.stats;
      if (rec) {
        if (win) rec.wins += 1;
        else rec.losses += 1;
      }
      applyMatchReward(d, info, today, cycle);
      daily?.(d);
    });
    setReward({ ...got, coins: Math.min(got.coins, ECONOMY.coinsMax - before), before });
  }, [r.setup.record, r.setup.mode, r.setup.cpuLevel, r.stats.turnCounts, update, win, agree, save]);

  // レート対戦（v2.0-G。SPEC §7 S15）：2人の結果がそろったら勝ち・負け、食い違ったら無効。相手が切れたら残った側の勝ち。
  // レート・勝敗・コイン・「レート対戦中」の印の消去を1回の保存で
  const rated = r.setup.rated;
  const [rateChange, setRateChange] = useState<RateChange | null>(null);
  useEffect(() => {
    if (!rated || recorded.current) return;
    const decided = rateOutcome({ reason: r.reason, agree, win, oppGone, online: navigator.onLine !== false });
    if (!decided) return;
    recorded.current = true;
    const { outcome } = decided;
    const today = todayKey(new Date());
    // CPU対戦の回数の区切り（見積もりと保存で同じ値を使う。v2.7）
    const cycle = cycleKeyAt(Date.now());
    const info: MatchInfo = { kind: decided.coins ? 'rate' : 'none', win, turnCounts: r.stats.turnCounts };
    const got = matchReward(save, info, today, cycle);
    const before = save.coins;
    // 「レート対戦中」の印が、この相手のものの時だけ書く（別のタブなどで先に計算していたら書かない）
    setRateChange(applyRateResult(structuredClone(save), rated.oppRate, outcome, rated.oppId) ?? { before: save.rate, after: save.rate, outcome: 'void' });
    // デイリーミッション：2人の結果がそろった試合だけ（切断・食い違い・無効・相手が消えた試合は数えない）
    const daily = dailyFor(dailyKind(decided.coins && !!applyRateResult(structuredClone(save), rated.oppRate, outcome, rated.oppId)));
    update((d) => {
      if (applyRateResult(d, rated.oppRate, outcome, rated.oppId)) {
        applyMatchReward(d, info, today, cycle);
        daily?.(d);
        if (features.ranking) {
          // ランキング（v2.0-I）：端末で計算したレートは「かり」。結果をサーバーへ送る（送れるまで セーブに残す）
          if (outcome !== 'void') markProvisional(d, Date.now(), rated.matchId ?? '');
          if (rated.matchId) queueReport(d, { matchId: rated.matchId, winner: reportWinner(outcome, d.userId, rated.oppId) });
        }
      }
    });
    setReward({ ...got, coins: Math.min(got.coins, ECONOMY.coinsMax - before), before });
  }, [agree, oppGone]);

  // 実際の対戦のデータ（v2.7。カードのバランス）：フレンド対戦・レート対戦の結果がそろったら1回だけ Worker に送る（人が分かる情報は送らない）
  const logged = useRef(false);
  useEffect(() => {
    if (logged.current || r.setup.mode !== 'online' || r.setup.debug) return;
    const settled = r.reason === 'disconnect' ? true : agree;
    if (settled === null) return;
    logged.current = true;
    if (!shouldSendMatchLog(me, r.reason)) return;
    void sendMatchLog(buildMatchLog({ mode: r.setup.rated ? 'rate' : 'friend', decks: r.setup.decks, winner: r.winner, agree: settled === true, turns: r.stats.turns, reason: r.reason }));
  }, [agree]);

  // ストーリー（SPEC §7 S08）：勝った時だけ、クリアの印・コイン・限定カードを1回の保存で。ステージ選びへ戻る時に、新しく開いたステージを渡す
  const story = r.setup.story;
  const [storyBack, setStoryBack] = useState<StoryPayload>(story ? { justCleared: undefined, opened: [] } : null);
  const [storyGot, setStoryGot] = useState<StoryReward | null>(null);
  const [showLimited, setShowLimited] = useState(false);
  useEffect(() => {
    if (!story || recorded.current) return;
    recorded.current = true;
    // デイリーミッション「ストーリーを 1かい あそぶ」などは、勝ち・負けどちらでも数える
    const daily = dailyFor(dailyKind());
    if (!win) {
      if (daily) update((d) => daily(d));
      return;
    }
    const opened = opensAfter(save, story.stage);
    const before = save.coins;
    // 表示用は、今のセーブの写しに同じ計算をして作る（保存は下の update で、同じ関数で1回）
    const res = applyStoryResult(structuredClone(save), story.stage, true);
    // 限定カードが決まった：絵を読み始める（コインが飛んだ後の特別演出で出ているように。v2.4）
    if (res?.cardNo) void preloadCards([res.cardNo]);
    update((d) => {
      applyStoryResult(d, story.stage, true);
      daily?.(d);
    });
    if (!res) return;
    // はんこ・線を描く演出は、初めてクリアした時だけ
    if (res.first) setStoryBack({ justCleared: story.stage, opened });
    setStoryGot(res);
    setReward({ status: 'ok', coins: res.coins, before });
  }, []);
  // 限定カードは、コインが飛んできたあとに特別演出（コインが上限で0枚の時は少し待ってから）
  useEffect(() => {
    if (!storyGot?.cardNo || showLimited) return;
    if (coinsLanded) {
      setShowLimited(true);
      return;
    }
    if (storyGot.coins > 0) return;
    const id = window.setTimeout(() => setShowLimited(true), fxRef.current.dur(1600));
    return () => window.clearTimeout(id);
  }, [storyGot, coinsLanded]);
  const [limitedDone, setLimitedDone] = useState(false);
  // ストーリーの限定カードの演出が終わるまでは、トロフィあげが届いた演出を出さない（v2.7。重ねない）
  useGiftHold('story-limited', !!storyGot?.cardNo && !limitedDone);

  // もらったコインが飛んでくる（勝ち・負けの演出が落ち着いてから）
  const rewardRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!reward || reward.status !== 'ok' || reward.coins <= 0) return;
    let alive = true;
    const id = window.setTimeout(async () => {
      const layer = overlayRef.current;
      const from = rewardRef.current;
      if (!alive || !layer || !from) return;
      audio.play('se_coin_burst');
      // 「+50」がポンとはねてから、コインが飛んでくる
      if (!fxRef.current.reduceFx) gsap.fromTo(from, { scale: 0.2, rotate: -20 }, { scale: 1, rotate: -4, duration: 0.5, ease: 'back.out(3)' });
      await flyCoins(layer, centerIn(layer, from), Math.min(20, 4 + Math.round(reward.coins / 5)), { reduce: fxRef.current.reduceFx, burst: true, alive: () => alive });
      if (alive) setCoinsLanded(true);
    }, fxRef.current.dur(1600));
    return () => {
      alive = false;
      window.clearTimeout(id);
    };
  }, [reward]);

  const title = hotSeat ? tr.result.winnerTitle(r.setup.names[r.winner]) : win ? tr.result.win : tr.result.lose;
  const happy = win || hotSeat;

  // 勝ち・負けの演出（SPEC §9-2）
  const fx = useFx();
  const fxRef = useRef(fx);
  fxRef.current = fx;
  const rootRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const mvpRef = useRef<HTMLDivElement>(null);
  const nextRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    // 画面を離れたら（もういっかい・メニューへ）、途中でも止めて音も鳴らさない
    let alive = true;
    const particles = new Particles(canvasRef.current!, () => fxRef.current.speed);
    const t = {
      root: rootRef.current!,
      overlay: overlayRef.current!,
      canvas: canvasRef.current!,
      title: titleRef.current!,
      mvp: mvpRef.current,
      next: nextRef.current,
      speed: () => fxRef.current.speed,
      reduce: () => fxRef.current.reduceFx,
      sound: (k: string) => {
        if (alive) audio.play(k);
      },
      particles,
    };
    void (happy ? playWin(t) : playLose(t));
    return () => {
      alive = false;
      stopResultFx(t);
      particles.dispose();
    };
  }, []);

  return (
    <div className={`result ${happy ? 'result--win' : 'result--lose'}`} ref={rootRef}>
      <h1 ref={titleRef} className={[...title].length > 5 ? "result__title result__title--long" : "result__title"}>
        <span>{title}</span>
      </h1>
      <p className="result__reason">
        {r.reason === 'disconnect' ? tr.result.reasonDisconnect : tr.result.reason[r.reason]}
        {r.reason === 'disconnect' || hotSeat ? '' : win ? tr.result.youWin : tr.result.oppWins(r.setup.names[opp])}
      </p>

      <RoughBox seed="result-memo" className="result__memo" paper radius={6}>
        <h2 className="result__memo-title">
          {tr.result.memo} {hotSeat ? tr.result.memoWho(r.setup.names[r.winner]) : ''}
        </h2>
        <ul className="result__list">
          <li>
            {tr.result.turns} <b className="num">{r.stats.turns}</b>
          </li>
          <li>
            {tr.result.damage} <b className="num">{s.damage}</b>
          </li>
          <li>
            {tr.result.kos} <b className="num">{s.kos}</b>
          </li>
          <li>
            {tr.result.mvp}
            {mvp ? <b>{mvp.name}</b> : tr.result.none}
            {mvp && <span className="pencil">{tr.result.mvpDamage(s.mvpDamage)}</span>}
          </li>
        </ul>
      </RoughBox>

      {mvp && (
        <div className="result__mvp" data-zone="mvp" ref={mvpRef}>
          <CardMini def={mvp} seed="result-mvp" variant="tile" />
          <span className="result__mvp-label">MVP</span>
        </div>
      )}

      {/* 余白の おてあげの絵（動かさない） */}
      <OtegeArt width={200} className="result__art" />

      {!happy && (
        <p className="result__next" ref={nextRef}>
          {tr.result.nextTime}
        </p>
      )}
      <div key="fx-overlay" className="fx-overlay" ref={overlayRef} />
      <canvas key="fx-particles" className="fx-particles" ref={canvasRef} />

      <div className="result__buttons">
        {rated ? (
          <RoughButton
            seed="result-next"
            className="result__btn"
            highlight={!!rateChange}
            disabled={!rateChange}
            onClick={() => {
              endOnline();
              go('rate', { autoSearch: true } satisfies RatePayload);
            }}
            data-testid="rate-next"
          >
            {tr.rate.next}
          </RoughButton>
        ) : story ? (
          <>
            {!win && (
              <RoughButton
                seed="result-retry"
                className="result__btn"
                highlight
                // ボスの再挑戦も、カットインから
                onClick={() => (stageByNo(story.stage)?.kind === 'boss' ? go('story', { retry: story.stage } satisfies StoryPayload) : again())}
                data-testid="story-retry"
              >
                {tr.story.retry}
              </RoughButton>
            )}
            <RoughButton seed="result-stages" className="result__btn" highlight={win} onClick={() => go('story', storyBack)} data-testid="story-stages">
              {tr.story.toStages}
            </RoughButton>
          </>
        ) : (
          <RoughButton seed="result-again" className="result__btn" highlight={!waitingRematch && !oppGone && !oppBack} disabled={waitingRematch || oppGone || oppBack} onClick={again}>
            {tr.result.again}
          </RoughButton>
        )}
        {r.setup.mode === 'cpu' && !r.setup.debug && !story && (
          <RoughButton seed="result-level" className="result__btn" onClick={() => go('cpu')}>
            {tr.result.changeLevel}
          </RoughButton>
        )}
        {r.setup.mode === 'online' && !rated && (othersWaiting || oppBack) && link && !oppGone && (
          <RoughButton seed="result-room" className="result__btn" onClick={toRoom} data-testid="result-room">
            {tr.result.otherPlayers}
          </RoughButton>
        )}
        {(r.setup.mode === 'online' || (r.setup.mode === 'cpu' && !story && !r.setup.debug)) && (
          <RoughButton seed="result-deck" className="result__btn" onClick={() => setPicking(true)} data-testid="result-change-deck">
            {tr.result.changeDeck}
          </RoughButton>
        )}
        <RoughButton seed="result-menu" className="result__btn" onClick={toMenu}>
          {tr.common.toMenu}
        </RoughButton>
      </div>
      {r.setup.debug && (
        <RoughButton seed="result-savelog" className="result__savelog" onClick={() => downloadActionLog(buildActionLog(r.setup, r.log, r.finalHash))}>
          {tr.result.saveLog}
        </RoughButton>
      )}
      {/* 対戦の報酬（SPEC §7 S11） */}
      {reward && reward.status !== 'none' && reward.status !== 'lose' && (
        <div className="result__reward" data-testid="result-reward">
          <CoinCounter value={reward.status === 'ok' && !coinsLanded ? reward.before : save.coins} />
          {reward.status === 'ok' && reward.coins > 0 && (
            <div ref={rewardRef} className="result__reward-got">
              <CoinIcon size={34} />
              <span className="num">{tr.coin.plus(reward.coins)}</span>
            </div>
          )}
          {reward.status === 'limit' && <p className="result__reward-note pencil">{r.setup.mode === 'cpu' ? tr.result.rewardLimitCpu : tr.result.rewardLimit}</p>}
          {reward.status === 'short' && <p className="result__reward-note pencil">{tr.result.rewardShort}</p>}
        </div>
      )}
      {rateChange && (
        <p className={`result__rate num ${rateChange.outcome === 'void' ? 'pencil' : ''}`} data-testid="rate-change">
          {rateChange.outcome === 'void' ? (
            tr.rate.voided
          ) : (
            <>
              {tr.online.rateChange(rateChange.before, rateChange.after)}
              <span className={`result__rate-diff ${rateChange.after >= rateChange.before ? 'is-up' : 'is-down'}`}>
                {rateChange.after >= rateChange.before ? '+' : ''}
                {rateChange.after - rateChange.before}
              </span>
              {features.ranking && <KariMark />}
            </>
          )}
        </p>
      )}
      {picking && (
        <DeckPickerDialog save={save} current={save.selectedDeck} mode="battle" title={tr.result.changeDeck} note={tr.lobby.nextGameNote} onPick={changeDeck} onClose={() => setPicking(false)} />
      )}
      {storyGot?.first && (
        <p className="result__story-first red-pen" data-testid="story-first">
          {tr.story.firstClear}
        </p>
      )}
      {showLimited && !limitedDone && storyGot?.cardNo && <LimitedCardFx cardNo={storyGot.cardNo} onDone={() => setLimitedDone(true)} />}
      {rematchNote && (
        <p className={`result__wait ${oppWants && !oppGone ? 'blue-pen' : 'pencil'}`} data-testid="rematch-note">
          {rematchNote}
        </p>
      )}
    </div>
  );
}
