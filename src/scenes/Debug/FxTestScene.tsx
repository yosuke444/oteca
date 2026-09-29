import { useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import type { GameState } from '../../engine/types';
import type { FxEnv } from '../../fx/env';
import { FxQueue } from '../../fx/fxQueue';
import { Particles } from '../../fx/particles';
import { setFxSpeed } from '../../fx/timing';
import { type FxSpeedIndex, useFx } from '../../fx/fxSettings';
import { useNav } from '../../router';
import { useSave } from '../../state/SaveContext';
import { BattleBoard } from '../Battle/BattleBoard';
import '../Battle/battle.css';
import { FX_SCENES, foldEvents, fxFixture } from './fxScenes';
import './debug.css';

const NAMES = { p1: 'じぶん', p2: 'あいて' } as const;
const SPEEDS: { v: FxSpeedIndex; label: string }[] = [
  { v: 0, label: 'ふつう' },
  { v: 1, label: 'はやい' },
  { v: 2, label: 'さいそく' },
];

/**
 * デバッグ画面の「演出テスト」（SPEC §9）
 * 見本の盤面の上で、§9-2 の対戦中の演出を1つずつ再生する。演出スピード・演出をへらす もここで切り替えられる。
 */
export function FxTestScene() {
  const { go } = useNav();
  const { update } = useSave();
  const fx = useFx();
  const fxRef = useRef(fx);
  fxRef.current = fx;
  const rootRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [view, setView] = useState<GameState>(() => fxFixture());
  const viewRef = useRef(view);
  const [marked, setMarked] = useState<{ uid: string; move: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [lastMs, setLastMs] = useState<Record<string, number>>({});
  const queueRef = useRef<FxQueue | null>(null);
  const startRef = useRef<{ id: string; t: number } | null>(null);

  useEffect(() => setFxSpeed(fx.speed), [fx.speed]);

  useEffect(() => {
    let slow = 1;
    const particles = canvasRef.current ? new Particles(canvasRef.current, () => fxRef.current.speed * slow) : null;
    const env: FxEnv = {
      get overlay() {
        return overlayRef.current!;
      },
      get root() {
        return rootRef.current!;
      },
      me: () => 'p1',
      speed: () => fxRef.current.speed,
      reduce: () => fxRef.current.reduceFx,
      view: () => viewRef.current,
      setView: (fn) => {
        const next = fn(viewRef.current);
        viewRef.current = next;
        flushSync(() => setView(next));
      },
      cardEl: (uid) => rootRef.current?.querySelector(`[data-uid="${uid}"]`) ?? null,
      zoneEl: (key) => rootRef.current?.querySelector(`[data-zone="${key}"]`) ?? null,
      markMove: (uid, move) => flushSync(() => setMarked(uid && move !== null ? { uid, move } : null)),
      sound: () => {},
      particles,
      slowMo: (f) => {
        slow = f;
        setFxSpeed(fxRef.current.speed, f);
      },
      duckBgm: () => {},
      nameOf: (side) => NAMES[side],
      turnLabel: (side) => (side === 'p1' ? { text: 'あなたの ターン', mine: true } : { text: 'あいての ターン', mine: false }),
      log: () => {},
    };
    const q = new FxQueue(env);
    q.onBusyChange = setBusy;
    q.onIdle = () => {
      const st = startRef.current;
      if (st) setLastMs((m) => ({ ...m, [st.id]: Math.round(performance.now() - st.t) }));
      startRef.current = null;
    };
    queueRef.current = q;
    return () => {
      q.dispose();
      particles?.dispose();
      setFxSpeed(fxRef.current.speed);
    };
  }, []);

  const playScene = (id: string) => {
    const scene = FX_SCENES.find((s) => s.id === id);
    const q = queueRef.current;
    if (!scene || !q || busy) return;
    const base = fxFixture();
    const pre = scene.pre ? scene.pre(base) : base;
    viewRef.current = pre;
    flushSync(() => {
      setView(pre);
      setMarked(null);
    });
    const events = scene.events(pre);
    startRef.current = { id, t: performance.now() };
    q.enqueue({ actor: null, gap: false, events, state: foldEvents(pre, events) });
  };

  const setSpeed = (v: FxSpeedIndex) => update((d) => void (d.settings.fxSpeed = v));
  const setReduce = (v: boolean) => update((d) => void (d.settings.reduceFx = v));
  const noop = () => {};

  return (
    <div className="battle fxtest" ref={rootRef}>
      <BattleBoard
        view={view}
        me="p1"
        names={NAMES}
        mode="local"
        canAct={false}
        myDecision={false}
        busy={busy}
        legal={[]}
        selected={null}
        targets={new Map()}
        marked={marked}
        logLines={[]}
        logOpen={false}
        hints={false}
        idleSince={Number.MAX_SAFE_INTEGER}
        onToggleLog={noop}
        onOpenMenu={noop}
        onTapCard={noop}
        onTapZone={noop}
        onLongPress={noop}
        onDrop={noop}
        onSelect={noop}
        onPerform={noop}
        onEndTurn={noop}
      />
      <div key="fx-overlay" className="fx-overlay" ref={overlayRef} />
      <canvas key="fx-particles" className="fx-particles" ref={canvasRef} />

      <div className="fxtest-panel" data-testid="fx-panel">
        <div className="fxtest-panel__head">
          <b>えんしゅつ テスト</b>
          <button type="button" className="fxtest-btn fxtest-btn--back" onClick={() => go('debug')}>
            もどる
          </button>
        </div>
        <div className="fxtest-row">
          {SPEEDS.map((s) => (
            <button key={s.v} type="button" className={`fxtest-btn ${fx.fxSpeed === s.v ? 'is-on' : ''}`} onClick={() => setSpeed(s.v)}>
              {s.label}
            </button>
          ))}
          <button type="button" className={`fxtest-btn ${fx.reduceFx ? 'is-on' : ''}`} onClick={() => setReduce(!fx.reduceFx)}>
            へらす{fx.reduceFx ? 'ON' : 'OFF'}
          </button>
        </div>
        <div className="fxtest-list">
          {FX_SCENES.map((s) => (
            <button key={s.id} type="button" className="fxtest-btn" data-scene={s.id} disabled={busy} onClick={() => playScene(s.id)}>
              {s.label}
              {lastMs[s.id] !== undefined && <small className="num"> {(lastMs[s.id] / 1000).toFixed(1)}s</small>}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
