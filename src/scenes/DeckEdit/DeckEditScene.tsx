import { useEffect, useMemo, useState } from 'react';
import { CARD_DB, CARD_LIST } from '../../data/cards';
import { PACK_DATA, SHOP_PACKS, inPack } from '../../data/packs';
import { DEFAULT_RULES } from '../../engine';
import type { CardDef } from '../../engine/types';
import { useNav } from '../../router';
import { checkSavedDeck, getOwnedCount } from '../../save/collection';
import { DECK_NAME_MAX, clampText } from '../../save/saveData';
import { useSave } from '../../state/SaveContext';
import { CardDetail } from '../../ui/card/CardDetail';
import { CardMini } from '../../ui/card/CardMini';
import { Dialog } from '../../ui/common/Dialog';
import { SavedToast } from '../../ui/common/SavedToast';
import { Sticky } from '../../ui/common/Sticky';
import { DeckPickerDialog } from '../../ui/deck/DeckPicker';
import { RoughBox } from '../../ui/rough/RoughBox';
import { RoughButton } from '../../ui/rough/RoughButton';
import { tiltStyle } from '../../ui/rough/seed';
import { addCard, autoFill, blockText, checkAdd, problemText, removeAt, summarize } from './deckOps';
import { useT } from '../../i18n/useT';
import './deckEdit.css';

type Filter = 'all' | 'owned' | 'otege' | 'item' | 'super';
type Sort = 'no' | 'name' | 'hp' | 'owned';

const FILTERS: Filter[] = ['all', 'owned', 'otege', 'item', 'super'];
const SORTS: Sort[] = ['no', 'name', 'hp', 'owned'];
/** パックの絞り込み：ぜんぶ（null）→ 各パック → 限定 */
// デイリーパックは、ほかのパックのカードだけなので絞り込みには出さない
const PACKS: (string | null)[] = [null, ...SHOP_PACKS.map((p) => p.id), 'limited'];

const rules = DEFAULT_RULES;

