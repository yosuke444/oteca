import { useState } from 'react';
import { DEFAULT_RULES } from '../../engine';
import { useT } from '../../i18n/useT';
import { usableDecks } from '../../save/collection';
import type { SaveData } from '../../save/saveData';
import { Dialog } from '../common/Dialog';
import { Sticky } from '../common/Sticky';
import { RoughButton } from '../rough/RoughButton';
import './deckPicker.css';

/**
 * デッキ選択パネル（SPEC §7 S02・UPDATE_v2 §3-2）。共通部品。
 * 4列×5段のふせんの一覧（20スロット）。各ふせんにデッキ名・枚数。使えないデッキには赤い「!」。
 * mode='battle'（対戦に使うデッキを選ぶ）では、使えないデッキは押せない。
 * mode='edit'（デッキ編集）では、どのデッキも選べる。
 */
export type DeckPickerMode = 'battle' | 'edit';

export function DeckPicker({
  save,
  current,
  mode,
  onPick,
  disabledSlot,
}: {
  save: SaveData;
  /** いま選んでいるスロット（-1 で無し） */
  current: number;
  mode: DeckPickerMode;
  onPick: (slot: number) => void;
  /** 押せないスロット（コピー元など） */
  disabledSlot?: number;
}) {
  const tr = useT();
  const usable = usableDecks(save);
  return (
    <div className="deck-picker" role="list">
      {save.decks.map((d, i) => {
        const locked = (mode === 'battle' && !usable[i]) || i === disabledSlot;
        return (
          <button
            key={i}
            type="button"
            role="listitem"
            className={`deck-picker__slot ${i === current ? 'is-current' : ''} ${locked ? 'is-locked' : ''}`}
            disabled={locked}
            aria-label={tr.deckPicker.aria(i + 1, d.name)}
            aria-current={i === current}
            data-testid={`deck-slot-${i}`}
            onClick={() => onPick(i)}
          >
            <Sticky
              seed={`deck-picker-${i}`}
              color={locked ? 'blue' : i === current ? 'yellow' : d.cards.length === 0 ? 'blue' : 'green'}
              angle={i === current ? 0 : undefined}
              className="deck-picker__note"
            >
              <span className="num deck-picker__no">{i + 1}</span>
              <span className="deck-picker__name">{d.name}</span>
              <span className="pencil deck-picker__count">{tr.deckPicker.cards(d.cards.length, DEFAULT_RULES.deckSize)}</span>
            </Sticky>
            {!usable[i] && d.cards.length > 0 && <span className="deck-picker__bad num">{tr.deckPicker.bad}</span>}
          </button>
        );
      })}
    </div>
  );
}

/** デッキ選択パネルをダイアログで開く */
export function DeckPickerDialog({
  save,
  current,
  mode,
  title,
  note,
  onPick,
  onClose,
  disabledSlot,
}: {
  save: SaveData;
  current: number;
  mode: DeckPickerMode;
  title?: string;
  /** パネルの下の注意書き（省略時は「赤い ! のデッキは…」） */
  note?: string;
  onPick: (slot: number) => void;
  onClose: () => void;
  disabledSlot?: number;
}) {
  const tr = useT();
  return (
    <Dialog
      seed="deck-picker"
      title={title ?? tr.deckPicker.title}
      width={900}
      onClose={onClose}
      actions={
        <RoughButton seed="deck-picker-close" onClick={onClose}>
          {tr.common.close}
        </RoughButton>
      }
    >
      <DeckPicker save={save} current={current} mode={mode} disabledSlot={disabledSlot} onPick={onPick} />
      <p className="deck-picker__note-text pencil">{note ?? (mode === 'battle' ? tr.deckPicker.note : tr.deckPicker.noteEdit)}</p>
    </Dialog>
  );
}

/**
 * 「いまのデッキ：（デッキ名）」と「デッキを えらぶ」（対戦用）。押すとデッキ選択パネルが開く。
 * 選んだデッキは「いまのデッキ」（selectedDeck）として保存する（onChange の外で）
 */
export function DeckChooser({
  save,
  value,
  onChange,
  label,
  seed,
}: {
  save: SaveData;
  /** 選んでいるスロット（-1 で無し） */
  value: number;
  onChange: (slot: number) => void;
  /** 「いまの デッキ：」の代わりに出す見出し（デバッグの 1P・2P など） */
  label?: string;
  seed: string;
}) {
  const tr = useT();
  const [open, setOpen] = useState(false);
  const deck = value >= 0 ? save.decks[value] : undefined;
  return (
    <div className="deck-chooser">
      <span className="deck-chooser__label pencil">{label ?? tr.deck.current}</span>
      <span className={`deck-chooser__name ${deck ? '' : 'red-pen'}`} data-testid={`${seed}-name`}>
        {deck ? deck.name : tr.deckPicker.none}
      </span>
      <RoughButton seed={`${seed}-choose`} className="deck-chooser__btn" onClick={() => setOpen(true)}>
        {tr.deck.choose}
      </RoughButton>
      {open && (
        <DeckPickerDialog
          save={save}
          current={value}
          mode="battle"
          onClose={() => setOpen(false)}
          onPick={(i) => {
            onChange(i);
            setOpen(false);
          }}
        />
      )}
    </div>
  );
}
