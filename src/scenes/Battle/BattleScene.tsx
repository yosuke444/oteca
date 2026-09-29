import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { buildActionLog, downloadActionLog } from '../../battle/actionLog';
import { type BattleSetup, randomSeed } from '../../battle/setup';
import { StatsCollector } from '../../battle/stats';
import { Match, type MatchStep } from '../../controllers/match';
import type { Controller } from '../../controllers/types';
import { CARD_DB } from '../../data/cards';
import { getLegalActions, hashState, validateAction } from '../../engine';
import type { Action, GameState, Side } from '../../engine/types';
import { type FxEnv } from '../../fx/env';
import { FxQueue } from '../../fx/fxQueue';
import { setFxSpeed } from '../../fx/timing';
import { useFx } from '../../fx/fxSettings';
import { useNav } from '../../router';
import { useSave } from '../../state/SaveContext';
import { CardDetail } from '../../ui/card/CardDetail';
import { Dialog } from '../../ui/common/Dialog';
import { RoughButton } from '../../ui/rough/RoughButton';
import { BattleBoard, type BoardSel } from './BattleBoard';
import { logLine, rejectText } from './battleText';
import { createControllers } from './controllersFor';
import type { ResultPayload } from '../Result/ResultScene';
import './battle.css';

type Confirm = { title: string; text: string; yes: string; no?: string; onYes: () => void };

/** 対戦画面がいくつ出ているか（戻るボタン用の履歴の片付けに使う） */
let battleMounts = 0;

/** どちら側を画面の下にするか（ひとりで両方あやつる時は、操作する人の側） */
function perspectiveOf(view: GameState, setup: BattleSetup): Side {
  if (setup.mode !== 'local') return setup.me;
  if (view.phase === 'setup') return view.players.p1.setupChoice === null ? 'p1' : 'p2';
  if (view.phase === 'promote') return view.pendingPromote[0] ?? view.currentPlayer;
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
      return `card:${a.targetUid}`;
    default:
      return null;
  }
}

