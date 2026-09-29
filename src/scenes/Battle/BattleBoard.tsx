import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { BattleMode } from '../../battle/setup';
import type { Action, GameState, Side } from '../../engine/types';
import { BattleCard, CARD_SIZE } from '../../ui/card/BattleCard';
import { CardBack } from '../../ui/card/CardBack';
import { DiceDoodle, StarDoodle } from '../../ui/common/Doodles';
import { RoughBox } from '../../ui/rough/RoughBox';
import { RoughButton } from '../../ui/rough/RoughButton';
import { tiltStyle } from '../../ui/rough/seed';
import { drawCounterText } from './battleText';
import { hintText } from './hints';
import { useCardGesture } from './useCardGesture';

export type BoardSel = { uid: string };

type Props = {
  view: GameState;
  me: Side;
  names: Record<Side, string>;
  mode: BattleMode;
  canAct: boolean;
  /** 自分が決める番か（違えば自分の手札・場をえんぴつ色に） */
  myDecision: boolean;
  busy: boolean;
  legal: Action[];
  selected: BoardSel | null;
  targets: Map<string, Action>;
  marked: { uid: string; move: number } | null;
  logLines: string[];
  logOpen: boolean;
  hints: boolean;
  idleSince: number;
  onToggleLog: () => void;
  onOpenMenu: () => void;
  onTapCard: (uid: string) => void;
  onTapZone: (key: string) => void;
  onLongPress: (uid: string) => void;
  onDrop: (uid: string, key: string | null) => void;
  onSelect: (sel: BoardSel | null) => void;
  onPerform: (a: Action) => void;
  onEndTurn: () => void;
};

const other = (s: Side): Side => (s === 'p1' ? 'p2' : 'p1');

