import { gsap } from 'gsap';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { audio } from '../../audio/audioManager';
import { type BattleSetup, randomSeed } from '../../battle/setup';
import { useFx } from '../../fx/fxSettings';
import { setFxSpeed } from '../../fx/timing';
import { local } from '../../i18n';
import { useLang, useT } from '../../i18n/useT';
import { useNav } from '../../router';
import { usableDecks } from '../../save/collection';
import { useSave } from '../../state/SaveContext';
import { cardById } from '../../data/cards';
import { STORY, type StageDef, type StageState, stageByNo, stageDeckNos, stageLevel, stageRules, stageState, storyReward } from '../../story/story';
import { ECONOMY } from '../../economy/rewards';
import { CoinCounter } from '../../ui/coin/Coin';
import { Dialog } from '../../ui/common/Dialog';
import { DeckPickerDialog } from '../../ui/deck/DeckPicker';
import { RoughBox } from '../../ui/rough/RoughBox';
import { RoughButton } from '../../ui/rough/RoughButton';
import { BossArt, BossCutin } from './BossCutin';
import './story.css';

/** リザルトから戻る時に渡すもの：クリアしたステージと、それで新しく開いたステージ（線を描く演出に使う） */
export type StoryPayload = { justCleared?: number; opened?: number[]; retry?: number } | null;

/** 枠の大きさ（舞台の上。雑魚は四角、ボスは大きめ） */
const SIZE = { normal: { w: 120, h: 96 }, boss: { w: 210, h: 176 } } as const;
const MAP_TOP = 40;

/**
 * S08 ストーリー（UPDATE_v2 §7・SPEC §7 S08）：ステージ選択（スキルツリー）→ 確認カード →（ボスはカットイン）→ 対戦。
 * 木は画面より大きいので、上下にドラッグ（スワイプ・ホイール）して動かす。
 */