/** S02 デッキ編集（SPEC §7。v2.0-B：デッキ20個・所持数・絞り込みと並び替え） */
export function DeckEditScene() {
  const { go } = useNav();
  const { save, update } = useSave();
  const tr = useT();
  const [slot, setSlot] = useState(save.selectedDeck);
  const [filter, setFilter] = useState<Filter>('all');
  const [pack, setPack] = useState<string | null>(null);
  const [sort, setSort] = useState<Sort>('no');
  const [editingName, setEditingName] = useState(false);
  const [detail, setDetail] = useState<CardDef | null>(null);
  const [dialog, setDialog] = useState<'copy' | 'clear' | 'pick' | null>(null);
  const [reject, setReject] = useState<{ text: string; n: number } | null>(null);

  // 弾いた理由のふせんは2秒で消す
  useEffect(() => {
    if (!reject) return;
    const id = window.setTimeout(() => setReject(null), 2200);
    return () => window.clearTimeout(id);
  }, [reject]);

  const deck = save.decks[slot];
  const owned = (no: number) => getOwnedCount(save, no);
  const summary = summarize(deck.cards, CARD_DB);
  const check = checkSavedDeck(save, slot, rules);
  const inDeck = (no: number) => deck.cards.filter((c) => c === no).length;

  const setCards = (cards: number[]) =>
    update((d) => {
      d.decks[slot].cards = cards;
    }, { deck: true });

  /** デッキを選ぶ（「いまのデッキ」になる） */
  const pickSlot = (i: number) => {
    setSlot(i);
    setEditingName(false);
    if (save.selectedDeck !== i) update((d) => void (d.selectedDeck = i));
  };

  const tryAdd = (no: number) => {
    const block = checkAdd(deck.cards, no, CARD_DB, rules, owned);
    if (block) {
      // 違反カードは弾いて、ふせんを揺らす。持っていないカードは「まだ もっていないよ」
      const text = block === 'owned' && owned(no) === 0 ? tr.deck.problem.notOwnedYet : blockText(block, rules);
      setReject((r) => ({ text, n: (r?.n ?? 0) + 1 }));
      return;
    }
    setCards(addCard(deck.cards, no));
  };

  const list = useMemo(() => {
    const own = (c: CardDef) => getOwnedCount(save, c.no);
    const filtered = CARD_LIST.filter((c) => {
      if (pack && !inPack(c.id, pack)) return false;
      if (filter === 'owned') return own(c) > 0;
      if (filter === 'otege') return c.kind === 'otege';
      if (filter === 'item') return c.kind === 'item';
      if (filter === 'super') return c.kind === 'otege' && c.rarity === 'super';
      return true;
    });
    const hp = (c: CardDef) => (c.kind === 'otege' ? c.hp : -1);
    return [...filtered].sort((a, b) => {
      if (sort === 'hp') return hp(b) - hp(a) || a.no - b.no;
      if (sort === 'name') return a.name.localeCompare(b.name, 'ja') || a.no - b.no;
      if (sort === 'owned') return own(b) - own(a) || a.no - b.no;
      return a.no - b.no;
    });
  }, [filter, pack, sort, save]);

  const nextSort = () => setSort(SORTS[(SORTS.indexOf(sort) + 1) % SORTS.length]);
  const nextPack = () => setPack(PACKS[(PACKS.indexOf(pack) + 1) % PACKS.length]);
  const packLabel =
    pack === null ? tr.deck.packAll : pack === 'limited' ? tr.deck.packLimited : (PACK_DATA.packs.find((p) => p.id === pack)?.short ?? pack);

  return (
    <div className="deck-scene">
      {/* いまのデッキ：名前 ✎ ／ デッキを えらぶ */}
      <div className="deck-scene__name">
        <span className="pencil deck-scene__name-label">{tr.deck.current}</span>
        {editingName ? (
          <input
            className="pen-input deck-scene__name-input"
            autoFocus
            defaultValue={deck.name}
            maxLength={DECK_NAME_MAX * 2}
            onChange={(e) => {
              const v = clampText(e.target.value, DECK_NAME_MAX);
              if (v !== e.target.value) e.target.value = v;
            }}
            onBlur={(e) => {
              const v = clampText(e.target.value, DECK_NAME_MAX);
              if (v !== deck.name) update((d) => void (d.decks[slot].name = v));
              setEditingName(false);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.nativeEvent.isComposing && e.keyCode !== 229) e.currentTarget.blur();
            }}
          />
        ) : (
          <button type="button" className="deck-scene__name-btn" onClick={() => setEditingName(true)} data-testid="deck-name">
            <span className="tilt" style={tiltStyle(`deck-name-${slot}`)}>
              {deck.name}
            </span>{' '}
            <span className="deck-scene__pen">✎</span>
          </button>
        )}
        {!check.usable && deck.cards.length > 0 && <span className="deck-scene__bad num">{tr.deckPicker.bad}</span>}
        <span className="pencil deck-scene__name-hint">{tr.deck.nameHint(DECK_NAME_MAX)}</span>
      </div>
      <RoughButton seed="deck-choose" className="deck-scene__choose" onClick={() => setDialog('pick')}>
        {tr.deck.choose}
      </RoughButton>
      <RoughButton seed="deck-back" className="deck-scene__back" onClick={() => go('menu')}>
        {tr.common.back}
      </RoughButton>
      <SavedToast />

      {/* デッキ（15まいちょうど） */}
      <RoughBox seed={`deck-panel-${slot}`} className="deck-panel" paper radius={8}>
        <div className="deck-panel__head">
          <span className="deck-panel__title">{tr.deck.panelTitle(rules.deckSize)}</span>
          <span className={`num deck-panel__total ${summary.total === rules.deckSize ? 'is-ok' : ''}`}>
            {summary.total}/{rules.deckSize}
          </span>
          <span className="deck-panel__counts">
            {tr.deck.summaryOtege} <b className="num">{summary.otege}</b>{'  '}
            {tr.deck.summaryItem} <b className="num">{summary.item}</b>{'  '}
            {tr.deck.summarySuper}{' '}
            <b className={`num ${summary.super > rules.superMaxPerDeck ? 'red-pen' : ''}`}>
              {summary.super}/{rules.superMaxPerDeck}
            </b>
          </span>
        </div>
        <div className="deck-panel__slots">
          {Array.from({ length: rules.deckSize }, (_, i) => {
            const no = deck.cards[i];
            const def = no !== undefined ? CARD_DB[no] : undefined;
            if (!def) return <span key={`empty-${i}`} className="deck-slot-empty" />;
            return (
              <CardMini
                key={`${slot}-${i}-${no}`}
                def={def}
                seed={`deck-${slot}-${i}-${no}`}
                variant="slot"
                onTap={() => setCards(removeAt(deck.cards, i))}
                onDetail={() => setDetail(def)}
              />
            );
          })}
        </div>
        <ul className="deck-panel__problems" data-testid="deck-problems">
          {check.problems.map((p, i) => (
            <li key={`p${i}`} className="red-pen">
              ⚠ {problemText(p)}
            </li>
          ))}
          {check.shortages.map((s) => (
            <li key={`s${s.no}`} className="red-pen">
              ⚠ {tr.deck.problem.short(CARD_DB[s.no]?.name ?? String(s.no), s.missing)}
            </li>
          ))}
          {check.usable && <li className="deck-panel__ok">{tr.deck.ok}</li>}
        </ul>
      </RoughBox>

      {reject && (
        <Sticky seed="deck-reject" color="red" angle={-4} shake={reject.n} className="deck-scene__reject">
          {reject.text}
        </Sticky>
      )}

      {/* カードいちらん */}
      <RoughBox seed="deck-list-panel" className="list-panel" paper radius={8}>
        <span className="list-panel__title">{tr.deck.listTitle}</span>
        <div className="list-panel__head">
          <div className="list-panel__filters">
            {FILTERS.map((f) => (
              <RoughButton
                key={f}
                seed={`filter-${f}`}
                className="list-panel__filter"
                highlight={filter === f}
                onClick={() => setFilter(f)}
              >
                {tr.deck.filter[f]}
              </RoughButton>
            ))}
          </div>
          <RoughButton seed="pack" className="list-panel__pack" highlight={pack !== null} onClick={nextPack}>
            {tr.deck.pack(packLabel)}
          </RoughButton>
          <RoughButton seed="sort" className="list-panel__sort" onClick={nextSort}>
            {tr.deck.sortLabel(tr.deck.sort[sort])}
          </RoughButton>
        </div>
        <div className="list-panel__grid">
          {list.map((def) => {
            const own = owned(def.no);
            const finite = Number.isFinite(own);
            const blocked = checkAdd(deck.cards, def.no, CARD_DB, rules, owned) !== null;
            return (
              <CardMini
                key={def.no}
                def={def}
                seed={`list-${def.no}`}
                variant="tile"
                count={inDeck(def.no)}
                owned={finite ? own : undefined}
                left={finite ? Math.max(0, own - inDeck(def.no)) : undefined}
                unowned={own === 0}
                dim={blocked && own > 0}
                onTap={() => tryAdd(def.no)}
                onDetail={() => setDetail(def)}
              />
            );
          })}
        </div>
        <p className="list-panel__hint pencil">{tr.deck.hint}</p>
      </RoughBox>

      {/* 下のボタン */}
      <div className="deck-scene__actions">
        <RoughButton
          seed="deck-auto"
          className="deck-scene__action"
          disabled={deck.cards.length >= rules.deckSize}
          onClick={() => setCards(autoFill(deck.cards, CARD_DB, rules, owned, Math.random))}
        >
          {tr.deck.autoFill}
        </RoughButton>
        <RoughButton
          seed="deck-clear"
          className="deck-scene__action"
          disabled={deck.cards.length === 0}
          onClick={() => setDialog('clear')}
        >
          {tr.deck.clear}
        </RoughButton>
        <RoughButton seed="deck-copy" className="deck-scene__action" onClick={() => setDialog('copy')}>
          {tr.deck.copy}
        </RoughButton>
      </div>

      {detail && (
        <Dialog seed="card-detail" width={420} onClose={() => setDetail(null)} actions={
          <RoughButton seed="detail-close" onClick={() => setDetail(null)}>
            {tr.common.close}
          </RoughButton>
        }>
          <div className="deck-scene__detail">
            <CardDetail def={detail} seed={`detail-${detail.no}`} />
          </div>
        </Dialog>
      )}

      {dialog === 'pick' && (
        <DeckPickerDialog
          save={save}
          current={slot}
          mode="edit"
          onClose={() => setDialog(null)}
          onPick={(i) => {
            pickSlot(i);
            setDialog(null);
          }}
        />
      )}

      {dialog === 'clear' && (
        <Dialog
          seed="deck-clear-dialog"
          title={tr.deck.clearTitle}
          onClose={() => setDialog(null)}
          actions={
            <>
              <RoughButton seed="clear-no" onClick={() => setDialog(null)}>
                {tr.common.cancel}
              </RoughButton>
              <RoughButton
                seed="clear-yes"
                stroke="var(--pen-red)"
                onClick={() => {
                  setCards([]);
                  setDialog(null);
                }}
              >
                {tr.deck.clear}
              </RoughButton>
            </>
          }
        >
          {tr.deck.clearText(deck.name)}
        </Dialog>
      )}

      {dialog === 'copy' && (
        <DeckPickerDialog
          save={save}
          current={-1}
          mode="edit"
          title={tr.deck.copyTitle}
          note={tr.deck.copyNote}
          disabledSlot={slot}
          onClose={() => setDialog(null)}
          onPick={(i) => {
            // コピー先のデッキは うわがき（在庫はデッキごとなので、所持数は関係ない）
            update((d) => {
              d.decks[i].cards = [...deck.cards];
            }, { deck: true });
            setDialog(null);
            pickSlot(i);
          }}
        />
      )}
    </div>
  );
}
