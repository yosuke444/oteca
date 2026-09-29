import { useEffect, useMemo, useState } from 'react';
import { CARD_DB, CARD_LIST } from '../../data/cards';
import { DEFAULT_RULES, validateDeck } from '../../engine';
import type { CardDef } from '../../engine/types';
import { useNav } from '../../router';
import { getOwnedCount } from '../../save/collection';
import { DECK_NAME_MAX, DECK_SLOTS, clampText } from '../../save/saveData';
import { useSave } from '../../state/SaveContext';
import { CardDetail } from '../../ui/card/CardDetail';
import { CardMini } from '../../ui/card/CardMini';
import { Dialog } from '../../ui/common/Dialog';
import { SavedToast } from '../../ui/common/SavedToast';
import { Sticky } from '../../ui/common/Sticky';
import { RoughBox } from '../../ui/rough/RoughBox';
import { RoughButton } from '../../ui/rough/RoughButton';
import { tiltStyle } from '../../ui/rough/seed';
import { addCard, autoFill, blockText, checkAdd, problemText, removeAt, summarize } from './deckOps';
import './deckEdit.css';

type Filter = 'all' | 'otege' | 'item' | 'super';
type Sort = 'no' | 'hp' | 'name';

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'ぜんぶ' },
  { id: 'otege', label: 'おてあげ' },
  { id: 'item', label: 'アイテム' },
  { id: 'super', label: 'スーパー' },
];
const SORTS: { id: Sort; label: string }[] = [
  { id: 'no', label: 'ばんごう' },
  { id: 'hp', label: 'HP' },
  { id: 'name', label: 'なまえ' },
];

const rules = DEFAULT_RULES;

