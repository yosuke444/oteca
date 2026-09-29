import { useState } from 'react';
import { type BattleMode, type BattleSetup, randomSeed } from '../../battle/setup';
import { CARD_DB } from '../../data/cards';
import { validateDeck } from '../../engine';
import type { Side } from '../../engine/types';
import { useNav } from '../../router';
import { useSave } from '../../state/SaveContext';
import { RoughBox } from '../../ui/rough/RoughBox';
import { RoughButton } from '../../ui/rough/RoughButton';
import './debug.css';

/** 山札の上に積めるのは何枚まで（画面に並べる都合） */
const STACK_MAX = 6;

/** S99 デバッグ対戦（SPEC §7。?debug=1 の時だけメニューに出る） */
export function DebugScene() {
  const { go } = useNav();
  const { save } = useSave();
  const usable = save.decks.map((d, i) => ({ i, d })).filter(({ d }) => validateDeck(d.cards, CARD_DB).length === 0);
  const [deck1, setDeck1] = useState(usable[0]?.i ?? 0);
  const [deck2, setDeck2] = useState(usable[0]?.i ?? 0);
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
      names: cpu ? { p1: save.playerName, p2: 'かんたんCPU' } : { p1: `${save.playerName}（1P）`, p2: '2P' },
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

  const names = save.decks.map((d) => d.name);
  const ids = usable.map((u) => u.i);
  const choice = stackable(stackSide);

  return (
    <div className="debug-scene">
      <h1 className="debug-scene__title">デバッグたいせん</h1>
      <RoughButton seed="debug-back" className="debug-scene__back" onClick={() => go('menu')}>
        もどる
      </RoughButton>
      <RoughButton seed="debug-fxtest" className="debug-scene__tool" onClick={() => go('fxtest')}>
        えんしゅつ テスト
      </RoughButton>
      <RoughBox seed="debug-panel" className="debug-panel" paper radius={8}>
        <DeckPick label="1P（あなた）" value={deck1} onChange={(i) => { setDeck1(i); setStack((st) => ({ ...st, p1: [] })); }} usable={ids} names={names} />
        <DeckPick label="2P（あいて・CPU）" value={deck2} onChange={(i) => { setDeck2(i); setStack((st) => ({ ...st, p2: [] })); }} usable={ids} names={names} />

        <div className="debug-row">
          <span className="debug-row__label">サイコロの目を こてい</span>
          <div className="debug-row__choices">
            {[null, 1, 2, 3, 4, 5, 6].map((v) => (
              <RoughButton key={String(v)} seed={`die-${v}`} className="debug-row__choice debug-row__choice--die" highlight={die === v} onClick={() => setDie(v)}>
                {v === null ? 'しない' : <span className="num">{v}</span>}
              </RoughButton>
            ))}
          </div>
          <span className="debug-row__note pencil">こうげきの サイコロだけ</span>
        </div>

        <div className="debug-row">
          <span className="debug-row__label">やまふだの うえ</span>
          <div className="debug-row__choices">
            {(['p1', 'p2'] as const).map((s) => (
              <RoughButton key={s} seed={`stack-side-${s}`} className="debug-row__choice debug-row__choice--side" highlight={stackSide === s} onClick={() => setStackSide(s)}>
                {s === 'p1' ? '1P' : '2P'}
              </RoughButton>
            ))}
          </div>
          <span className="debug-stack" data-testid="stack-list">
            {stack[stackSide].length === 0 ? <span className="pencil">（してい なし）</span> : `うえから：${stack[stackSide].map((no) => CARD_DB[no].name).join(' → ')}`}
          </span>
          <RoughButton seed="stack-clear" className="debug-row__choice" disabled={stack[stackSide].length === 0} onClick={() => setStack((st) => ({ ...st, [stackSide]: [] }))}>
            けす
          </RoughButton>
        </div>
        <p className="debug-row__note debug-stack-note pencil">はじめの てふだに きた カードは やまふだに ないので のぞかれるよ</p>
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
          <span className="debug-row__label">じょうたい ハッシュ</span>
          <div className="debug-row__choices">
            <RoughButton seed="hash-on" className="debug-row__choice" highlight={showHash} onClick={() => setShowHash(true)}>
              だす
            </RoughButton>
            <RoughButton seed="hash-off" className="debug-row__choice" highlight={!showHash} onClick={() => setShowHash(false)}>
              ださない
            </RoughButton>
          </div>
          <span className="debug-row__note pencil">こうどうログの ほぞんは ⚙ と リザルトから（いつでも）</span>
        </div>

        <div className="debug-starts">
          <RoughButton seed="debug-local" className="debug-scene__start" highlight disabled={usable.length === 0} onClick={() => start('local')}>
            ひとりで りょうほう あやつる
          </RoughButton>
          <RoughButton seed="debug-cpu" className="debug-scene__start" highlight disabled={usable.length === 0} onClick={() => start('cpu')}>
            かんたんCPU と たいせん
          </RoughButton>
        </div>
      </RoughBox>
    </div>
  );
}

export function DeckPick({ label, value, onChange, usable, names }: { label: string; value: number; onChange: (i: number) => void; usable: number[]; names: string[] }) {
  return (
    <div className="debug-row">
      <span className="debug-row__label">{label}</span>
      <div className="debug-row__choices">
        {names.map((n, i) => (
          <RoughButton key={i} seed={`${label}-${i}`} className="debug-row__choice" disabled={!usable.includes(i)} highlight={value === i} onClick={() => onChange(i)}>
            {n}
          </RoughButton>
        ))}
      </div>
    </div>
  );
}