export function StoryScene() {
  const { go, payload } = useNav();
  const back = payload as StoryPayload;
  const { save, update } = useSave();
  const tr = useT();
  const fx = useFx();
  const viewRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<HTMLDivElement>(null);
  const [picked, setPicked] = useState<StageDef | null>(null);
  const [cutin, setCutin] = useState<{ stage: StageDef; setup: BattleSetup } | null>(null);
  // 新しく開いたステージは、線が描き終わるまで「まだ行けない」の見た目にしておく
  const [hold, setHold] = useState<Set<number>>(() => new Set(back?.opened ?? []));
  const [shakeLock, setShakeLock] = useState<{ no: number; n: number } | null>(null);
  const drag = useRef<{ y: number; top: number; moved: boolean } | null>(null);

  useEffect(() => setFxSpeed(fx.speed), [fx.speed]);

  const stateOf = (no: number): StageState => (hold.has(no) ? 'locked' : stageState(save, no));

  // 開いた時は、いま行けるステージ（戻ってきた時はクリアしたステージ）が見える位置へ
  useLayoutEffect(() => {
    const v = viewRef.current;
    if (!v) return;
    const focus = back?.justCleared ?? [...STORY.stages].reverse().find((s) => stageState(save, s.no) === 'open')?.no ?? 1;
    const st = stageByNo(focus);
    if (st) v.scrollTop = Math.max(0, MAP_TOP + st.y - v.clientHeight / 2 + 60);
  }, []);

  // クリアして戻ってきた：はんこ → 線がペンで描かれる → 次のステージが ぽんっと開く
  useEffect(() => {
    const opened = back?.opened ?? [];
    if (!back?.justCleared || opened.length === 0) return;
    const map = mapRef.current;
    if (!map) return;
    let alive = true;
    const lines = opened.map((n) => map.querySelector<SVGPathElement>(`[data-edge="${back.justCleared}-${n}"]`)).filter((e): e is SVGPathElement => !!e);
    const reduce = fx.reduceFx;
    const tl = gsap.timeline({ delay: fx.reduceFx ? 0.1 : 0.7 });
    for (const l of lines) {
      const len = l.getTotalLength();
      gsap.set(l, { strokeDasharray: len, strokeDashoffset: len, opacity: 1 });
    }
    tl.call(() => alive && audio.play('se_pen'));
    tl.to(lines, { strokeDashoffset: 0, duration: reduce ? 0.2 : 1.1, ease: 'power1.inOut' });
    tl.call(() => {
      if (!alive) return;
      setHold(new Set());
      audio.play('se_stage_open');
      for (const n of opened) {
        const el = map.querySelector<HTMLElement>(`[data-stage="${n}"]`);
        if (el && !reduce) gsap.fromTo(el, { scale: 0.4, rotate: -12 }, { scale: 1, rotate: 0, duration: 0.6, ease: 'back.out(3)' });
      }
    });
    return () => {
      alive = false;
      tl.kill();
    };
  }, []);

  // ボスに負けて「もういちど ちょうせん」：カットインから始める
  useEffect(() => {
    const st = back?.retry ? stageByNo(back.retry) : undefined;
    if (st && stateOf(st.no) !== 'locked') start(st);
  }, []);

  const pick = (st: StageDef) => {
    if (drag.current?.moved) return;
    if (stateOf(st.no) === 'locked') {
      audio.play('se_error');
      setShakeLock((s) => ({ no: st.no, n: (s?.n ?? 0) + 1 }));
      return;
    }
    audio.play('se_page');
    setPicked(st);
  };

  function start(st: StageDef) {
    const deck = save.decks[save.selectedDeck];
    const setup: BattleSetup = {
      mode: 'cpu',
      cpuLevel: stageLevel(st),
      decks: { p1: deck.cards, p2: stageDeckNos(st) },
      names: { p1: save.playerName, p2: st.name },
      seed: randomSeed(),
      me: 'p1',
      // CPU対戦の勝敗には数えない（報酬はリザルトでストーリーの分を）
      record: false,
      rules: stageRules(st),
      story: { stage: st.no },
    };
    setPicked(null);
    if (st.kind === 'boss') setCutin({ stage: st, setup });
    else go('battle', setup);
  }

  const H = STORY.map.height;
  return (
    <div className="story-scene" data-testid="story-scene">
      <h1 className="story-scene__title">{tr.story.title}</h1>
      <CoinCounter value={save.coins} className="story-scene__coins" />
      <RoughButton seed="story-back" className="story-scene__back" onClick={() => go('menu')}>
        {tr.common.back}
      </RoughButton>
      <p className="story-scene__hint pencil">{tr.story.dragHint}</p>

      <div
        className="story-map"
        ref={viewRef}
        data-testid="story-map"
        onPointerDown={(e) => {
          if (e.pointerType !== 'mouse') return; // 指は ふつうのスクロール
          drag.current = { y: e.clientY, top: viewRef.current!.scrollTop, moved: false };
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          const v = viewRef.current;
          if (!d || !v) return;
          const s = v.getBoundingClientRect().height / v.clientHeight;
          const dy = (e.clientY - d.y) / s;
          if (Math.abs(dy) > 6) d.moved = true;
          v.scrollTop = d.top - dy;
        }}
        onPointerUp={() => {
          // 押した直後の click で、動かしたかどうかを見てから消す
          window.setTimeout(() => (drag.current = null), 0);
        }}
        onPointerLeave={() => (drag.current = null)}
      >
        <div className="story-map__paper" ref={mapRef} style={{ height: H + MAP_TOP * 2 }}>
          <svg className="story-map__lines" viewBox={`0 0 1280 ${H + MAP_TOP * 2}`} aria-hidden>
            {STORY.stages.flatMap((st) =>
              st.after.map((a) => {
                const from = stageByNo(a)!;
                const fs = SIZE[from.kind];
                const ts = SIZE[st.kind];
                const x1 = from.x;
                const y1 = MAP_TOP + from.y + fs.h / 2 + 30;
                const x2 = st.x;
                const y2 = MAP_TOP + st.y - ts.h / 2 - 6;
                const my = (y1 + y2) / 2;
                const open = stateOf(st.no) !== 'locked';
                return (
                  <path
                    key={`${a}-${st.no}`}
                    data-edge={`${a}-${st.no}`}
                    className={`story-line ${open ? 'is-open' : ''} ${hold.has(st.no) ? 'is-drawing' : ''}`}
                    d={`M${x1} ${y1} C${x1 + (x2 - x1) * 0.1} ${my + 10} ${x2 - (x2 - x1) * 0.1} ${my - 10} ${x2} ${y2}`}
                  />
                );
              }),
            )}
          </svg>
          {STORY.stages.map((st) => (
            <StageNode
              key={st.no}
              stage={st}
              state={stateOf(st.no)}
              fresh={back?.justCleared === st.no}
              shake={shakeLock?.no === st.no ? shakeLock.n : 0}
              onPick={() => pick(st)}
            />
          ))}
        </div>
      </div>

      {picked && (
        <StageConfirm
          stage={picked}
          onClose={() => setPicked(null)}
          onStart={() => start(picked)}
          onPickDeck={(i) => update((d) => void (d.selectedDeck = i))}
        />
      )}

      {cutin && <BossCutin stage={cutin.stage} onDone={() => go('battle', cutin.setup)} />}
    </div>
  );
}

