import { useState } from 'react';
import { type BattleSetup, randomSeed } from '../../battle/setup';
import { CPU_LEVELS, type CpuLevel } from '../../cpu/brains';
import { usableDecks } from '../../save/collection';
import { DeckPicker } from '../../ui/deck/DeckPicker';
import { useNav } from '../../router';
import { useSave } from '../../state/SaveContext';
import { RoughButton } from '../../ui/rough/RoughButton';
import { Sticky } from '../../ui/common/Sticky';
import { ModeGuide } from '../../ui/guide/ModeGuide';
import './cpu.css';
import { useT } from '../../i18n/useT';

type Step = 'level' | 'mine' | 'cpu';
const STEPS: Step[] = ['level', 'mine', 'cpu'];

/**
 * S10 CPUたいせん（SPEC §7 S10・v1.4）
 * 強さ → 自分のデッキ → CPU に渡すデッキ を選ぶ。デッキは保存している20のスロットから、デッキ選択パネルで（使えるものだけ。同じデッキも選べる）。
 * 通信は使わない（オフラインでも遊べる）。
 */
export function CpuScene() {
  const { go } = useNav();
  const { save, update } = useSave();
  const tr = useT();
  const [step, setStep] = useState<Step>('level');
  const [level, setLevel] = useState<CpuLevel>('normal');
  const [mine, setMine] = useState(-1);
  const usable = usableDecks(save);

  const back = () => {
    if (step === 'cpu') setStep('mine');
    else if (step === 'mine') setStep('level');
    else go('menu');
  };

  const start = (cpuDeck: number) => {
    const setup: BattleSetup = {
      mode: 'cpu',
      cpuLevel: level,
      decks: { p1: save.decks[mine].cards, p2: save.decks[cpuDeck].cards },
      names: { p1: save.playerName, p2: tr.cpu.cpuName(tr.cpu.level[level]) },
      seed: randomSeed(),
      me: 'p1',
      record: true,
    };
    go('battle', setup);
  };

  const deckButtons = (onPick: (i: number) => void, chosen: number) => (
    <div className="cpu-scene__decks">
      <DeckPicker save={save} current={chosen} mode="battle" onPick={onPick} />
    </div>
  );

  return (
    <div className="cpu-scene" data-testid="cpu-scene">
      <h1 className="cpu-scene__title">{tr.cpu.title}</h1>
      <ModeGuide mode="cpu" className="cpu-scene__guide" />
      <RoughButton seed="cpu-back" className="cpu-scene__back" onClick={back}>
        {tr.common.back}
      </RoughButton>

      {/* いま どこを選んでいるか */}
      <ol className="cpu-scene__steps">
        {STEPS.map((s, i) => (
          <li key={s} className={s === step ? 'is-now' : STEPS.indexOf(step) > i ? 'is-done' : ''}>
            <span className="num">{i + 1}</span> {tr.cpu.steps[s]}
          </li>
        ))}
      </ol>

      {step === 'level' && (
        <div className="cpu-scene__levels">
          {CPU_LEVELS.map((lv, i) => {
            const rec = save.cpuStats[i] ?? { wins: 0, losses: 0 };
            return (
              <RoughButton
                key={lv}
                seed={`cpu-level-${lv}`}
                className={`cpu-scene__level cpu-scene__level--${lv}`}
                strokeWidth={lv === 'strongest' ? 3.2 : 2.4}
                stroke={lv === 'strongest' ? 'var(--pen-red)' : undefined}
                highlight={level === lv}
                onClick={() => {
                  setLevel(lv);
                  setStep('mine');
                }}
              >
                <span className="cpu-scene__level-name">{tr.cpu.level[lv]}</span>
                <span className="cpu-scene__level-note pencil">{tr.cpu.levelNote[lv]}</span>
                <span className="cpu-scene__level-rec" data-testid={`cpu-rec-${lv}`}>
                  <span className="num">{rec.wins}</span> {tr.common.winsLosses.wins}{'  '}
                  <span className="num">{rec.losses}</span> {tr.common.winsLosses.losses}
                </span>
              </RoughButton>
            );
          })}
        </div>
      )}

      {step === 'mine' && (
        <>
          <p className="cpu-scene__ask">{tr.cpu.askMine}</p>
          {deckButtons((i) => {
            setMine(i);
            setStep('cpu');
            // 自分のデッキは「いまのデッキ」にする
            if (save.selectedDeck !== i) update((d) => void (d.selectedDeck = i));
          }, mine >= 0 ? mine : save.selectedDeck)}
        </>
      )}

      {step === 'cpu' && (
        <>
          <p className="cpu-scene__ask">{tr.cpu.askCpu}</p>
          {deckButtons(start, -1)}
        </>
      )}

      {step !== 'level' && (
        <Sticky seed="cpu-summary" color="yellow" angle={-2} className="cpu-scene__summary">
          {tr.cpu.summaryLevel(tr.cpu.level[level])}
          {step === 'cpu' && mine >= 0 && (
            <>
              <br />
              {tr.cpu.summaryMine(save.decks[mine].name)}
            </>
          )}
        </Sticky>
      )}

      {usable.every((u) => !u) && <p className="cpu-scene__none red-pen">{tr.cpu.none}</p>}
    </div>
  );
}
