import { useEffect, useState } from 'react';
import { type BattleSetup, randomSeed } from '../../battle/setup';
import { CARD_DB, CARD_LIST } from '../../data/cards';
import { starterDeckNos } from '../../data/starterDeck';
import type { CardDef, Side } from '../../engine/types';
import { useT } from '../../i18n/useT';
import { useNav } from '../../router';
import { CardDetail } from '../../ui/card/CardDetail';
import { CardMini } from '../../ui/card/CardMini';
import { Dialog } from '../../ui/common/Dialog';
import { RoughBox } from '../../ui/rough/RoughBox';
import { RoughButton } from '../../ui/rough/RoughButton';
import './cardLab.css';

/**
 * デバッグ「カードを ためす」（SPEC §7 S99・v2.0）
 * 全カードから、1P・2P のバトル場・ベンチ・手札に好きなカードを置き、サイコロの目を順番に決めて、
 * ひとりで両方を操作して技を試す。準備（先攻決め・バトル場決め）は飛ばし、1P のターンから始める。
 */

type Layout = { active: number | null; bench: (number | null)[]; hand: number[] };
type SlotKey = `${Side}:active` | `${Side}:bench0` | `${Side}:bench1` | `${Side}:hand`;

const SIDES: Side[] = ['p1', 'p2'];
const HAND_MAX = 7;
const DICE_MAX = 12;

/** 前に試した置き方を覚えておく（画面を出て戻っても続きから） */
let remembered: { layout: Record<Side, Layout>; dice: number[] } = {
  layout: {
    p1: { active: CARD_LIST.find((c) => c.id === 'oteage')?.no ?? 1, bench: [null, null], hand: [] },
    p2: { active: CARD_LIST.find((c) => c.id === 'mutsuashi')?.no ?? 1, bench: [null, null], hand: [] },
  },
  dice: [],
};