/** 木の中の1つのステージ（雑魚＝緑の四角、ボス＝赤い大きな枠） */
function StageNode({ stage, state, fresh, shake, onPick }: { stage: StageDef; state: StageState; fresh: boolean; shake: number; onPick: () => void }) {
  const tr = useT();
  const ref = useRef<HTMLButtonElement>(null);
  const size = SIZE[stage.kind];
  const boss = stage.kind === 'boss';
  const locked = state === 'locked';
  useEffect(() => {
    if (shake && ref.current) gsap.fromTo(ref.current.querySelector('.story-lock'), { rotate: -18 }, { rotate: 0, duration: 0.5, ease: 'elastic.out(1.2, 0.3)' });
  }, [shake]);
  return (
    <button
      ref={ref}
      type="button"
      className={`story-node story-node--${stage.kind} is-${state} ${fresh ? 'is-fresh' : ''}`}
      style={{ left: stage.x - size.w / 2, top: MAP_TOP + stage.y - size.h / 2, width: size.w }}
      data-stage={stage.no}
      data-testid={`story-stage-${stage.no}`}
      aria-label={tr.story.stageAria(stage.no, stage.name, state)}
      onClick={onPick}
    >
      <RoughBox
        seed={`stage-${stage.no}`}
        className="story-node__frame"
        style={{ height: size.h }}
        stroke={locked ? 'var(--pencil)' : boss ? 'var(--pen-red)' : 'var(--pen-green)'}
        strokeWidth={locked ? 2 : boss ? 4 : 3}
        dashed={locked}
        double={boss && !locked}
        boil={state === 'open'}
        paper
        radius={boss ? 14 : 8}
      >
        {boss && stage.boss && <BossArt boss={stage.boss} name={stage.name} small dim={locked} />}
        {locked && <LockDoodle />}
        {state === 'cleared' && (
          <>
            <span className={`story-stamp ${fresh ? 'is-new' : ''}`}>{tr.story.cleared}</span>
            <CheckDoodle />
          </>
        )}
      </RoughBox>
      <span className={`story-node__no num ${locked ? 'pencil' : ''}`}>{stage.no}</span>
      <span className={`story-node__name ${locked ? 'pencil' : ''}`}>{stage.name}</span>
    </button>
  );
}

