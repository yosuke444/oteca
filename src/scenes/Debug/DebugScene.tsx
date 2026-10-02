import { useState } from 'react';
import { type BattleMode, type BattleSetup, randomSeed } from '../../battle/setup';
import { CARD_DB } from '../../data/cards';
import { usableDecks } from '../../save/collection';
import { DeckChooser } from '../../ui/deck/DeckPicker';
import type { Side } from '../../engine/types';
import { useNav } from '../../router';
import { useSave } from '../../state/SaveContext';
import { RoughBox } from '../../ui/rough/RoughBox';
import { RoughButton } from '../../ui/rough/RoughButton';
import './debug.css';
import { useT } from '../../i18n/useT';
import { ECONOMY, addCoins, debugNextDay } from '../../economy/rewards';
import { Dialog } from '../../ui/common/Dialog';

/** 山札の上に積めるのは何枚まで（画面に並べる都合） */
const STACK_MAX = 6;

/** S99 デバッグ対戦（SPEC §7。?debug=1 の時だけメニューに出る） */
export function DebugScene() {
  const { go } = useNav();
  const { save, update, reset } = useSave();
  const [wipeOpen, setWipeOpen] = useState(false);
  const [toolMsg, setToolMsg] = useState(0);
  const tool = (fn: () => void) => {
    fn();
    setToolMsg((n) => n + 1);
  };
  const tr = useT();
  const D = tr.debug;
  const usable = usableDecks(save)
    .map((ok, i) => ({ ok, i }))
    .filter((u) => u.ok);
  const first = usable.some((u) => u.i === save.selectedDeck) ? save.selectedDeck : (usable[0]?.i ?? 0);
  const [deck1, setDeck1] = useState(first);
  const [deck2, setDeck2] = useState(first);
  const [die, setDie] = useState<number | null>(null);
  const [stackSide, setStackSide] = useState<Side>('p1');
  const [stack, setStack] = useState<Record<Side, number[]>>({ p1: [], p2: [] });
  const [showHash, setShowHash] = useState(true);

  const deckOf = (side: Side) => save.decks[side === 'p1' ? deck1 : deck2].cards;
  // 山札の上は、そのデッキに入っている枚数までしか積めない
  const stackable = (side: Side) => {
    const deck = deckOf(side);
    return [...new Set(deck)].sort((a, b) => a - b).filter((no) => stack[side].filter((n) => n === no).length < deck.filter((n) => n === no).length);
  };

  const start = (mode: BattleMode) => {
    const cpu = mode === 'cpu';
    const setup: BattleSetup = {
      mode,
      decks: { p1: deckOf('p1'), p2: deckOf('p2') },
      names: cpu ? { p1: save.playerName, p2: D.cpuName } : { p1: D.localP1(save.playerName), p2: D.localP2 },
      seed: randomSeed(),
      me: 'p1',
      record: false,
      fixedDie: die,
      stackTop: { p1: stack.p1, p2: stack.p2 },
      debug: true,
      showHash,
    };
    go('battle', setup);
  };

  const choice = stackable(stackSide);

  return (
    <div className="debug-scene">
      <h1 className="debug-scene__title">{D.title}</h1>
      <RoughButton seed="debug-back" className="debug-scene__back" onClick={() => go('menu')}>
        {tr.common.back}
      </RoughButton>
      <RoughButton seed="debug-fxtest" className="debug-scene__tool" onClick={() => go('fxtest')}>
        {D.fxtest}
      </RoughButton>
      <RoughButton seed="debug-soundtest" className="debug-scene__tool debug-scene__tool--2" onClick={() => go('soundtest')}>
        {D.soundtest}
      </RoughButton>
      <RoughButton seed="debug-cardlab" className="debug-scene__tool debug-scene__tool--3" onClick={() => go('cardlab')}>
        {D.cardlab}
      </RoughButton>
      <RoughBox seed="debug-panel" className="debug-panel" paper radius={8}>
        <DeckPick label={D.p1Deck} seed="debug-p1" value={deck1} onChange={(i) => { setDeck1(i); setStack((st) => ({ ...st, p1: [] })); }} />
        <DeckPick label={D.p2Deck} seed="debug-p2" value={deck2} onChange={(i) => { setDeck2(i); setStack((st) => ({ ...st, p2: [] })); }} />

        <div className="debug-row">
          <span className="debug-row__label">{D.fixDie}</span>
          <div className="debug-row__choices">
            {[null, 1, 2, 3, 4, 5, 6].map((v) => (
              <RoughButton key={String(v)} seed={`die-${v}`} className="debug-row__choice debug-row__choice--die" highlight={die === v} onClick={() => setDie(v)}>
                {v === null ? D.fixDieNone : <span className="num">{v}</span>}
              </RoughButton>
            ))}
          </div>
          <span className="debug-row__note pencil">{D.fixDieNote}</span>
        </div>

        <div className="debug-row">
          <span className="debug-row__label">{D.stackTop}</span>
          <div className="debug-row__choices">
            {(['p1', 'p2'] as const).map((s) => (
              <RoughButton key={s} seed={`stack-side-${s}`} className="debug-row__choice debug-row__choice--side" highlight={stackSide === s} onClick={() => setStackSide(s)}>
                {s === 'p1' ? '1P' : '2P'}
              </RoughButton>
            ))}
          </div>
          <span className="debug-stack" data-testid="stack-list">
            {stack[stackSide].length === 0 ? <span className="pencil">{D.stackNone}</span> : D.stackList(stack[stackSide].map((no) => CARD_DB[no].name).join(' → '))}
          </span>
          <RoughButton seed="stack-clear" className="debug-row__choice" disabled={stack[stackSide].length === 0} onClick={() => setStack((st) => ({ ...st, [stackSide]: [] }))}>
            {D.stackClear}
          </RoughButton>
        </div>
        <p className="debug-row__note debug-stack-note pencil">{D.stackNote}</p>
        <div className="debug-row debug-row--cards">
          {choice.map((no) => (
            <RoughButton
              key={no}
              seed={`stack-card-${no}`}
              className="debug-card-btn"
              disabled={stack[stackSide].length >= STACK_MAX}
              onClick={() => setStack((st) => ({ ...st, [stackSide]: [...st[stackSide], no] }))}
            >
              {CARD_DB[no].name}
            </RoughButton>
          ))}
        </div>

        <div className="debug-row">
          <span className="debug-row__label">{D.hash}</span>
          <div className="debug-row__choices">
            <RoughButton seed="hash-on" className="debug-row__choice" highlight={showHash} onClick={() => setShowHash(true)}>
              {D.show}
            </RoughButton>
            <RoughButton seed="hash-off" className="debug-row__choice" highlight={!showHash} onClick={() => setShowHash(false)}>
              {D.hide}
            </RoughButton>
          </div>
          <span className="debug-row__note pencil">{D.logNote}</span>
        </div>

        {/* デバッグの道具（v2.0-D）：コイン・ログボの日付・チュートリアル・セーブ */}
        <div className="debug-row">
          <span className="debug-row__label">{D.tools}</span>
          <div className="debug-row__choices debug-tools">
            <RoughButton seed="tool-coins" className="debug-row__choice debug-tool" onClick={() => tool(() => update((d) => void addCoins(d, ECONOMY.debugAddCoins)))}>
              {D.addCoins(ECONOMY.debugAddCoins)}
            </RoughButton>
            <RoughButton seed="tool-day" className="debug-row__choice debug-tool" onClick={() => tool(() => update((d) => debugNextDay(d)))}>
              {D.nextDay}
            </RoughButton>
            <RoughButton seed="tool-tutorial" className="debug-row__choice debug-tool" onClick={() => {
              update((d) => {
                d.tutorial = { done: false, gachaInviteShown: false };
              });
              go('tutorial');
            }}>
              {D.tutorialRestart}
            </RoughButton>
            <RoughButton seed="tool-wipe" className="debug-row__choice debug-tool" stroke="var(--pen-red)" onClick={() => setWipeOpen(true)}>
              <span className="red-pen">{D.wipe}</span>
            </RoughButton>
          </div>
          {toolMsg > 0 && <span key={toolMsg} className="debug-row__note blue-pen debug-tool-done">{D.done}</span>}
        </div>

        <div className="debug-starts">
          <RoughButton seed="debug-local" className="debug-scene__start" highlight disabled={usable.length === 0} onClick={() => start('local')}>
            {D.local}
          </RoughButton>
          <RoughButton seed="debug-cpu" className="debug-scene__start" highlight disabled={usable.length === 0} onClick={() => start('cpu')}>
            {D.cpu}
          </RoughButton>
        </div>
      </RoughBox>
      {wipeOpen && (
        <Dialog
          seed="debug-wipe"
          title={D.wipeTitle}
          onClose={() => setWipeOpen(false)}
          actions={
            <>
              <RoughButton seed="debug-wipe-no" onClick={() => setWipeOpen(false)}>
                {tr.common.cancel}
              </RoughButton>
              <RoughButton
                seed="debug-wipe-yes"
                stroke="var(--pen-red)"
                onClick={() => {
                  setWipeOpen(false);
                  reset();
                  go('title');
                }}
              >
                <span className="red-pen">{D.wipeYes}</span>
              </RoughButton>
            </>
          }
        >
          {D.wipeText}
        </Dialog>
      )}
    </div>
  );
}

/** 1P・2P のデッキ：デッキ選択パネル（SPEC §7 S02）で選ぶ */
function DeckPick({ label, seed, value, onChange }: { label: string; seed: string; value: number; onChange: (i: number) => void }) {
  const { save } = useSave();
  return (
    <div className="debug-row">
      <span className="debug-row__label">{label}</span>
      <div className="debug-row__choices">
        <DeckChooser save={save} seed={seed} label="" value={value} onChange={onChange} />
      </div>
    </div>
  );
}
