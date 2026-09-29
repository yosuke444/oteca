import { useState } from 'react';
import { type BattleSetup, randomSeed } from '../../battle/setup';
import { CARD_DB } from '../../data/cards';
import { validateDeck } from '../../engine';
import { useNav } from '../../router';
import { useSave } from '../../state/SaveContext';
import { RoughBox } from '../../ui/rough/RoughBox';
import { RoughButton } from '../../ui/rough/RoughButton';
import './debug.css';

/** S99 デバッグ対戦（SPEC §7。?debug=1 の時だけメニューに出る） */
export function DebugScene() {
  const { go } = useNav();
  const { save } = useSave();
  const usable = save.decks.map((d, i) => ({ i, d })).filter(({ d }) => validateDeck(d.cards, CARD_DB).length === 0);
  const [deck1, setDeck1] = useState(usable[0]?.i ?? 0);
  const [deck2, setDeck2] = useState(usable[0]?.i ?? 0);

  const start = () => {
    const setup: BattleSetup = {
      mode: 'local',
      decks: { p1: save.decks[deck1].cards, p2: save.decks[deck2].cards },
      names: { p1: `${save.playerName}（1P）`, p2: '2P' },
      seed: randomSeed(),
      me: 'p1',
      record: false,
    };
    go('battle', setup);
  };

  return (
    <div className="debug-scene">
      <h1 className="debug-scene__title">デバッグたいせん</h1>
      <RoughButton seed="debug-back" className="debug-scene__back" onClick={() => go('menu')}>
        もどる
      </RoughButton>
      <RoughBox seed="debug-panel" className="debug-panel" paper radius={8}>
        <DeckPick label="1P の デッキ" value={deck1} onChange={setDeck1} usable={usable.map((u) => u.i)} names={save.decks.map((d) => d.name)} />
        <DeckPick label="2P の デッキ" value={deck2} onChange={setDeck2} usable={usable.map((u) => u.i)} names={save.decks.map((d) => d.name)} />
        <RoughButton seed="debug-local" className="debug-scene__start" highlight disabled={usable.length === 0} onClick={start}>
          ひとりで りょうほう あやつる
        </RoughButton>
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