function LockDoodle() {
  return (
    <svg className="story-lock" viewBox="0 0 40 46" aria-hidden>
      <path d="M11 20 V13 Q11 4 20 4 Q29 4 29 13 V20" />
      <rect x="6" y="20" width="28" height="22" rx="4" />
      <circle cx="20" cy="30" r="3" />
      <path d="M20 33 V37" />
    </svg>
  );
}

function CheckDoodle() {
  return (
    <svg className="story-check" viewBox="0 0 50 40" aria-hidden>
      <path d="M4 22 Q12 28 18 36 Q28 14 46 4" />
    </svg>
  );
}

/** 確認カード：敵の名前・テーマ・強さ・ボスルール・報酬、自分のデッキ（デッキを かえる）→ ちょうせん！ */
function StageConfirm({ stage, onClose, onStart, onPickDeck }: { stage: StageDef; onClose: () => void; onStart: () => void; onPickDeck: (i: number) => void }) {
  const tr = useT();
  const lang = useLang();
  const { save } = useSave();
  const [picking, setPicking] = useState(false);
  const reward = storyReward(save, stage, ECONOMY.coinsMax);
  const table = STORY.rewards[stage.kind];
  const cardName = stage.card ? (cardById(stage.card)?.name ?? '') : '';
  const deckOk = usableDecks(save)[save.selectedDeck];
  const deck = save.decks[save.selectedDeck];
  return (
    <>
      <Dialog
        seed={`stage-confirm-${stage.no}`}
        title={`${tr.story.stageNo(stage.no)}  ${stage.name}`}
        width={820}
        onClose={onClose}
        actions={
          <>
            <RoughButton seed="stage-cancel" onClick={onClose}>
              {tr.common.back}
            </RoughButton>
            <RoughButton seed="stage-deck" onClick={() => setPicking(true)} data-testid="stage-change-deck">
              {tr.story.changeDeck}
            </RoughButton>
            <RoughButton seed="stage-go" highlight={deckOk} disabled={!deckOk} strokeWidth={3} onClick={onStart} data-testid="stage-go">
              {tr.story.go}
            </RoughButton>
          </>
        }
      >
        <div className={`stage-confirm stage-confirm--${stage.kind}`} data-testid="stage-confirm">
          <div className="stage-confirm__art">
            {stage.kind === 'boss' && stage.boss ? (
              <BossArt boss={stage.boss} name={stage.name} />
            ) : (
              <RoughBox seed={`confirm-${stage.no}`} className="stage-confirm__frame" stroke="var(--pen-green)" strokeWidth={3} paper radius={8} />
            )}
          </div>
          <dl className="stage-confirm__list">
            <dt>{tr.story.theme}</dt>
            <dd>{local(stage.theme, lang)}</dd>
            <dt>{tr.story.strength}</dt>
            <dd className={stage.kind === 'boss' ? 'red-pen' : ''}>{tr.story.level[stageLevel(stage) === 'strong' ? 'strong' : 'normal']}</dd>
            {stage.bossRule && (
              <>
                <dt>{tr.story.rule}</dt>
                <dd className="red-pen stage-confirm__rule">{local(stage.bossRule.text, lang)}</dd>
              </>
            )}
            <dt>{tr.story.reward}</dt>
            <dd>
              {reward.first ? tr.story.rewardFirst(table.first) : tr.story.rewardAgain(table.again)}
              {reward.first && cardName && <span className="stage-confirm__card blue-pen">{tr.story.rewardCard(cardName)}</span>}
            </dd>
          </dl>
          <p className={`stage-confirm__deck ${deckOk ? '' : 'red-pen'}`}>{deckOk ? tr.story.myDeck(deck.name) : tr.story.badDeck}</p>
        </div>
      </Dialog>
      {picking && (
        <DeckPickerDialog
          save={save}
          current={save.selectedDeck}
          mode="battle"
          title={tr.story.changeDeck}
          onPick={(i) => {
            onPickDeck(i);
            setPicking(false);
          }}
          onClose={() => setPicking(false)}
        />
      )}
    </>
  );
}

