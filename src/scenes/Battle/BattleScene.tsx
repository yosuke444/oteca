import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { buildActionLog, downloadActionLog } from '../../battle/actionLog';
import { type BattleSetup, randomSeed } from '../../battle/setup';
import { addDailyProgress, countsDraws } from '../../daily/daily';
import { addDailyNotice } from '../../daily/noticeStore';
import { StatsCollector } from '../../battle/stats';
import { Match, type MatchStep } from '../../controllers/match';
import type { Controller } from '../../controllers/types';
import { CARD_DB } from '../../data/cards';
import { getLegalActions, hashState, validateAction } from '../../engine';
import type { Action, GameState, Side } from '../../engine/types';
import { type FxEnv } from '../../fx/env';
import { audio } from '../../audio/audioManager';
import { FxQueue } from '../../fx/fxQueue';
import { Particles } from '../../fx/particles';
import { setFxSpeed } from '../../fx/timing';
import { useFx } from '../../fx/fxSettings';
import { useNav } from '../../router';
import { CardDetail } from '../../ui/card/CardDetail';
import { Dialog } from '../../ui/common/Dialog';
import { RoughButton } from '../../ui/rough/RoughButton';
import { BattleBoard, type BoardSel } from './BattleBoard';
import { logLine, rejectText, useItemReason } from './battleText';
import { createControllers } from './controllersFor';
import { useSpectateBattle } from './useSpectateBattle';
import { endSpectator } from '../../net/online';
import type { AdminPayload } from '../Admin/AdminScene';
import { type SpectatePayload, finishedGames } from '../Admin/SpectateScene';
import '../Admin/admin.css';
import { useOnlineBattle } from './useOnlineBattle';
import { ChoosePanel } from './ChoosePanel';
import { STAMP_COOLDOWN_MS, StampBalloon, StampPicker, isStampId } from './Stamps';
import { currentOnline, endOnline } from '../../net/online';
import type { ResultPayload } from '../Result/ResultScene';
import './battle.css';
import { local, t } from '../../i18n';
import { stageByNo } from '../../story/story';
import { useSave } from '../../state/SaveContext';
import { applyRateResult, beginRateMatch, resolvePendingRate } from '../../online/rate';
import { clearFriendMatch, cutOutcome, matchBegun, resolvePendingFriend, startFriendMatch } from '../../online/pendingMatch';
import { markProvisional, queueReport } from '../../online/ranking';
import { features } from '../../config/features';
import type { LobbyPayload } from '../Lobby/LobbyScene';
import { useT } from '../../i18n/useT';
import { type TutorialDriver, tutorialThink } from '../../tutorial/driver';
import { think as defaultThink } from '../../cpu/thinker';
import { GuideOverlay } from '../Tutorial/GuideOverlay';

/** チュートリアル（UPDATE_v2 §6T）：案内の台本と、決着した時の行き先 */
export type BattleGuide = {
  driver: TutorialDriver;
  /** 決着した（リザルトへは進まない。勝敗・コイン・レートに数えない） */
  onOver: (winner: Side) => void;
  /** 案内の途中で「戻る」・「おてあげする」を押した（スキップの確認を出す） */
  onQuit: () => void;
  /** スキップの確認などを出している間は、案内を隠す */
  hidden?: boolean;
};

type Confirm = { title: string; text: string; yes: string; no?: string; onYes: () => void };

/** 対戦画面がいくつ出ているか（戻るボタン用の履歴の片付けに使う） */
let battleMounts = 0;

/** どちら側を画面の下にするか（ひとりで両方あやつる時は、操作する人の側） */
function perspectiveOf(view: GameState, setup: BattleSetup): Side {
  if (setup.mode !== 'local') return setup.me;
  if (view.phase === 'setup') return view.players.p1.setupChoice === null ? 'p1' : 'p2';
  if (view.phase === 'promote') return view.pendingPromote[0] ?? view.currentPlayer;
  if (view.phase === 'choose') return view.pendingChoice?.player ?? view.currentPlayer;
  return view.currentPlayer;
}

/** 操作の元になるカード */
function sourceOf(a: Action): string | null {
  switch (a.type) {
    case 'PLACE_BENCH':
    case 'SETUP_ACTIVE':
    case 'USE_ITEM':
      return a.uid;
    case 'SWAP':
    case 'PROMOTE':
      return a.benchUid;
    default:
      return null;
  }
}

/** 操作の行き先（ドロップ先・タップ先のキー） */
function targetKeyOf(a: Action, me: Side): string | null {
  switch (a.type) {
    case 'PLACE_BENCH':
      return `bench-empty:${me}`;
    case 'SETUP_ACTIVE':
    case 'SWAP':
      return `active:${me}`;
    case 'USE_ITEM':
      // おてあげに使わないアイテムは、自分の場のどこに落としても使える（onDrop で扱う）
      return a.targetUid !== undefined ? `card:${a.targetUid}` : `self:${me}`;
    default:
      return null;
  }
}

/** 最初の手札を数え終えた試合（同じ setup で2回数えない。v2.3） */
const initialCounted = new WeakSet<BattleSetup>();

