import { gsap } from 'gsap';
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

export type ResultPayload = {
  setup: BattleSetup;
  winner: Side;
  reason: EndReason;
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

  const again = () => {
    if (!link) {
      go('battle', rematchSetup(r.setup));
      return;
    }
    setWaitingRematch(true);
    link.requestRematch();
  };
  const toMenu = () => {
    if (r.setup.mode === 'online') endOnline();
    go('menu');
  };
  const rematchNote = agree === false
    ? tr.result.disagree
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

  // 勝敗数をセーブデータに記録（フレンド対戦は stats、CPU対戦は強さごとの cpuStats。中断・切断は記録しない）
  useEffect(() => {
    if (recorded.current || !r.setup.record) return;
    if (r.setup.mode === 'online' && agree !== true) return;
    recorded.current = true;
    // 対戦の報酬（SPEC §7 S11）：勝敗の記録と同じ保存で、コイン（と今日の試合数）を足す
    const kind = rewardKindFor(r.setup, agree);
    const today = todayKey(new Date());
    const info: MatchInfo = { kind, cpuLevel: r.setup.cpuLevel, win, turnCounts: r.stats.turnCounts };
    // 表示用の見積もり（保存は下の update の中で、同じ計算で行う）
    const got = matchReward(save, info, today);
    const before = save.coins;
    update((d) => {
      const rec = r.setup.mode === 'cpu' ? d.cpuStats[CPU_LEVELS.indexOf(r.setup.cpuLevel ?? 'normal')] : d.stats;
      if (rec) {
        if (win) rec.wins += 1;
        else rec.losses += 1;
      }
      applyMatchReward(d, info, today);
    });
    setReward({ ...got, coins: Math.min(got.coins, ECONOMY.coinsMax - before), before });
  }, [r.setup.record, r.setup.mode, r.setup.cpuLevel, r.stats.turnCounts, update, win, agree, save]);

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
        {tr.result.reason[r.reason]}
        {hotSeat ? '' : win ? tr.result.youWin : tr.result.oppWins(r.setup.names[opp])}
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
        <RoughButton seed="result-again" className="result__btn" highlight={!waitingRematch && !oppGone} disabled={waitingRematch || oppGone} onClick={again}>
          {tr.result.again}
        </RoughButton>
        {r.setup.mode === 'cpu' && !r.setup.debug && (
          <RoughButton seed="result-level" className="result__btn" onClick={() => go('cpu')}>
            {tr.result.changeLevel}
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
          {reward.status === 'limit' && <p className="result__reward-note pencil">{tr.result.rewardLimit}</p>}
          {reward.status === 'short' && <p className="result__reward-note pencil">{tr.result.rewardShort}</p>}
        </div>
      )}
      {rematchNote && (
        <p className={`result__wait ${oppWants && !oppGone ? 'blue-pen' : 'pencil'}`} data-testid="rematch-note">
          {rematchNote}
        </p>
      )}
    </div>
  );
}