/** S02 デッキ編集（SPEC §7） */
export function DeckEditScene() {
  const { go } = useNav();
  const { save, update } = useSave();
  const [slot, setSlot] = useState(save.selectedDeck);
  const [filter, setFilter] = useState<Filter>('all');
  const [sort, setSort] = useState<Sort>('no');
  const [editingName, setEditingName] = useState(false);
  const [detail, setDetail] = useState<CardDef | null>(null);
  const [dialog, setDialog] = useState<'copy' | 'clear' | null>(null);
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
  const problems = validateDeck(deck.cards, CARD_DB, rules);

  const setCards = (cards: number[]) =>
    update((d) => {
      d.decks[slot].cards = cards;
    }, { deck: true });

  const tryAdd = (no: number) => {
    const block = checkAdd(deck.cards, no, CARD_DB, rules, owned);
    if (block) {
      // 違反カードは弾いて、ふせんを揺らす
      setReject((r) => ({ text: blockText(block, rules), n: (r?.n ?? 0) + 1 }));
      return;
    }
    setCards(addCard(deck.cards, no));
  };

  const list = useMemo(() => {
    const filtered = CARD_LIST.filter((c) => {
      if (filter === 'otege') return c.kind === 'otege';
      if (filter === 'item') return c.kind === 'item';
      if (filter === 'super') return c.kind === 'otege' && c.rarity === 'super';
      return true;
    });
    const hp = (c: CardDef) => (c.kind === 'otege' ? c.hp : -1);
    return [...filtered].sort((a, b) => {
      if (sort === 'hp') return hp(b) - hp(a) || a.no - b.no;
      if (sort === 'name') return a.name.localeCompare(b.name, 'ja') || a.no - b.no;
      return a.no - b.no;
    });
  }, [filter, sort]);

  const nextSort = () => setSort(SORTS[(SORTS.findIndex((s) => s.id === sort) + 1) % SORTS.length].id);

  return (
    <div className="deck-scene">
      {/* スロットタブ（ふせん型） */}
      <div className="deck-scene__tabs">
        {save.decks.map((d, i) => {
          const invalid = validateDeck(d.cards, CARD_DB, rules).length > 0;
          return (
            <button
              key={i}
              type="button"
              className={`deck-tab ${i === slot ? 'is-current' : ''}`}
              onClick={() => {
                setSlot(i);
                setEditingName(false);
              }}
              aria-label={`スロット${i + 1}`}
            >
              <Sticky seed={`deck-tab-${i}`} color={i === slot ? 'yellow' : 'blue'} angle={i === slot ? 0 : undefined} className="deck-tab__note">
                <span className="num deck-tab__num">{i + 1}</span>
              </Sticky>
              {invalid && <span className="deck-tab__bad num">!</span>}
            </button>
          );
        })}
      </div>
      <RoughButton seed="deck-back" className="deck-scene__back" onClick={() => go('menu')}>
        もどる
      </RoughButton>
      <SavedToast />

      {/* デッキ名 */}
      <div className="deck-scene__name">
        <span className="pencil">デッキめい：</span>
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
              if (e.key === 'Enter') e.currentTarget.blur();
            }}
          />
        ) : (
          <button type="button" className="deck-scene__name-btn" onClick={() => setEditingName(true)}>
            <span className="tilt" style={tiltStyle(`deck-name-${slot}`)}>
              {deck.name}
            </span>{' '}
            <span className="deck-scene__pen">✎</span>
          </button>
        )}
        <span className="pencil deck-scene__name-hint">（{DECK_NAME_MAX}もじ まで）</span>
      </div>

      {/* デッキ（15まいちょうど） */}
      <RoughBox seed={`deck-panel-${slot}`} className="deck-panel" paper radius={8}>
        <div className="deck-panel__head">
          <span className="deck-panel__title">デッキ（{rules.deckSize}まい ちょうど）</span>
          <span className={`num deck-panel__total ${summary.total === rules.deckSize ? 'is-ok' : ''}`}>
            {summary.total}/{rules.deckSize}
          </span>
          <span className="deck-panel__counts">
            おてあげ <b className="num">{summary.otege}</b>　アイテム <b className="num">{summary.item}</b>　S{' '}
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
        <ul className="deck-panel__problems">
          {problems.map((p, i) => (
            <li key={i} className="red-pen">
              ⚠ {problemText(p)}
            </li>
          ))}
          {problems.length === 0 && <li className="deck-panel__ok">✓ この デッキで あそべるよ</li>}
        </ul>
      </RoughBox>

      {reject && (
        <Sticky seed="deck-reject" color="red" angle={-4} shake={reject.n} className="deck-scene__reject">
          {reject.text}
        </Sticky>
      )}

      {/* カードいちらん */}
      <RoughBox seed="deck-list-panel" className="list-panel" paper radius={8}>
        <span className="list-panel__title">カードいちらん</span>
        <div className="list-panel__head">
          <div className="list-panel__filters">
            {FILTERS.map((f) => (
              <RoughButton
                key={f.id}
                seed={`filter-${f.id}`}
                className="list-panel__filter"
                highlight={filter === f.id}
                onClick={() => setFilter(f.id)}
              >
                {f.label}
              </RoughButton>
            ))}
          </div>
          <RoughButton seed="sort" className="list-panel__sort" onClick={nextSort}>
            ならび：{SORTS.find((s) => s.id === sort)!.label}
          </RoughButton>
        </div>
        <div className="list-panel__grid">
          {list.map((def) => {
            const count = deck.cards.filter((c) => c === def.no).length;
            const blocked = checkAdd(deck.cards, def.no, CARD_DB, rules, owned) !== null;
            return (
              <CardMini
                key={def.no}
                def={def}
                seed={`list-${def.no}`}
                variant="tile"
                count={count}
                dim={blocked}
                onTap={() => tryAdd(def.no)}
                onDetail={() => setDetail(def)}
              />
            );
          })}
        </div>
        <p className="list-panel__hint pencil">タップで いれる／ながおし・みぎクリックで おおきく みる</p>
      </RoughBox>

      {/* 下のボタン */}
      <div className="deck-scene__actions">
        <RoughButton
          seed="deck-auto"
          className="deck-scene__action"
          disabled={deck.cards.length >= rules.deckSize}
          onClick={() => setCards(autoFill(deck.cards, CARD_DB, rules, owned, Math.random))}
        >
          おまかせで うめる
        </RoughButton>
        <RoughButton
          seed="deck-clear"
          className="deck-scene__action"
          disabled={deck.cards.length === 0}
          onClick={() => setDialog('clear')}
        >
          からに する
        </RoughButton>
        <RoughButton seed="deck-copy" className="deck-scene__action" onClick={() => setDialog('copy')}>
          ほかの スロットへ コピー
        </RoughButton>
      </div>

      {detail && (
        <Dialog seed="card-detail" width={420} onClose={() => setDetail(null)} actions={
          <RoughButton seed="detail-close" onClick={() => setDetail(null)}>
            とじる
          </RoughButton>
        }>
          <div className="deck-scene__detail">
            <CardDetail def={detail} seed={`detail-${detail.no}`} />
          </div>
        </Dialog>
      )}

      {dialog === 'clear' && (
        <Dialog
          seed="deck-clear-dialog"
          title="デッキを からに する？"
          onClose={() => setDialog(null)}
          actions={
            <>
              <RoughButton seed="clear-no" onClick={() => setDialog(null)}>
                やめる
              </RoughButton>
              <RoughButton
                seed="clear-yes"
                stroke="var(--pen-red)"
                onClick={() => {
                  setCards([]);
                  setDialog(null);
                }}
              >
                からに する
              </RoughButton>
            </>
          }
        >
          「{deck.name}」の カードを ぜんぶ はずすよ。
        </Dialog>
      )}

      {dialog === 'copy' && (
        <Dialog
          seed="deck-copy-dialog"
          title="どの スロットに コピーする？"
          onClose={() => setDialog(null)}
          actions={
            <RoughButton seed="copy-cancel" onClick={() => setDialog(null)}>
              やめる
            </RoughButton>
          }
        >
          <p className="deck-scene__copy-note pencil">コピーさきの デッキは うわがき されるよ</p>
          <div className="deck-scene__copy-slots">
            {Array.from({ length: DECK_SLOTS }, (_, i) => (
              <RoughButton
                key={i}
                seed={`copy-to-${i}`}
                className="deck-scene__copy-slot"
                disabled={i === slot}
                onClick={() => {
                  update((d) => {
                    d.decks[i].cards = [...deck.cards];
                  }, { deck: true });
                  setDialog(null);
                  setSlot(i);
                }}
              >
                <span className="num">{i + 1}</span>
                <small>{save.decks[i].cards.length}まい</small>
              </RoughButton>
            ))}
          </div>
        </Dialog>
      )}
    </div>
  );
}