export function CardLabScene() {
  const { go } = useNav();
  const tr = useT();
  const L = tr.debug.lab;
  const [layout, setLayout] = useState(remembered.layout);
  const [dice, setDice] = useState(remembered.dice);
  const [slot, setSlot] = useState<SlotKey>('p1:active');
  const [msg, setMsg] = useState<{ text: string; n: number } | null>(null);
  const [detail, setDetail] = useState<CardDef | null>(null);

  useEffect(() => {
    remembered = { layout, dice };
  }, [layout, dice]);
  useEffect(() => {
    if (!msg) return;
    const id = window.setTimeout(() => setMsg(null), 1800);
    return () => window.clearTimeout(id);
  }, [msg]);

  const say = (text: string) => setMsg((m) => ({ text, n: (m?.n ?? 0) + 1 }));
  const name = (no: number | null) => (no === null ? L.empty : (CARD_DB[no]?.name ?? L.empty));

  const put = (def: CardDef) => {
    const [side, where] = slot.split(':') as [Side, string];
    setLayout((cur) => {
      const next = { ...cur, [side]: { ...cur[side], bench: [...cur[side].bench], hand: [...cur[side].hand] } };
      const l = next[side];
      if (where === 'hand') {
        if (l.hand.length >= HAND_MAX) {
          say(L.handFull(HAND_MAX));
          return cur;
        }
        l.hand.push(def.no);
        return next;
      }
      if (def.kind !== 'otege') {
        say(L.otegeOnly);
        return cur;
      }
      if (where === 'active') l.active = def.no;
      else l.bench[where === 'bench0' ? 0 : 1] = def.no;
      return next;
    });
  };

  /** 置いたカードを外す（ベンチ・手札） */
  const clearSlot = (side: Side, where: 'bench0' | 'bench1' | number) => {
    setLayout((cur) => {
      const l = { ...cur[side], bench: [...cur[side].bench], hand: [...cur[side].hand] };
      if (typeof where === 'number') l.hand.splice(where, 1);
      else l.bench[where === 'bench0' ? 0 : 1] = null;
      return { ...cur, [side]: l };
    });
  };

  const start = () => {
    const deck = starterDeckNos();
    const sb = (side: Side) => {
      const l = layout[side];
      return { active: l.active ?? deck[0], bench: l.bench.filter((n): n is number => n !== null), hand: [...l.hand], deck: [...deck] };
    };
    const setup: BattleSetup = {
      mode: 'local',
      decks: { p1: deck, p2: deck },
      names: { p1: L.p1Name, p2: L.p2Name },
      seed: randomSeed(),
      me: 'p1',
      record: false,
      debug: true,
      showHash: true,
      sandbox: { p1: sb('p1'), p2: sb('p2') },
      forcedDice: [...dice],
    };
    go('battle', setup);
  };

  const chip = (key: SlotKey, label: string, value: string, onClear?: () => void) => (
    <button
      key={key + label}
      type="button"
      className={`lab-chip ${slot === key ? 'is-current' : ''}`}
      onClick={() => {
        if (slot === key && onClear) onClear();
        else setSlot(key);
      }}
    >
      <small className="pencil">{label}</small>
      <span className="lab-chip__name">{value}</span>
    </button>
  );

  return (
    <div className="lab-scene">
      <h1 className="lab-scene__title">{L.title}</h1>
      <RoughButton seed="lab-back" className="lab-scene__back" onClick={() => go('debug')}>
        {tr.common.back}
      </RoughButton>

      <RoughBox seed="lab-field" className="lab-field" paper radius={8}>
        {SIDES.map((side) => {
          const l = layout[side];
          return (
            <div key={side} className="lab-row">
              <span className="lab-row__side num">{L.side(side === 'p1' ? 1 : 2)}</span>
              {chip(`${side}:active`, L.active, name(l.active))}
              {chip(`${side}:bench0`, L.bench(1), name(l.bench[0]), () => clearSlot(side, 'bench0'))}
              {chip(`${side}:bench1`, L.bench(2), name(l.bench[1]), () => clearSlot(side, 'bench1'))}
              <button type="button" className={`lab-chip lab-chip--hand ${slot === `${side}:hand` ? 'is-current' : ''}`} onClick={() => setSlot(`${side}:hand`)}>
                <small className="pencil">{L.hand}</small>
                <span className="lab-hand">
                  {l.hand.length === 0 && <span className="lab-chip__name">{L.empty}</span>}
                  {l.hand.map((no, i) => (
                    <span
                      key={i}
                      className="lab-hand__card"
                      role="button"
                      tabIndex={0}
                      onClick={(e) => {
                        e.stopPropagation();
                        clearSlot(side, i);
                      }}
                    >
                      {name(no)} ×
                    </span>
                  ))}
                </span>
              </button>
            </div>
          );
        })}
        <p className="lab-field__note pencil">{L.note}</p>
      </RoughBox>

      <div className="lab-grid">
        {CARD_LIST.map((def) => (
          <CardMini key={def.no} def={def} seed={`lab-${def.no}`} variant="slot" onTap={() => put(def)} onDetail={() => setDetail(def)} />
        ))}
      </div>

      <div className="lab-dice">
        <span className="lab-dice__label">{L.dice}</span>
        {[1, 2, 3, 4, 5, 6].map((f) => (
          <RoughButton key={f} seed={`lab-die-${f}`} className="lab-dice__btn" disabled={dice.length >= DICE_MAX} onClick={() => setDice((d) => [...d, f])}>
            <span className="num">{f}</span>
          </RoughButton>
        ))}
        <span className="lab-dice__list num" data-testid="lab-dice">
          {dice.length === 0 ? L.diceNone : dice.join(' → ')}
        </span>
        <RoughButton seed="lab-dice-clear" className="lab-dice__btn lab-dice__btn--clear" disabled={dice.length === 0} onClick={() => setDice([])}>
          {L.diceClear}
        </RoughButton>
        <RoughButton seed="lab-start" className="lab-scene__start" highlight strokeWidth={3} onClick={start}>
          {L.start}
        </RoughButton>
      </div>
      <p className="lab-scene__decknote pencil">{L.deckNote}</p>

      {msg && (
        <div key={msg.n} className="lab-scene__msg red-pen" role="status">
          {msg.text}
        </div>
      )}

      {detail && (
        <Dialog
          seed="lab-detail"
          width={420}
          onClose={() => setDetail(null)}
          actions={
            <RoughButton seed="lab-detail-close" onClick={() => setDetail(null)}>
              {tr.common.close}
            </RoughButton>
          }
        >
          <div className="lab-scene__detail">
            <CardDetail def={detail} seed={`lab-detail-${detail.no}`} />
          </div>
        </Dialog>
      )}
    </div>
  );
}
