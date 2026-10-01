import { useState } from 'react';
import { type BattleSetup, randomSeed } from '../../battle/setup';
import { CPU_LEVELS, CPU_LEVEL_LABEL, type CpuLevel } from '../../cpu/brains';
import { CARD_DB } from '../../data/cards';
import { validateDeck } from '../../engine';
import { useNav } from '../../router';
import { useSave } from '../../state/SaveContext';
import { RoughButton } from '../../ui/rough/RoughButton';
import { Sticky } from '../../ui/common/Sticky';
import './cpu.css';

/** 強さの ひとこと説明 */
const LEVEL_NOTE: Record<CpuLevel, string> = {
  weak: 'てきとうに だすよ',
  normal: 'すなおに たたかう',
  strong: 'かくりつを けいさん',
  strongest: 'さきを よみまくる',
};

type Step = 'level' | 'mine' | 'cpu';
const STEPS: { id: Step; label: string }[] = [
  { id: 'level', label: 'つよさ' },
  { id: 'mine', label: 'じぶんの デッキ' },
  { id: 'cpu', label: 'CPUの デッキ' },
];

/**
 * S10 CPUたいせん（SPEC §7 S10・v1.4）
 * 強さ → 自分のデッキ → CPU に渡すデッキ を選ぶ。デッキは保存している5つのスロットから（使えるものだけ。同じデッキも選べる）。
 * 通信は使わない（オフラインでも遊べる）。
 */
export function CpuScene() {
  const { go } = useNav();
  const { save } = useSave();
  const [step, setStep] = useState<Step>('level');
  const [level, setLevel] = useState<CpuLevel>('normal');
  const [mine, setMine] = useState(-1);
  const usable = save.decks.map((d) => validateDeck(d.cards, CARD_DB).length === 0);

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
      names: { p1: save.playerName, p2: `CPU（${CPU_LEVEL_LABEL[level]}）` },
      seed: randomSeed(),
      me: 'p1',
      record: true,
    };
    go('battle', setup);
  };

  const deckButtons = (onPick: (i: number) => void, chosen: number) => (
    <div className="cpu-scene__decks">
      {save.decks.map((d, i) => (
        <RoughButton key={i} seed={`cpu-deck-${step}-${i}`} className="cpu-scene__deck" disabled={!usable[i]} highlight={chosen === i} onClick={() => onPick(i)}>
          <span className="cpu-scene__deck-name">{d.name}</span>
          <span className={usable[i] ? 'cpu-scene__deck-note pencil' : 'cpu-scene__deck-note red-pen'}>{usable[i] ? `${d.cards.length}まい` : 'つかえない'}</span>
        </RoughButton>
      ))}
    </div>
  );

  return (
    <div className="cpu-scene" data-testid="cpu-scene">
      <h1 className="cpu-scene__title">CPUたいせん</h1>
      <RoughButton seed="cpu-back" className="cpu-scene__back" onClick={back}>
        もどる
      </RoughButton>

      {/* いま どこを選んでいるか */}
      <ol className="cpu-scene__steps">
        {STEPS.map((s, i) => (
          <li key={s.id} className={s.id === step ? 'is-now' : STEPS.findIndex((x) => x.id === step) > i ? 'is-done' : ''}>
            <span className="num">{i + 1}</span> {s.label}
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
                <span className="cpu-scene__level-name">{CPU_LEVEL_LABEL[lv]}</span>
                <span className="cpu-scene__level-note pencil">{LEVEL_NOTE[lv]}</span>
                <span className="cpu-scene__level-rec" data-testid={`cpu-rec-${lv}`}>
                  <span className="num">{rec.wins}</span> かち　<span className="num">{rec.losses}</span> まけ
                </span>
              </RoughButton>
            );
          })}
        </div>
      )}

      {step === 'mine' && (
        <>
          <p className="cpu-scene__ask">あなたが つかう デッキを えらんでね</p>
          {deckButtons((i) => {
            setMine(i);
            setStep('cpu');
          }, mine)}
        </>
      )}

      {step === 'cpu' && (
        <>
          <p className="cpu-scene__ask">CPUに わたす デッキを えらんでね（おなじ デッキでも いいよ）</p>
          {deckButtons(start, -1)}
        </>
      )}

      {step !== 'level' && (
        <Sticky seed="cpu-summary" color="yellow" angle={-2} className="cpu-scene__summary">
          つよさ：{CPU_LEVEL_LABEL[level]}
          {step === 'cpu' && mine >= 0 && (
            <>
              <br />
              あなた：{save.decks[mine].name}
            </>
          )}
        </Sticky>
      )}

      {usable.every((u) => !u) && <p className="cpu-scene__none red-pen">つかえる デッキが ないよ。デッキへんしゅうで 15まい いれてね</p>}
    </div>
  );
}