/** S04 対戦（SPEC §8） */
export function BattleScene({ setup: setupProp, guide }: { setup?: BattleSetup; guide?: BattleGuide } = {}) {
  const { payload, go } = useNav();
  const setup = setupProp ?? (payload as BattleSetup);
  const { save, update: updateSave } = useSave();
  const saveRef = useRef(save);
  saveRef.current = save;
  /**
   * デイリーミッション「カードを ひく」（v2.3）：数える対戦なら、引いたその時にセーブへ足す。
   * 前の日の報酬を自動で受け取った時の知らせは、写しで先に計算して1回だけ出す（保存は同じ計算で）
   */
  const addDraws = (n: number) => {
    if (n <= 0 || !countsDraws(setup)) return;
    const now = Date.now();
    const carry = addDailyProgress(structuredClone(saveRef.current), now, { draws: n });
    if (carry) addDailyNotice(carry);
    updateSave((d) => void addDailyProgress(d, now, { draws: n }));
  };
  const fx = useFx();
  const tr = useT();

  const rootRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const matchRef = useRef<Match | null>(null);
  const queueRef = useRef<FxQueue | null>(null);
  const statsRef = useRef(new StatsCollector());
  const stepsRef = useRef<MatchStep[]>([]);
  /** 観戦で途中から入った時、それまでの操作は演出なしで通す（v2.0-J） */
  const quietRef = useRef(false);

  const [view, setViewState] = useState<GameState | null>(null);
  const viewRef = useRef<GameState | null>(null);
  const [busy, setBusy] = useState(true);
  const [me, setMe] = useState<Side>(setup.me);
  const meRef = useRef<Side>(setup.me);
  const [selected, setSelected] = useState<BoardSel | null>(null);
  const [marked, setMarked] = useState<{ uid: string; move: number } | null>(null);
  const [logLines, setLogLines] = useState<string[]>([]);
  const [logOpen, setLogOpen] = useState(false);
  const [toast, setToast] = useState<{ text: string; n: number } | null>(null);
  const [detailUid, setDetailUid] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  /** CPU が考えている（「かんがえちゅう…」） */
  const [cpuThinking, setCpuThinking] = useState(false);
  const [idleSince, setIdleSince] = useState(0);
  /** 試合（Match）を作り直した回数（フレンド対戦のつなぎ直しに使う） */
  const [matchId, setMatchId] = useState(0);
  /** チュートリアル：先攻決めの演出を始める */
  const startRef = useRef<(() => void) | null>(null);
  /** チュートリアルの台本が進んだら描き直す（できる操作が変わる） */
  const [guideTick, setGuideTick] = useState(0);
  useEffect(() => guide?.driver.subscribe(() => setGuideTick((n) => n + 1)), [guide]);

  const guideRef = useRef(guide);
  guideRef.current = guide;
  const fxRef = useRef(fx);
  fxRef.current = fx;
  useEffect(() => setFxSpeed(fx.speed), [fx.speed]);

  const say = useCallback((text: string) => {
    audio.play('se_error');
    setToast((t) => ({ text, n: (t?.n ?? 0) + 1 }));
  }, []);
  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), 1800);
    return () => window.clearTimeout(id);
  }, [toast]);

  // ---------------------------------------------------------------- 試合と演出の準備
  useEffect(() => {
    const controllers: Record<Side, Controller> = createControllers(setup, () => fxRef.current.speed, {
      // CPU対戦：考えている間は「かんがえちゅう…」、ときどきスタンプ（SPEC §7 S10）
      onThinking: (b) => setCpuThinking(b),
      onStamp: (id) => {
        if (!isStampId(id)) return;
        setOppStamp((s) => ({ id, n: (s?.n ?? 0) + 1 }));
        audio.play('se_stamp_chat');
      },
      // チュートリアル：相手は台本どおりに動く（案内を読んでいる間は待つ）。台本が終われば ふつうの CPU
      think: guide ? tutorialThink(guide.driver, () => matchRef.current?.state ?? null, defaultThink) : undefined,
    });
    const match = new Match(
      {
        seed: setup.seed,
        decks: setup.decks,
        cardDb: CARD_DB,
        fixedDie: setup.fixedDie ?? null,
        stackTop: setup.stackTop,
        sandbox: setup.sandbox,
        forcedDice: setup.forcedDice,
        noShuffle: setup.noShuffle,
        // カードを ためす：準備を飛ばして p1 から始めるので、先攻1ターン目の攻撃禁止は使わない（ほかのルールはそのまま。ボス戦の確かめ用。v2.7）
        rules: setup.sandbox
          ? { p1: { ...setup.rules?.p1, firstPlayerFirstTurnNoAttack: false }, p2: { ...setup.rules?.p2, firstPlayerFirstTurnNoAttack: false } }
          : setup.rules,
      },
      controllers,
    );
    matchRef.current = match;
    setMatchId((n) => n + 1);
    setLogLines([]);
    viewRef.current = match.initial.state;
    setViewState(match.initial.state);

    let slow = 1;
    const particles = canvasRef.current ? new Particles(canvasRef.current, () => fxRef.current.speed * slow) : null;
    const env: FxEnv = {
      // 画面を描き直しても、いつも今の要素を使う
      get overlay() {
        return overlayRef.current!;
      },
      get root() {
        return rootRef.current!;
      },
      me: () => meRef.current,
      speed: () => fxRef.current.speed,
      reduce: () => fxRef.current.reduceFx,
      view: () => viewRef.current!,
      setView: (fn) => {
        const next = fn(viewRef.current!);
        viewRef.current = next;
        flushSync(() => setViewState(next));
      },
      cardEl: (uid) => rootRef.current?.querySelector(`[data-uid="${uid}"]`) ?? null,
      zoneEl: (key) => rootRef.current?.querySelector(`[data-zone="${key}"]`) ?? null,
      markMove: (uid, move) => flushSync(() => setMarked(uid && move !== null ? { uid, move } : null)),
      sound: (key) => audio.play(key),
      particles,
      slowMo: (factor) => {
        slow = factor;
        setFxSpeed(fxRef.current.speed, factor);
      },
      duckBgm: () => audio.duckBgm(),
      nameOf: (side) => setup.names[side],
      turnLabel: (side) =>
        setup.mode === 'local'
          ? { text: t().battle.sideTurn(setup.names[side]), mine: true }
          : side === setup.me
            ? { text: t().battle.myTurn, mine: true }
            : { text: t().battle.oppTurn, mine: false },
      log: (e, before) => {
        const line = logLine(e, before, setup.names, setup.mode === 'local' ? null : setup.mode === 'spectate' ? 'none' : setup.me);
        if (line) setLogLines((l) => [line, ...l].slice(0, 60));
      },
    };
    const queue = new FxQueue(env);
    queueRef.current = queue;
    queue.onBusyChange = (b) => setBusy(b);
    queue.onIdle = () => {
      const v = viewRef.current!;
      const next = perspectiveOf(v, setup);
      meRef.current = next;
      setMe(next);
      setIdleSince(Date.now());
      guide?.driver.idle(v);
      match.notifyIdle();
    };

    const actorGap = (actor: Side | null) => actor !== null && controllers[actor].kind !== 'human';
    stepsRef.current = [match.initial];
    statsRef.current = new StatsCollector();
    statsRef.current.add(match.initial.events, match.initial.state);
    // 最初の手札も「ひいた」に数える（引き直しは数えない。同じ試合を2回数えない：開発時の StrictMode の2回目・観戦の入り直し）
    if (!initialCounted.has(setup)) {
      initialCounted.add(setup);
      addDraws(match.initial.state.players[setup.me].hand.length);
    }
    // チュートリアル：先攻決めのサイコロは、案内で押してもらってから振る（それまでは何も演出しない）
    const startFx = () => queue.enqueue({ actor: null, gap: false, events: match.initial.events, state: match.initial.state });
    if (guide) {
      startRef.current = startFx;
      queue.enqueue({ actor: null, gap: false, events: [], state: match.initial.state });
    } else startFx();
    let before = match.initial.state;
    const unsub = match.subscribe((step) => {
      if (guide && step.action) guide.driver.applied(step.action, before);
      before = step.state;
      stepsRef.current.push(step);
      statsRef.current.add(step.events, step.state);
      addDraws(step.events.filter((e) => e.type === 'Drew' && e.player === setup.me).length);
      const actor = step.action?.player ?? null;
      // 観戦の早送り：演出なしで場面だけ進める
      if (quietRef.current) queue.enqueue({ actor: null, gap: false, events: [], state: step.state });
      else queue.enqueue({ actor, gap: actorGap(actor), events: step.events, state: step.state });
    });
    return () => {
      unsub();
      queue.dispose();
      particles?.dispose();
      setFxSpeed(fxRef.current.speed);
      match.dispose();
      matchRef.current = null;
    };
    // setup は画面に入った時に1回だけ使う
  }, []);

  // ---------------------------------------------------------------- フレンド対戦（SPEC §11）
  const online = useOnlineBattle(setup, matchRef, matchId);
  // ---------------------------------------------------------------- 観戦（v2.0-J。SPEC §11-10）
  const spectating = setup.mode === 'spectate';
  const spectate = useSpectateBattle(setup, matchRef, matchId, quietRef);
  /** 自分の試合を観戦している人の数（フレンド対戦。画面の隅に「かんせんちゅう」） */
  const [watchers, setWatchers] = useState(0);
  useEffect(() => {
    if (setup.mode !== 'online') return;
    const link = currentOnline();
    if (!link) return;
    setWatchers(link.spectators);
    return link.on('spectators', setWatchers);
  }, [setup.mode]);
  /** 観戦をやめて、管理者メニューの大会閲覧へ */
  const leaveSpectate = useCallback(() => {
    endSpectator();
    go('admin', { fn: 'watch' } satisfies AdminPayload);
  }, [go]);
  // 観戦：決着したら勝ち負けを出して、観戦の画面で次の試合を待つ。見ていた試合が終わった時も戻る
  useEffect(() => {
    if (!spectating || !view) return;
    if (view.phase !== 'over' && !spectate.gone) return;
    if (view.phase === 'over' && setup.spectate) finishedGames.add(`${setup.spectate.key}:${setup.game ?? 0}`);
    const id = window.setTimeout(() => go('spectate', { room: setup.spectate?.room ?? '' } satisfies SpectatePayload), view.phase === 'over' ? 4000 : 1500);
    return () => window.clearTimeout(id);
  }, [spectating, view?.phase, spectate.gone]);
  /** 対戦をやめてメニューへ（中断なので勝敗は記録しない） */
  const quitToMenu = useCallback(() => {
    if (setup.mode === 'online') endOnline();
    go('menu');
  }, [go, setup.mode]);

  // ---------------------------------------------------------------- スタンプ（SPEC §8-4）
  const [myStamp, setMyStamp] = useState<{ id: number; n: number } | null>(null);
  const [oppStamp, setOppStamp] = useState<{ id: number; n: number } | null>(null);
  const [stampCooldown, setStampCooldown] = useState(0);
  const sendStamp = useCallback(
    (id: number) => {
      if (Date.now() < stampCooldown || !isStampId(id)) return;
      setStampCooldown(Date.now() + STAMP_COOLDOWN_MS);
      setMyStamp((s) => ({ id, n: (s?.n ?? 0) + 1 }));
      audio.play('se_stamp_chat');
      if (setup.mode === 'online') currentOnline()?.session.sendStamp(id);
    },
    [stampCooldown, setup.mode],
  );
  useEffect(() => {
    if (setup.mode !== 'online') return;
    const link = currentOnline();
    if (!link) return;
    let lastAt = 0;
    return link.on('stamp', (id) => {
      // 届いた番号が正しい時だけ（壊れたデータは無視）。3秒より短い間隔で届いたものも無視する
      if (!isStampId(id) || Date.now() - lastAt < STAMP_COOLDOWN_MS - 300) return;
      lastAt = Date.now();
      setOppStamp((s) => ({ id, n: (s?.n ?? 0) + 1 }));
      audio.play('se_stamp_chat');
    });
  }, [setup.mode]);

  // ---------------------------------------------------------------- 決着 → リザルトへ
  useEffect(() => {
    // 通信のずれ・相手の退室で止めた試合は、決着してもリザルトへ進まない（記録しない）
    // ずれ・ごまかしの時だけ止める（決着の後に相手がリザルトで部屋を出ても、自分もリザルトへ進む）
    if (!view || view.phase !== 'over' || busy || online.problem === 'desync' || online.problem === 'cheat') return;
    // 観戦はリザルトへ進まない（上の観戦の effect）
    if (setup.mode === 'spectate') return;
    if (guide) {
      const id = window.setTimeout(() => guide.onOver(view.winner!), fxRef.current.dur(400));
      return () => window.clearTimeout(id);
    }
    const match = matchRef.current!;
    const result: ResultPayload = {
      setup,
      winner: view.winner!,
      reason: view.endReason!,
      stats: statsRef.current.result(match.state),
      log: [...match.log],
      finalHash: hashState(match.state),
    };
    const id = window.setTimeout(() => go('result', result), fxRef.current.dur(400));
    return () => window.clearTimeout(id);
  }, [view, busy, go, setup, online.problem]);

  // ---------------------------------------------------------------- とちゅうの試合の印（v2.4。SPEC §11-7）
  // 準備が終わって対戦が始まったら「とちゅうの試合」の印を付ける（このままページを閉じたら、次に開いた時に負け）。
  // フレンド対戦の印は、対戦の画面を出る時に消す（勝ち負けはリザルトなどで書く）。レート対戦の印は結果を書く時に消える
  const begun = setup.mode === 'online' && matchBegun(view?.phase);
  const pendingMarked = useRef(false);
  useEffect(() => {
    if (!begun || pendingMarked.current || !setup.record) return;
    pendingMarked.current = true;
    const g = currentOnline()?.lastStart;
    if (setup.rated) updateSave((d) => void beginRateMatch(d, setup.rated!.oppId));
    else updateSave((d) => void startFriendMatch(d, g?.oppUserId ?? ''));
  }, [begun]);
  useEffect(
    () => () => {
      if (pendingMarked.current && !setup.rated) updateSave((d) => void (d.pendingFriendMatch && clearFriendMatch(d)));
      pendingMarked.current = false;
    },
    [],
  );

  // ---------------------------------------------------------------- 相手の通信が切れた・相手が出ていった（v2.0-G・v2.4。SPEC §7 S15・§11-7）
  const cutDone = useRef(false);
  /** 切れたのは自分（オフライン）：「つうしんが きれたよ。この たいせんは まけ」を出す */
  const [selfCut, setSelfCut] = useState(false);
  useEffect(() => {
    if (setup.mode !== 'online' || cutDone.current || !view || view.phase === 'over') return;
    // 「まっています」から30秒もどらない・相手が部屋を出た
    if (online.connection === 'lost' || online.problem === 'left') {
      cutDone.current = true;
      const out = cutOutcome({ begun: matchBegun(view.phase), online: navigator.onLine !== false });
      if (out === 'noGame') {
        // 始まる前（準備中）：勝ち負けを付けず、待機画面へ。レート対戦は無効（「レート対戦中」の印を消し、無効と報告）
        const rated = setup.rated;
        if (rated) {
          updateSave((d) => {
            applyRateResult(d, rated.oppRate, 'void', rated.oppId);
            if (features.ranking && rated.matchId) queueReport(d, { matchId: rated.matchId, winner: 'void' });
          });
          endOnline();
          go('rate');
          return;
        }
        const link = currentOnline();
        if (link && online.problem !== 'left') {
          link.backToRoom();
          go('lobby', { backToRoom: true, oppCut: true } satisfies LobbyPayload);
        } else {
          endOnline();
          go('lobby', { oppCut: true } satisfies LobbyPayload);
        }
        return;
      }
      if (out === 'selfCut') {
        setSelfCut(true);
        return;
      }
      // 残った側の勝ち（リザルトで勝敗・コイン・レートを書く）
      const match = matchRef.current!;
      const result: ResultPayload = {
        setup,
        winner: setup.me,
        reason: 'disconnect',
        stats: statsRef.current.result(match.state),
        log: [...match.log],
        finalHash: hashState(match.state),
      };
      endOnline();
      go('result', result);
      return;
    }
    // データのずれ・種のごまかし：無効試合（レートもコインも変わらない。「レート対戦中」の印は消す）
    if (setup.rated && (online.problem === 'desync' || online.problem === 'cheat')) {
      cutDone.current = true;
      updateSave((d) => void applyRateResult(d, setup.rated!.oppRate, 'void'));
    }
  }, [online.connection, online.problem, view?.phase]);
  /** 切れたのは自分：この試合を負けとして書いて（レートは相手の勝ちを報告）、メニューへ */
  const selfCutToMenu = useCallback(() => {
    updateSave((d) => {
      const p = d.pendingRateMatch;
      if (setup.rated && resolvePendingRate(d) && features.ranking && p?.matchId) {
        markProvisional(d, Date.now(), p.matchId);
        queueReport(d, { matchId: p.matchId, winner: p.opponentId });
      }
      if (!setup.rated) resolvePendingFriend(d);
    });
    endOnline();
    go('menu');
  }, [go, setup.rated]);

  /** 「まっています」の残り秒数（v2.4） */
  const [netLeft, setNetLeft] = useState<number | null>(null);
  useEffect(() => {
    if (setup.mode !== 'online' || online.connection !== 'waiting') {
      setNetLeft(null);
      return;
    }
    const read = () => setNetLeft(currentOnline()?.session.lostInSeconds ?? null);
    read();
    const id = window.setInterval(read, 250);
    return () => window.clearInterval(id);
  }, [setup.mode, online.connection]);

  // 再戦で相手がデッキを変えていたら、対戦の始めに知らせる（v2.0-G）
  useEffect(() => {
    if (setup.mode !== 'online') return;
    const g = currentOnline()?.lastStart;
    if (g && g.game === (setup.game ?? 0) && g.oppDeckChanged) setToast({ text: t().battle.oppDeckChanged, n: 1 });
  }, []);

  // ---------------------------------------------------------------- ブラウザの戻るボタン（SPEC §3）
  useEffect(() => {
    battleMounts++;
    if ((history.state as { oteca?: string } | null)?.oteca !== 'battle') history.pushState({ oteca: 'battle' }, '');
    const onPop = () => {
      history.pushState({ oteca: 'battle' }, '');
      // チュートリアルの案内中は、スキップの確認を出す
      if (guideRef.current && !guideRef.current.driver.free) {
        guideRef.current.onQuit();
        return;
      }
      setConfirm({
        title: t().battle.quitTitle,
        text: t().battle.quitText,
        yes: t().battle.quitYes,
        no: t().battle.continue,
        onYes: () => surrender(),
      });
    };
    window.addEventListener('popstate', onPop);
    return () => {
      window.removeEventListener('popstate', onPop);
      battleMounts--;
      // 画面を出る時は、自分で積んだ履歴を片付ける（戻るボタンが空振りしないように）。
      // 開発時の StrictMode は「片付け → すぐ作り直し」をするので、少し待って本当に出た時だけ戻す
      window.setTimeout(() => {
        if (battleMounts === 0 && (history.state as { oteca?: string } | null)?.oteca === 'battle') history.back();
      }, 0);
    };
  }, []);

  // ---------------------------------------------------------------- 操作
  const controllerKind = matchRef.current?.controllers[me].kind;
  const canAct = !!view && !busy && view.phase !== 'over' && controllerKind === 'human' && !online.problem;
  /** 自分が決める番か（相手の番ならえんぴつ色にする。演出中はちらつかないよう変えない） */
  const myDecision =
    !!view &&
    controllerKind === 'human' &&
    (view.phase === 'main'
      ? view.currentPlayer === me
      : view.phase === 'setup'
        ? view.players[me].setupChoice === null
        : view.phase === 'promote'
          ? view.pendingPromote.includes(me)
          : view.phase === 'choose'
            ? view.pendingChoice?.player === me
            : false);
  const legal = useMemo(
    () => (canAct && view ? getLegalActions(view, me).filter((a) => !guide || guide.driver.allows(a, view)) : []),
    [canAct, view, me, guide, guideTick],
  );

  /** 選んでいるカードの行き先 → 操作 */
  const targets = useMemo(() => {
    const map = new Map<string, Action>();
    if (!selected) return map;
    for (const a of legal) {
      if (sourceOf(a) !== selected.uid) continue;
      const key = targetKeyOf(a, me);
      if (key) map.set(key, a);
    }
    return map;
  }, [selected, legal, me]);

  const submit = useCallback(
    (a: Action) => {
      const match = matchRef.current;
      if (!match) return;
      const r = match.submit(a);
      if (r) say(rejectText(r));
      setSelected(null);
    },
    [say],
  );

  /** 確認が必要なら出してから送る（SPEC §4-7、§8-2） */
  const perform = useCallback(
    (a: Action) => {
      const v = viewRef.current!;
      const ps = v.players[a.player];
      if (a.type === 'SWAP' && !ps.swappedThisTurn) {
        setConfirm({
          title: t().battle.swapTitle,
          text: t().battle.swapText,
          yes: t().battle.swapYes,
          onYes: () => submit(a),
        });
        return;
      }
      if (a.type === 'USE_ITEM') {
        const item = v.cardDefs[v.cards[a.uid].no];
        const buff = item.kind === 'item' && item.effects.some((e) => e.type === 'addAttack' || e.type === 'overrideAttack');
        if (buff && a.targetUid !== undefined && (ps.bench.includes(a.targetUid) || ps.swappedThisTurn)) {
          setConfirm({
            title: t().battle.useTitle,
            text: t().battle.useText,
            yes: t().battle.useYes,
            onYes: () => submit(a),
          });
          return;
        }
      }
      submit(a);
    },
    [submit],
  );

  const surrender = useCallback(() => {
    const match = matchRef.current;
    if (!match || match.state.phase === 'over' || online.problem) {
      quitToMenu();
      return;
    }
    match.submit({ type: 'SURRENDER', player: meRef.current });
  }, [quitToMenu, online.problem]);

  /** 出来ない理由の一言 */
  const reasonFor = (uid: string): string => {
    const v = view!;
    const R = tr.battle.reason;
    if (v.phase === 'over') return R.over;
    if (controllerKind !== 'human' || (v.phase === 'main' && v.currentPlayer !== me)) return R.oppTurn;
    const def = v.cardDefs[v.cards[uid].no];
    const ps = v.players[me];
    if (v.phase === 'setup') return def.kind === 'otege' ? R.cannotChoose : R.setupOtege;
    if (v.phase === 'promote') return R.promoteBench;
    if (ps.hand.includes(uid)) {
      if (def.kind === 'item') {
        // おてあげに使わないアイテム（ひきかえカード・やばいつぼ）：山札・手札が足りない理由
        if (!def.target) {
          const r = validateAction(v, { type: 'USE_ITEM', player: me, uid });
          return r ? rejectText(r) : R.cannotNow;
        }
        // 重ねがけ禁止などで使えない時は、その理由（自分の場の おてあげ を順に見る）
        for (const t of [ps.active, ...ps.bench]) {
          if (!t) continue;
          const r = validateAction(v, { type: 'USE_ITEM', player: me, uid, targetUid: t });
          if (r === 'stackBlocked' || r === 'usedOnce' || r === 'healBlocked') return useItemReason(v, r, uid, t);
        }
        return R.noTarget;
      }
      const r = validateAction(v, { type: 'PLACE_BENCH', player: me, uid });
      return r ? rejectText(r) : R.cannotNow;
    }
    if (ps.bench.includes(uid)) {
      const r = validateAction(v, { type: 'SWAP', player: me, benchUid: uid });
      return r ? rejectText(r) : R.cannotNow;
    }
    return '';
  };

  /**
   * 選んだカード（source）を、そのカード（target）へ使えない・出せない理由（アイテム→おてあげ、ベンチ→バトル場）。
   * 当てはまらなければ null
   */
  const moveReason = (source: string, target: string): string | null => {
    const v = view;
    if (!v || v.phase !== 'main' || v.currentPlayer !== me || source === target) return null;
    const ps = v.players[me];
    const onField = ps.active === target || ps.bench.includes(target);
    if (!onField) return null;
    const def = v.cardDefs[v.cards[source].no];
    if (ps.hand.includes(source) && def.kind === 'item') {
      const r = validateAction(v, { type: 'USE_ITEM', player: me, uid: source, targetUid: target });
      return r ? useItemReason(v, r, source, target) : null;
    }
    if (ps.bench.includes(source) && ps.active === target) {
      const r = validateAction(v, { type: 'SWAP', player: me, benchUid: source });
      return r ? rejectText(r) : null;
    }
    return null;
  };

  const onTapCard = (uid: string) => {
    setIdleSince(Date.now());
    if (!view || busy) return;
    if (selected) {
      const key = view.players[me].active === uid ? `active:${me}` : `card:${uid}`;
      const a = targets.get(`card:${uid}`) ?? targets.get(key);
      if (a) {
        perform(a);
        return;
      }
      if (selected.uid === uid) {
        setSelected(null);
        return;
      }
      // 選んだアイテムを使えない おてあげ（重ねがけ禁止など）を押した：理由を一言（選んだままにする）
      const why = moveReason(selected.uid, uid);
      if (why) {
        say(why);
        return;
      }
    }
    const mine = legal.filter((a) => sourceOf(a) === uid);
    const promote = mine.find((a) => a.type === 'PROMOTE');
    if (promote) {
      submit(promote);
      return;
    }
    if (mine.length > 0) {
      setSelected({ uid });
      return;
    }
    setSelected(null);
    const text = reasonFor(uid);
    if (text) say(text);
  };

  const onTapZone = (key: string) => {
    const a = targets.get(key);
    if (a) perform(a);
    else if (selected) setSelected(null);
  };

  const onDrop = (uid: string, key: string | null) => {
    setIdleSince(Date.now());
    if (!key) return;
    const map = new Map<string, Action>();
    for (const a of legal) {
      if (sourceOf(a) !== uid) continue;
      const k = targetKeyOf(a, me);
      if (k) map.set(k, a);
    }
    // おてあげに使わないアイテムは、自分の場（バトル場・ベンチ・自分のおてあげ）のどこに落としても使う
    const selfUse = map.get(`self:${me}`);
    const ps0 = view?.players[me];
    const onMyField = key === `active:${me}` || key === `bench-empty:${me}` || (key.startsWith('card:') && !!ps0 && (ps0.active === key.slice(5) || ps0.bench.includes(key.slice(5))));
    if (selfUse && onMyField) {
      perform(selfUse);
      return;
    }
    // バトル場のカードの上は「バトル場」と「そのカード」の両方の行き先になる（交代・アイテム）
    const activeUid = view?.players[me].active;
    const a = map.get(key) ?? (key === `active:${me}` && activeUid ? map.get(`card:${activeUid}`) : undefined);
    if (a) perform(a);
    else {
      const target = key.startsWith('card:') ? key.slice(5) : key === `active:${me}` ? activeUid : null;
      say((target && moveReason(uid, target)) || tr.battle.reason.cannotPut);
    }
  };

  const endTurn = () => {
    if (!view) return;
    if (!canAct || view.phase !== 'main' || view.currentPlayer !== me) {
      say(view.phase === 'main' && view.currentPlayer !== me ? tr.battle.reason.oppTurn : tr.battle.reason.cannotNow);
      return;
    }
    // チュートリアルの案内中は、決めた操作だけ
    if (guide && !guide.driver.allows({ type: 'END_TURN', player: me }, view)) return;
    submit({ type: 'END_TURN', player: me });
  };

  if (!view) return <div className="battle" ref={rootRef}><div key="fx-overlay" className="fx-overlay" ref={overlayRef} /><canvas key="fx-particles" className="fx-particles" ref={canvasRef} /></div>;

  const closeDetail = () => {
    setDetailUid(null);
    guide?.driver.detailClosed();
  };
  const bossRule = setup.story ? stageByNo(setup.story.stage)?.bossRule?.text : undefined;
  const detailDef = detailUid ? view.cardDefs[view.cards[detailUid].no] : null;
  // デバッグ：エンジンの正式な状態のハッシュ（S99「状態ハッシュ表示」）
  const officialHash = setup.showHash && matchRef.current ? hashState(matchRef.current.state) : null;
  const saveLog = () => {
    const match = matchRef.current;
    if (!match) return;
    // フレンド対戦では、通信の記録（送った操作・受け取れなかったもの）も入れる（SPEC §11-6）
    const extra = setup.mode === 'online' ? { desyncTurn: online.desyncTurn, rejected: match.rejected, session: currentOnline()?.session.debugLog() ?? null } : undefined;
    downloadActionLog(buildActionLog(setup, match.log, hashState(match.state), extra));
  };
  // 相手の通信が30秒もどらない時は、残った側の勝ち（上の effect）。切れたのが自分の時だけ「つうしんが きれたよ」を出す（v2.4）
  const lostOpen = selfCut && online.connection !== 'ok' && view.phase !== 'over';

  return (
    <div className="battle" ref={rootRef}>
      <BattleBoard
        view={view}
        me={me}
        names={setup.names}
        badges={setup.rated?.badges}
        mode={setup.mode}
        canAct={canAct}
        busy={busy}
        legal={legal}
        selected={selected}
        targets={targets}
        marked={marked}
        logLines={logLines}
        logOpen={logOpen}
        idleSince={idleSince}
        onToggleLog={() => setLogOpen((o) => !o)}
        onOpenMenu={() => setMenuOpen(true)}
        onTapCard={onTapCard}
        onTapZone={onTapZone}
        onLongPress={(uid) => {
          setDetailUid(uid);
          guide?.driver.longPressed(uid);
        }}
        onDrop={onDrop}
        onSelect={(sel) => {
          setIdleSince(Date.now());
          setSelected(sel);
        }}
        myDecision={myDecision}
        onPerform={perform}
        onEndTurn={endTurn}
      />
      <div key="fx-overlay" className="fx-overlay" ref={overlayRef} />
      <canvas key="fx-particles" className="fx-particles" ref={canvasRef} />

      {/* ストーリーのボスルール（画面の上に いつも小さく。SPEC §7 S08） */}
      {bossRule && (
        <div className="battle-bossrule red-pen" data-testid="boss-rule">
          {tr.story.cutinRule(local(bossRule))}
        </div>
      )}
      {guide && (
        <GuideOverlay
          driver={guide.driver}
          view={view}
          busy={busy}
          hidden={!!detailUid || !!confirm || menuOpen || !!guide.hidden}
          rootRef={rootRef}
          onDice={() => {
            if (guide.driver.rollDice()) startRef.current?.();
          }}
        />
      )}

      {/* チュートリアルでは スタンプの場所に「スキップ」を置く */}
      {!guide && !spectating && <StampPicker onSend={sendStamp} cooldownUntil={stampCooldown} />}
      {spectating && (
        <div className="battle-spectate" data-testid="spectate-badge">
          {tr.admin.watch.title(setup.spectate?.room ?? '')}
        </div>
      )}
      {spectating && view.phase === 'over' && view.winner && (
        <div className="battle-spectate-winner" data-testid="spectate-winner">
          {tr.admin.watch.winner(setup.names[view.winner])}
        </div>
      )}
      {setup.mode === 'online' && watchers > 0 && (
        <div className="battle-spectated" data-testid="spectated-badge">
          {tr.admin.badge}
        </div>
      )}
      <StampBalloon stamp={myStamp} side="me" />
      <StampBalloon stamp={oppStamp} side="opp" />
      {/* チュートリアルで案内を読んでいる間は、相手は待っているだけなので出さない */}
      {cpuThinking && setup.mode === 'cpu' && view.phase !== 'over' && !(guide && guide.driver.holdsCpu(view)) && (
        <div className="cpu-thinking pencil" role="status" aria-live="polite">
          {tr.battle.thinking}
          <span className="cpu-thinking__dots" aria-hidden>
            …
          </span>
        </div>
      )}

      {officialHash && (
        <div className="battle-hash" data-testid="state-hash">
          {tr.battle.hash} <span className="num">{officialHash}</span>
          <small>{tr.battle.ops(matchRef.current?.log.length ?? 0)}</small>
        </div>
      )}

      {/* 相手の通信が止まっている（SPEC §11-7） */}
      {setup.mode === 'online' && online.connection === 'waiting' && !online.problem && view.phase !== 'over' && (
        <div className="battle-netwait" role="status" data-testid="net-wait">
          {tr.battle.waitNet}
          {netLeft !== null && <span className="battle-netwait__left num">{tr.battle.waitNetLeft(netLeft)}</span>}
        </div>
      )}

      {lostOpen && (
        <Dialog
          seed="net-lost"
          title={tr.battle.lostTitle}
          actions={
            <RoughButton seed="net-lost-menu" highlight onClick={selfCutToMenu} data-testid="net-lost-menu">
              {tr.common.toMenu}
            </RoughButton>
          }
        >
          {tr.battle.lostText}
        </Dialog>
      )}

      {online.problem && view.phase !== 'over' && (
        <Dialog
          seed={`net-problem-${online.problem}`}
          title={online.problem === 'left' ? tr.battle.leftTitle : tr.battle.desyncTitle}
          actions={
            <>
              {online.problem !== 'left' && (
                <RoughButton seed="net-problem-log" onClick={saveLog}>
                  {tr.battle.saveLog}
                </RoughButton>
              )}
              <RoughButton seed="net-problem-menu" highlight onClick={quitToMenu}>
                {tr.common.toMenu}
              </RoughButton>
            </>
          }
        >
          {online.problem === 'left'
            ? tr.battle.leftText
            : tr.battle.desyncText}
        </Dialog>
      )}

      {/* カードを選ぶ（捨てる・山札から選ぶ・交代先。SPEC §8-2） */}
      {canAct && view.phase === 'choose' && view.pendingChoice?.player === me && (
        <ChoosePanel key={`choose-${matchRef.current?.log.length ?? 0}`} view={view} me={me} onSubmit={submit} onDetail={(uid) => setDetailUid(uid)} />
      )}
      {!busy && view.phase === 'choose' && view.pendingChoice && view.pendingChoice.player !== me && (
        <div className="battle-prompt battle-prompt--wait">{tr.battle.choose.waitOpp}</div>
      )}

      {toast && (
        <div key={toast.n} className="battle-toast" role="status">
          {toast.text}
        </div>
      )}

      {detailDef && (
        <Dialog
          seed="battle-detail"
          width={420}
          onClose={closeDetail}
          actions={
            <RoughButton seed="battle-detail-close" onClick={closeDetail}>
              {tr.common.close}
            </RoughButton>
          }
        >
          <div className="battle-detail">
            <CardDetail def={detailDef} seed={`bdetail-${detailUid}`} />
          </div>
        </Dialog>
      )}

      {menuOpen && (
        <Dialog
          seed="battle-menu"
          title={tr.battle.menuTitle}
          onClose={() => setMenuOpen(false)}
          actions={
            <RoughButton seed="battle-menu-close" onClick={() => setMenuOpen(false)}>
              {tr.battle.continue}
            </RoughButton>
          }
        >
          <div className="battle-menu">
            {spectating ? (
              <RoughButton seed="battle-spectate-leave" stroke="var(--pen-red)" className="battle-menu__surrender" onClick={leaveSpectate} data-testid="spectate-leave-battle">
                <span className="red-pen">{tr.admin.watch.leave}</span>
              </RoughButton>
            ) : (
            <RoughButton
              seed="battle-surrender"
              stroke="var(--pen-red)"
              className="battle-menu__surrender"
              onClick={() => {
                setMenuOpen(false);
                // チュートリアルの案内中は「おてあげする」ではなく、スキップの確認（自由に対戦する #15 では ふつうの降参）
                if (guide && !guide.driver.free) {
                  guide.onQuit();
                  return;
                }
                setConfirm({
                  title: tr.battle.surrenderTitle,
                  text: tr.battle.surrenderText,
                  yes: tr.battle.surrenderYes,
                  onYes: () => surrender(),
                });
              }}
            >
              <span className="red-pen">{tr.battle.surrenderButton}</span>
            </RoughButton>
            )}
            {setup.debug && (
              <RoughButton seed="battle-savelog" className="battle-menu__surrender" onClick={saveLog}>
                {tr.battle.saveLogJson}
              </RoughButton>
            )}
          </div>
        </Dialog>
      )}

      {confirm && (
        <Dialog
          seed={`confirm-${confirm.title}`}
          title={confirm.title}
          onClose={() => setConfirm(null)}
          actions={
            <>
              <RoughButton seed="confirm-no" onClick={() => setConfirm(null)}>
                {confirm.no ?? tr.common.cancel}
              </RoughButton>
              <RoughButton
                seed="confirm-yes"
                highlight
                onClick={() => {
                  const c = confirm;
                  setConfirm(null);
                  c.onYes();
                }}
              >
                {confirm.yes}
              </RoughButton>
            </>
          }
        >
          {confirm.text}
        </Dialog>
      )}
    </div>
  );
}

/** もういっかい（ローカル対戦は同じ設定・新しい種で始め直す） */
export function rematchSetup(setup: BattleSetup): BattleSetup {
  return { ...setup, seed: randomSeed() };
}