/** 対戦画面のレイアウト（SPEC §8-1） */
export function BattleBoard(p: Props) {
  const { view, me } = p;
  const opp = other(me);
  const [drag, setDrag] = useState<{ uid: string; x: number; y: number; w: number; h: number } | null>(null);
  const boardRef = useRef<HTMLDivElement>(null);

  const sources = new Set(p.legal.map((a) => ('uid' in a ? a.uid : 'benchUid' in a ? a.benchUid : '')));
  const draggable = (uid: string) => p.canAct && p.legal.some((a) => (a.type === 'PLACE_BENCH' || a.type === 'USE_ITEM' || a.type === 'SWAP' || a.type === 'SETUP_ACTIVE') && ('uid' in a ? a.uid === uid : a.benchUid === uid));

  const toStage = (clientX: number, clientY: number) => {
    const r = boardRef.current!.getBoundingClientRect();
    const s = r.width / 1280;
    return { x: (clientX - r.left) / s, y: (clientY - r.top) / s };
  };

  const gesture = useCardGesture({
    onTap: p.onTapCard,
    onLongPress: p.onLongPress,
    canDrag: draggable,
    onDragStart: (uid, el) => {
      p.onSelect({ uid });
      const r = el.getBoundingClientRect();
      const b = boardRef.current!.getBoundingClientRect();
      const s = b.width / 1280;
      setDrag({ uid, x: (r.left - b.left) / s + r.width / s / 2, y: (r.top - b.top) / s + r.height / s / 2, w: el.offsetWidth, h: el.offsetHeight });
    },
    onDragMove: (info) => {
      const pt = toStage(info.clientX, info.clientY);
      setDrag((d) => (d ? { ...d, x: pt.x, y: pt.y } : d));
    },
    onDrop: (uid, key) => {
      setDrag(null);
      p.onDrop(uid, key);
    },
  });

  /** 黄色く光らせるか：選択中なら行き先、選んでいなければ操作できるカード */
  const isTarget = (key: string) => p.targets.has(key);
  const glow = (uid: string) => (p.selected ? isTarget(`card:${uid}`) : sources.has(uid));

  const renderCard = (uid: string, size: 'active' | 'bench' | 'hand', onField: boolean, extra?: { dropKey?: string; faceDown?: boolean }) => {
    const card = view.cards[uid];
    const def = view.cardDefs[card.no];
    const { w, h } = CARD_SIZE[size];
    if (extra?.faceDown) return <CardBack key={uid} seed={`back-${uid}`} width={w} height={h} />;
    const mine = card.owner === me;
    const isActiveTarget = size === 'active' && isTarget(`active:${me}`) && mine;
    return (
      <BattleCard
        key={uid}
        def={def}
        card={card}
        size={size}
        view={view}
        onField={onField}
        preview={onField && size === 'active' && view.phase === 'main' && view.currentPlayer === card.owner}
        highlight={glow(uid) || isActiveTarget}
        selected={p.selected?.uid === uid}
        dim={mine && (!p.myDecision || (size === 'hand' && p.canAct && !sources.has(uid) && !p.selected))}
        markedMove={p.marked?.uid === uid ? p.marked.move : null}
        data-drop={extra?.dropKey ?? `card:${uid}`}
        className={drag?.uid === uid ? 'is-dragging' : ''}
        {...gesture(uid)}
      />
    );
  };

  /** バトル場の枠（空・裏向き・カード） */
  const activeSlot = (side: Side) => {
    const ps = view.players[side];
    const key = `active:${side}`;
    const setupHidden = ps.active === null && ps.setupChoice !== null;
    const isDrop = side === me && isTarget(key);
    return (
      <div className={`battle-slot battle-slot--active battle-slot--${side === me ? 'me' : 'opp'} ${isDrop ? 'is-drop' : ''}`} data-zone={`${side}-active`} data-drop={key} onClick={() => ps.active === null && p.onTapZone(key)}>
        {ps.active ? (
          <div className={`battle-idle ${side === me ? '' : 'battle-idle--opp'}`}>{renderCard(ps.active, 'active', true, { dropKey: key })}</div>
        ) : setupHidden ? (
          <CardBack seed={`setup-${side}`} width={150} height={210} />
        ) : (
          <span className="battle-slot__label pencil">{side === me && view.phase === 'setup' ? 'ここに だす' : 'バトルば'}</span>
        )}
      </div>
    );
  };

  const benchSlot = (side: Side, i: number) => {
    const ps = view.players[side];
    const uid = ps.bench[i];
    const key = `bench-empty:${side}`;
    const isDrop = !uid && side === me && isTarget(key);
    return (
      <div className={`battle-slot battle-slot--bench battle-slot--bench${i} battle-slot--${side === me ? 'me' : 'opp'} ${isDrop ? 'is-drop' : ''}`} data-zone={`${side}-bench-${i}`} data-drop={uid ? undefined : key} onClick={() => !uid && p.onTapZone(key)}>
        {uid ? renderCard(uid, 'bench', true) : <span className="battle-slot__label pencil">ベンチ</span>}
      </div>
    );
  };

  const pile = (side: Side, kind: 'deck' | 'discard') => {
    const ps = view.players[side];
    const n = kind === 'deck' ? ps.deck.length : ps.discard.length;
    const top = kind === 'discard' ? ps.discard[ps.discard.length - 1] : undefined;
    return (
      <div className={`battle-pile battle-pile--${kind} battle-pile--${side === me ? 'me' : 'opp'}`} data-zone={`${side}-${kind}`}>
        {kind === 'deck' ? (
          n > 0 ? <CardBack seed={`deck-${side}`} width={84} height={118} /> : <span className="battle-pile__empty" />
        ) : top ? (
          <div className="battle-pile__top">
            <span className="battle-pile__top-name">{view.cardDefs[view.cards[top].no].name}</span>
          </div>
        ) : (
          <span className="battle-pile__empty" />
        )}
        <span className="battle-pile__label">
          {kind === 'deck' ? 'やまふだ' : 'すてふだ'} <b className="num">{n}</b>
        </span>
      </div>
    );
  };

  const stars = (side: Side) => {
    const need = view.rules[side].koToWin;
    const got = view.players[side].koCount;
    return (
      <span className="battle-stars" data-zone={`${side}-stars`} aria-label={`たおした ${got}`}>
        {Array.from({ length: need }, (_, i) => (
          <StarDoodle key={i} seed={`star-${side}-${i}`} size={26} className={`battle-star ${i < got ? 'is-on' : ''}`} />
        ))}
      </span>
    );
  };

  const myPs = view.players[me];
  const oppPs = view.players[opp];
  const myTurn = view.phase === 'main' && view.currentPlayer === me;
  const draw = drawCounterText(view, me);
  const endLabel = myPs.swappedThisTurn ? (
    <>
      ターンおわり
      <br />
      <small>（こうげきなし）</small>
    </>
  ) : (
    <>
      ターンおわり＆
      <br />
      こうげき！
    </>
  );
  const endLegal = p.legal.some((a) => a.type === 'END_TURN');
  const hand = myPs.hand.filter((u) => u !== myPs.setupChoice);
  // 準備で裏向きに置いたカードは、もう手札に数えない
  const oppHand = oppPs.hand.filter((u) => u !== oppPs.setupChoice);
  const selectedActions = p.selected ? p.legal.filter((a) => ('uid' in a ? a.uid : 'benchUid' in a ? a.benchUid : null) === p.selected!.uid) : [];

  return (
    <div className="battle-board" ref={boardRef}>
      {/* ---------------- 上：あいて ---------------- */}
      <div className="battle-top">
        <RoughBox seed={`name-${opp}`} className="battle-name battle-name--opp" radius={10}>
          <span className="tilt" style={tiltStyle(`name-${opp}`)}>
            {p.names[opp]}
          </span>
        </RoughBox>
        <span className="battle-top__item">たおした {stars(opp)}</span>
        <span className="battle-top__item" data-zone={`${opp}-hand`}>
          てふだ
          <span className="battle-top__backs">
            {oppHand.map((u) => (
              <span key={u} className="battle-top__back" />
            ))}
          </span>
          <b className="num">{oppHand.length}</b>
        </span>
        <span className="battle-top__item">
          やまふだ <b className="num">{oppPs.deck.length}</b>
        </span>
        <span className="battle-top__item">
          すてふだ <b className="num">{oppPs.discard.length}</b>
        </span>
        <div className="battle-top__buttons">
          <RoughButton seed="log-btn" className="battle-top__btn" highlight={p.logOpen} onClick={p.onToggleLog} ariaLabel="ログ">
            📝 ログ
          </RoughButton>
          <RoughButton seed="gear-btn" className="battle-top__btn battle-top__btn--gear" onClick={p.onOpenMenu} ariaLabel="メニュー">
            ⚙
          </RoughButton>
        </div>
      </div>

      {/* 相手の番の間は、画面上部に「あいての ターン」バナー（§8-3） */}
      {view.phase === 'main' && view.currentPlayer === opp && <div className="battle-opp-banner">あいての ターン</div>}

      {/* ---------------- あいての場 ---------------- */}
      {benchSlot(opp, 0)}
      {activeSlot(opp)}
      {benchSlot(opp, 1)}
      {pile(opp, 'deck')}
      {pile(opp, 'discard')}

      {/* ---------------- まんなか ---------------- */}
      <div className="battle-fold" aria-hidden />
      <div className={`battle-turn ${view.phase === 'setup' || view.phase === 'over' ? '' : view.currentPlayer === me ? 'is-me' : 'is-opp'}`}>
        {view.phase === 'setup'
          ? 'じゅんび'
          : view.phase === 'over'
            ? 'けっちゃく'
            : view.currentPlayer === me
              ? 'あなたの ターン'
              : 'あいての ターン'}
      </div>
      <div className="battle-dice" data-zone="dice" aria-hidden>
        <DiceDoodle seed="dice-home" size={40} face={5} className="battle-dice__icon" />
        <span className="pencil">サイコロおきば</span>
      </div>
      <div className={`battle-draw ${draw.soon ? 'is-soon' : ''}`}>{draw.text}</div>

      {/* ---------------- じぶんの場 ---------------- */}
      {benchSlot(me, 0)}
      {activeSlot(me)}
      {benchSlot(me, 1)}
      {pile(me, 'deck')}
      {pile(me, 'discard')}

      {/* ---------------- 下：じぶん ---------------- */}
      <div className="battle-me">
        <RoughBox seed={`name-${me}`} className="battle-name battle-name--me" radius={10}>
          <span className="tilt" style={tiltStyle(`name-${me}`)}>
            {p.names[me]}
          </span>
        </RoughBox>
        <span className="battle-me__stars">たおした {stars(me)}</span>
      </div>

      <div className="battle-hand" data-zone={`${me}-hand`}>
        {hand.map((uid, i) => {
          const n = hand.length;
          const spread = Math.min(92, 600 / Math.max(1, n));
          const off = i - (n - 1) / 2;
          return (
            <div
              key={uid}
              className={`battle-hand__slot ${p.selected?.uid === uid ? 'is-lifted' : ''}`}
              style={{ left: 640 + off * spread - 55, rotate: `${off * 4}deg`, top: Math.abs(off) * Math.abs(off) * 1.4, zIndex: i + 1 }}
            >
              {renderCard(uid, 'hand', false)}
            </div>
          );
        })}
      </div>

      {/* 選んでいる時の操作ボタン（タップ2回の操作） */}
      {p.selected && selectedActions.length > 0 && (
        <div className="battle-actionbar">
          {selectedActions.some((a) => a.type === 'PLACE_BENCH') && (
            <RoughButton seed="act-bench" highlight onClick={() => p.onPerform(selectedActions.find((a) => a.type === 'PLACE_BENCH')!)}>
              ベンチに だす
            </RoughButton>
          )}
          {selectedActions.some((a) => a.type === 'SETUP_ACTIVE') && (
            <RoughButton seed="act-setup" highlight onClick={() => p.onPerform(selectedActions.find((a) => a.type === 'SETUP_ACTIVE')!)}>
              バトルばに だす
            </RoughButton>
          )}
          {selectedActions.some((a) => a.type === 'SWAP') && (
            <RoughButton seed="act-swap" highlight onClick={() => p.onPerform(selectedActions.find((a) => a.type === 'SWAP')!)}>
              こうたい
            </RoughButton>
          )}
          {selectedActions.some((a) => a.type === 'USE_ITEM') && <span className="battle-actionbar__note">つかう おてあげを えらんでね</span>}
          <RoughButton seed="act-cancel" onClick={() => p.onSelect(null)}>
            やめる
          </RoughButton>
        </div>
      )}

      <EndTurnButton label={endLabel} active={endLegal} myTurn={myTurn && p.canAct} idleSince={p.idleSince} onClick={p.onEndTurn} />

      {p.hints && <div className="battle-hint">{hintText(view, me, p.legal, p.selected?.uid ?? null, p.canAct, p.busy)}</div>}

      {/* くりだし・準備の案内 */}
      {view.phase === 'promote' && view.pendingPromote.includes(me) && p.canAct && (
        <div className="battle-prompt">ベンチから くりだす おてあげを えらんでね</div>
      )}
      {view.phase === 'setup' && p.canAct && myPs.setupChoice === null && (
        <div className="battle-prompt">バトルばに だす おてあげを えらんでね</div>
      )}
      {view.phase === 'setup' && myPs.setupChoice !== null && oppPs.setupChoice === null && (
        <div className="battle-prompt battle-prompt--wait">あいてが えらぶのを まってるよ…</div>
      )}

      {/* ログ（余白メモ） */}
      {p.logOpen && (
        <div className="battle-log">
          <div className="battle-log__title">📝 メモ</div>
          <ul className="battle-log__list">
            {p.logLines.map((l, i) => (
              <li key={p.logLines.length - i}>{l}</li>
            ))}
          </ul>
        </div>
      )}

      {/* 選んだカードの拡大表示（小さい画面だけ CSS で出す） */}
      {p.selected && view.cards[p.selected.uid] && (
        <div className="battle-preview" aria-hidden>
          <BattleCard
            def={view.cardDefs[view.cards[p.selected.uid].no]}
            card={view.cards[p.selected.uid]}
            size="hand"
            view={view}
            onField={myPs.bench.includes(p.selected.uid)}
          />
        </div>
      )}

      {/* ドラッグ中のカード */}
      {drag && (
        <div className="battle-ghost" style={{ left: drag.x - drag.w / 2, top: drag.y - drag.h / 2, width: drag.w, height: drag.h }}>
          {(() => {
            const card = view.cards[drag.uid];
            const def = view.cardDefs[card.no];
            const size = myPs.bench.includes(drag.uid) ? 'bench' : 'hand';
            return <BattleCard def={def} card={card} size={size} view={view} onField={size === 'bench'} selected />;
          })()}
        </div>
      )}
    </div>
  );
}

/** ターンおわりボタン。10秒操作が無いと軽く揺れて促す（SPEC §9-3） */
function EndTurnButton({ label, active, myTurn, idleSince, onClick }: { label: ReactNode; active: boolean; myTurn: boolean; idleSince: number; onClick: () => void }) {
  const [nudge, setNudge] = useState(false);
  useEffect(() => {
    setNudge(false);
    if (!myTurn) return;
    const id = window.setTimeout(() => setNudge(true), 10000);
    return () => window.clearTimeout(id);
  }, [myTurn, idleSince]);
  return (
    <div className={`battle-end ${nudge ? 'is-nudge' : ''}`}>
      <RoughButton seed="end-turn" className="battle-end__btn" disabled={!active} highlight={active} strokeWidth={3} onClick={onClick} onDisabledClick={onClick}>
        {label}
      </RoughButton>
    </div>
  );
}