/** S04 対戦（SPEC §8） */
export function BattleScene() {
  const { payload, go } = useNav();
  const setup = payload as BattleSetup;
  const { save } = useSave();
  const fx = useFx();

  const rootRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const matchRef = useRef<Match | null>(null);
  const queueRef = useRef<FxQueue | null>(null);
  const statsRef = useRef(new StatsCollector());
  const stepsRef = useRef<MatchStep[]>([]);

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
  const [idleSince, setIdleSince] = useState(0);

  const fxRef = useRef(fx);
  fxRef.current = fx;
  useEffect(() => setFxSpeed(fx.speed), [fx.speed]);

  const say = useCallback((text: string) => setToast((t) => ({ text, n: (t?.n ?? 0) + 1 })), []);
  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), 1800);
    return () => window.clearTimeout(id);
  }, [toast]);

  // ---------------------------------------------------------------- 試合と演出の準備
  useEffect(() => {
    const controllers: Record<Side, Controller> = createControllers(setup, () => fxRef.current.speed);
    const match = new Match(
      {
        seed: setup.seed,
        decks: setup.decks,
        cardDb: CARD_DB,
        fixedDie: setup.fixedDie ?? null,
        stackTop: setup.stackTop,
      },
      controllers,
    );
    matchRef.current = match;
    setLogLines([]);
    viewRef.current = match.initial.state;
    setViewState(match.initial.state);

    const env: FxEnv = {
      overlay: overlayRef.current!,
      root: rootRef.current!,
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
      sound: () => {},
      log: (e, before) => {
        const line = logLine(e, before, setup.names);
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
      match.notifyIdle();
    };

    const actorGap = (actor: Side | null) => actor !== null && controllers[actor].kind !== 'human';
    stepsRef.current = [match.initial];
    statsRef.current = new StatsCollector();
    statsRef.current.add(match.initial.events, match.initial.state);
    queue.enqueue({ actor: null, gap: false, events: match.initial.events, state: match.initial.state });
    const unsub = match.subscribe((step) => {
      stepsRef.current.push(step);
      statsRef.current.add(step.events, step.state);
      const actor = step.action?.player ?? null;
      queue.enqueue({ actor, gap: actorGap(actor), events: step.events, state: step.state });
    });
    return () => {
      unsub();
      queue.dispose();
      match.dispose();
      matchRef.current = null;
    };
    // setup は画面に入った時に1回だけ使う
  }, []);

  // ---------------------------------------------------------------- 決着 → リザルトへ
  useEffect(() => {
    if (!view || view.phase !== 'over' || busy) return;
    const match = matchRef.current!;
    const result: ResultPayload = {
      setup,
      winner: view.winner!,
      reason: view.endReason!,
      stats: statsRef.current.result(match.state),
      log: [...match.log],
      finalHash: hashState(match.state),
    };
    const id = window.setTimeout(() => go('result', result), 400);
    return () => window.clearTimeout(id);
  }, [view, busy, go, setup]);

  // ---------------------------------------------------------------- ブラウザの戻るボタン（SPEC §3）
  useEffect(() => {
    battleMounts++;
    if ((history.state as { oteca?: string } | null)?.oteca !== 'battle') history.pushState({ oteca: 'battle' }, '');
    const onPop = () => {
      history.pushState({ oteca: 'battle' }, '');
      setConfirm({
        title: 'たいせんを やめる？',
        text: 'やめると おてあげ（こうさん）に なるよ。',
        yes: 'たいせんを やめる',
        no: 'つづける',
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
  const canAct = !!view && !busy && view.phase !== 'over' && controllerKind === 'human';
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
          : false);
  const legal = useMemo(() => (canAct && view ? getLegalActions(view, me) : []), [canAct, view, me]);

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
          title: 'こうたい する？',
          text: 'このターンは こうげき できなくなるよ。',
          yes: 'こうたい する',
          onYes: () => submit(a),
        });
        return;
      }
      if (a.type === 'USE_ITEM') {
        const item = v.cardDefs[v.cards[a.uid].no];
        const buff = item.kind === 'item' && item.effects.some((e) => e.type === 'addAttack' || e.type === 'overrideAttack');
        if (buff && (ps.bench.includes(a.targetUid) || ps.swappedThisTurn)) {
          setConfirm({
            title: 'つかう？',
            text: 'この おてあげは このターン こうげきしないよ。',
            yes: 'つかう',
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
    if (!match || match.state.phase === 'over') {
      go('menu');
      return;
    }
    match.submit({ type: 'SURRENDER', player: meRef.current });
  }, [go]);

  /** 出来ない理由の一言 */
  const reasonFor = (uid: string): string => {
    const v = view!;
    if (v.phase === 'over') return 'もう けっちゃく したよ';
    if (controllerKind !== 'human' || (v.phase === 'main' && v.currentPlayer !== me)) return 'いまは あいての ターンだよ';
    const def = v.cardDefs[v.cards[uid].no];
    const ps = v.players[me];
    if (v.phase === 'setup') return def.kind === 'otege' ? 'えらべないよ' : 'バトルばには おてあげを だしてね';
    if (v.phase === 'promote') return 'ベンチの おてあげを えらんでね';
    if (ps.hand.includes(uid)) {
      if (def.kind === 'item') return 'つかえる おてあげが いないよ';
      const r = validateAction(v, { type: 'PLACE_BENCH', player: me, uid });
      return r ? rejectText(r) : 'いまは できないよ';
    }
    if (ps.bench.includes(uid)) {
      const r = validateAction(v, { type: 'SWAP', player: me, benchUid: uid });
      return r ? rejectText(r) : 'いまは できないよ';
    }
    return '';
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
    // バトル場のカードの上は「バトル場」と「そのカード」の両方の行き先になる（交代・アイテム）
    const activeUid = view?.players[me].active;
    const a = map.get(key) ?? (key === `active:${me}` && activeUid ? map.get(`card:${activeUid}`) : undefined);
    if (a) perform(a);
    else say('そこには おけないよ');
  };

  const endTurn = () => {
    if (!view) return;
    if (!canAct || view.phase !== 'main' || view.currentPlayer !== me) {
      say(view.phase === 'main' && view.currentPlayer !== me ? 'いまは あいての ターンだよ' : 'いまは できないよ');
      return;
    }
    submit({ type: 'END_TURN', player: me });
  };

  if (!view) return <div className="battle" ref={rootRef}><div className="fx-overlay" ref={overlayRef} /></div>;

  const detailDef = detailUid ? view.cardDefs[view.cards[detailUid].no] : null;
  // デバッグ：エンジンの正式な状態のハッシュ（S99「状態ハッシュ表示」）
  const officialHash = setup.showHash && matchRef.current ? hashState(matchRef.current.state) : null;
  const saveLog = () => {
    const match = matchRef.current;
    if (match) downloadActionLog(buildActionLog(setup, match.log, hashState(match.state)));
  };

  return (
    <div className="battle" ref={rootRef}>
      <BattleBoard
        view={view}
        me={me}
        names={setup.names}
        mode={setup.mode}
        canAct={canAct}
        busy={busy}
        legal={legal}
        selected={selected}
        targets={targets}
        marked={marked}
        logLines={logLines}
        logOpen={logOpen}
        hints={save.settings.hints}
        idleSince={idleSince}
        onToggleLog={() => setLogOpen((o) => !o)}
        onOpenMenu={() => setMenuOpen(true)}
        onTapCard={onTapCard}
        onTapZone={onTapZone}
        onLongPress={(uid) => setDetailUid(uid)}
        onDrop={onDrop}
        onSelect={(sel) => {
          setIdleSince(Date.now());
          setSelected(sel);
        }}
        myDecision={myDecision}
        onPerform={perform}
        onEndTurn={endTurn}
      />
      <div className="fx-overlay" ref={overlayRef} />

      {officialHash && (
        <div className="battle-hash" data-testid="state-hash">
          ハッシュ <span className="num">{officialHash}</span>
          <small>（そうさ {matchRef.current?.log.length ?? 0}）</small>
        </div>
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
          onClose={() => setDetailUid(null)}
          actions={
            <RoughButton seed="battle-detail-close" onClick={() => setDetailUid(null)}>
              とじる
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
          title="メニュー"
          onClose={() => setMenuOpen(false)}
          actions={
            <RoughButton seed="battle-menu-close" onClick={() => setMenuOpen(false)}>
              つづける
            </RoughButton>
          }
        >
          <div className="battle-menu">
            <RoughButton
              seed="battle-surrender"
              stroke="var(--pen-red)"
              className="battle-menu__surrender"
              onClick={() => {
                setMenuOpen(false);
                setConfirm({
                  title: 'おてあげする？',
                  text: 'こうさん すると、すぐに まけに なるよ。',
                  yes: 'おてあげする',
                  onYes: () => surrender(),
                });
              }}
            >
              <span className="red-pen">おてあげする（こうさん）</span>
            </RoughButton>
            {setup.debug && (
              <RoughButton seed="battle-savelog" className="battle-menu__surrender" onClick={saveLog}>
                こうどうログを ほぞん（JSON）
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
                {confirm.no ?? 'やめる'}
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
