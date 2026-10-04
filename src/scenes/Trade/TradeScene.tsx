import { gsap } from 'gsap';
import { useEffect, useRef, useState } from 'react';
import { SuspensionGate } from '../../ui/common/SuspensionGate';
import { opponentAllowed } from '../../online/status';
import { flushSync } from 'react-dom';
import { audio } from '../../audio/audioManager';
import { CARD_DB } from '../../data/cards';
import { useFx } from '../../fx/fxSettings';
import { bigText, confetti, confettiRain, flash } from '../../fx/paperFx';
import { setFxSpeed } from '../../fx/timing';
import { useT } from '../../i18n/useT';
import { isValidRoomNumber } from '../../net/protocol';
import { createTradeSession } from '../../net/online';
import type { TradeSession, TradeView } from '../../net/tradeSession';
import { safeName } from '../../online/rate';
import { useNav } from '../../router';
import { useSave } from '../../state/SaveContext';
import { loadPendingTrade, savePendingTrade } from '../../trade/pendingStore';
import { type Offer, TRADE_MAX_CARDS, TRADE_MAX_KINDS, applyTrade, brokenDecks, canAdd, canonical, offerFits, offerSize } from '../../trade/trade';
import { CardMini } from '../../ui/card/CardMini';
import { Dialog } from '../../ui/common/Dialog';
import { NumberPad } from '../../ui/common/NumberPad';
import { RoughBox } from '../../ui/rough/RoughBox';
import { RoughButton } from '../../ui/rough/RoughButton';
import { ModeGuide } from '../../ui/guide/ModeGuide';
import './trade.css';

const MIN_DIGITS = 4;
const MAX_DIGITS = 8;

type Phase = 'input' | 'room' | 'error';

/**
 * S16 カードトレード（v2.0-H。UPDATE_v2 §9・SPEC §7 S16）
 * 部屋番号 → 2人そろうと トレード画面 → あげるカードを選ぶ → これで OK（両者）→ こうかんする（最終確認・両者）→ 交換。
 * 交換の保存（カードの増減と交換ID）は1回で。同じ交換IDは二度処理しない。
 */
export function TradeScene() {
  const { go } = useNav();
  const { save, update } = useSave();
  const tr = useT();
  const fx = useFx();
  const [room, setRoom] = useState(() => loadPendingTrade()?.room ?? '');
  const [phase, setPhase] = useState<Phase>('input');
  const [error, setError] = useState('');
  const [view, setView] = useState<TradeView | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [note, setNote] = useState<{ text: string; n: number } | null>(null);
  const [dots, setDots] = useState(0);
  const sessionRef = useRef<TradeSession | null>(null);
  const saveRef = useRef(save);
  saveRef.current = save;
  const tableRef = useRef<HTMLDivElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  const say = (text: string) => setNote((x) => ({ text, n: (x?.n ?? 0) + 1 }));

  useEffect(() => setFxSpeed(fx.speed), [fx.speed]);
  // 確認の画面を出している間に相手が内容を変えた（ロックが外れた）：閉じて知らせる
  useEffect(() => {
    if (confirm && view && !(view.myLock && view.oppLock)) {
      setConfirm(false);
      say(tr.trade.changed);
    }
  }, [confirm, view?.myLock, view?.oppLock]);
  useEffect(() => {
    if (!note) return;
    const id = window.setTimeout(() => setNote(null), 3000);
    return () => window.clearTimeout(id);
  }, [note]);

  const leave = () => {
    sessionRef.current?.leave();
    sessionRef.current = null;
    setView(null);
  };

  // 相手のアカウントが停止中なら交換しない（v2.0-J。相手が来た時に確かめる。結果は10分覚えておく）
  const oppUserId = view?.oppUserId ?? '';
  // 相手の停止を確かめ終わるまでは「これで OK」・最終確認を通さない
  const [oppChecked, setOppChecked] = useState('');
  useEffect(() => {
    if (!oppUserId) return;
    let alive = true;
    void opponentAllowed(oppUserId).then((ok) => {
      if (alive && ok) setOppChecked(oppUserId);
      if (!alive || ok) return;
      leave();
      setError(tr.suspension.opponent);
      setPhase('error');
    });
    return () => {
      alive = false;
    };
  }, [oppUserId]);

  const join = () => {
    if (!isValidRoomNumber(room)) return;
    leave();
    const s = createTradeSession({
      name: save.playerName,
      playerId: save.playerId,
      userId: save.userId,
      doneIds: () => saveRef.current.trade.doneIds,
      pending: () => loadPendingTrade(),
      canGive: (o) => offerFits(saveRef.current, o),
    });
    sessionRef.current = s;
    s.onChange = (v) => {
      setView(v);
      if (v.status !== 'trading') setConfirm(false);
      if (v.status === 'full' || v.status === 'version' || v.status === 'error' || v.status === 'self') {
        setError(v.status === 'full' ? tr.trade.full : v.status === 'version' ? tr.trade.version : v.status === 'self' ? tr.trade.self : tr.trade.failed);
        setPhase('error');
        sessionRef.current = null;
      }
    };
    // 交換が成立した：カードの増減と交換IDを1回の保存で（すぐ保存する。この直後にページが閉じられても残るように）
    s.onExecute = (t) => {
      // 相手の側でも交換が成立しているので、所持数が足りなくなっていても持っている分で仕上げる（交換IDは記録する）
      flushSync(() => update((d) => void applyTrade(d, t.tradeId, t.give, t.get, { partial: true })));
      playSwap(t.give, t.get);
    };
    s.onPending = (p) => savePendingTrade(p);
    s.onLeft = () => say(tr.trade.left);
    s.onResume = (decision, p) => {
      if (decision === 'apply') flushSync(() => update((d) => void applyTrade(d, p.tradeId, p.give, p.get, { partial: true })));
      savePendingTrade(null);
      say(decision === 'apply' ? tr.trade.resumed : tr.trade.dropped);
    };
    s.join(room);
    setPhase('room');
  };

  // 画面を出る時は部屋を出る（StrictMode の作り直しでは出ない）
  const mounted = useRef(0);
  useEffect(() => {
    mounted.current += 1;
    return () => {
      mounted.current -= 1;
      window.setTimeout(() => {
        if (mounted.current === 0) sessionRef.current?.leave();
      }, 0);
    };
  }, []);

  useEffect(() => {
    if (phase !== 'room' || view?.status === 'trading') return;
    const id = window.setInterval(() => setDots((d) => (d + 1) % 4), 600);
    return () => window.clearInterval(id);
  }, [phase, view?.status]);

  // PC のキーボードでも部屋番号を入れられる
  useEffect(() => {
    if (phase !== 'input') return;
    const onKey = (e: KeyboardEvent) => {
      if (/^[0-9]$/.test(e.key)) setRoom((r) => (r.length < MAX_DIGITS ? r + e.key : r));
      else if (e.key === 'Backspace') setRoom((r) => r.slice(0, -1));
      else if (e.key === 'Enter') join();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  /** 交換の演出（迷ったら3倍豪華に）：あげるカードが右へ、もらうカードが左へ飛んで入れ替わる → 光・紙吹雪・はんこ・ジングル */
  const playSwap = (give: Offer, get: Offer) => {
    const L = layerRef.current;
    const table = tableRef.current;
    audio.play('jingle_trade');
    if (!L || !table) return;
    const reduce = fx.reduceFx;
    const make = (o: Offer, from: number, to: number) =>
      canonical(o)
        .slice(0, 8)
        .forEach(([no], i) => {
          const el = document.createElement('div');
          el.className = 'trade-fly';
          el.textContent = CARD_DB[no].name;
          L.appendChild(el);
          gsap.set(el, { left: from, top: 180 + (i % 4) * 34, rotate: -8 + i * 3 });
          gsap.to(el, {
            left: to,
            top: 200 + ((i + 2) % 4) * 30,
            rotate: 360 + i * 20,
            duration: reduce ? 0.2 : 0.9,
            delay: reduce ? 0 : i * 0.06,
            ease: 'power2.inOut',
            onComplete: () => gsap.to(el, { opacity: 0, duration: 0.3, delay: 0.4, onComplete: () => el.remove() }),
          });
        });
    make(give, 220, 900);
    make(get, 900, 220);
    if (!reduce) {
      window.setTimeout(() => {
        if (!L.isConnected) return;
        flash(L, 0.8, 0.4);
        confetti(L, { x: 640, y: 260 }, 60, 1.2);
        confettiRain(L, 70);
      }, fx.dur(900));
    }
    window.setTimeout(() => {
      if (!L.isConnected) return;
      const off = bigText(L, { x: 640, y: 250 }, tr.trade.done, 'trade-stamp', -8);
      audio.play('se_stamp');
      window.setTimeout(off, fx.dur(1800));
      say(tr.trade.doneNote);
    }, fx.dur(reduce ? 200 : 1000));
  };

  const s = sessionRef.current;
  const v = view;
  const trading = phase === 'room' && v?.status === 'trading';
  const my = v?.myOffer ?? {};
  const opp = v?.oppOffer ?? {};
  const mySize = offerSize(my);
  const oppSize = offerSize(opp);
  // 「これで OK」の後でも内容は変えられる（変えると両者のロックが外れる）。最終確認を押した後は変えない
  const locked = !!v?.myCommit;

  const setCount = (no: number, n: number) => {
    if (!s || locked) return;
    const next = { ...my };
    if (n <= 0) delete next[no];
    else next[no] = n;
    s.setOffer(next);
  };
  const add = (no: number) => {
    if (locked) return;
    if (!canAdd(save, my, no)) {
      audio.play('se_error');
      say(tr.trade.cannotAdd);
      return;
    }
    audio.play('se_card_place');
    setCount(no, (my[no] ?? 0) + 1);
  };

  if (phase !== 'room') {
    return (
      <div className="trade-scene trade-scene--input" data-testid="trade-scene">
        <h1 className="trade-scene__title">{tr.trade.title}</h1>
        <RoughButton seed="trade-back" className="trade-scene__back" onClick={() => go('menu')}>
          {tr.common.back}
        </RoughButton>
        <ModeGuide mode="trade" className="trade-scene__guide" />
        <section className="trade-input">
          <p className="trade-input__label">{tr.trade.roomInput}</p>
          <RoughBox seed="trade-num" className="trade-input__num" paper radius={10} strokeWidth={3}>
            <span className="trade-input__digits num" data-testid="trade-room-input">
              {room || ' '}
            </span>
          </RoughBox>
          <NumberPad value={room} maxLength={MAX_DIGITS} onChange={setRoom} className="trade-input__pad" />
        </section>
        <section className="trade-input__side">
          <RoughButton seed="trade-join" className="trade-input__join" strokeWidth={3} highlight={isValidRoomNumber(room)} disabled={!isValidRoomNumber(room)} onClick={join} data-testid="trade-join">
            {tr.trade.enter}
          </RoughButton>
          <p className="trade-input__note pencil">{tr.trade.note}</p>
          {room.length > 0 && room.length < MIN_DIGITS && <p className="red-pen">{tr.lobby.moreDigits(MIN_DIGITS - room.length)}</p>}
          {loadPendingTrade() && <p className="trade-input__pending red-pen">{tr.trade.pendingNote(loadPendingTrade()!.room)}</p>}
        </section>
        {phase === 'error' && (
          <Dialog
            seed="trade-error"
            onClose={() => setPhase('input')}
            actions={
              <RoughButton seed="trade-error-ok" onClick={() => setPhase('input')}>
                {tr.common.ok}
              </RoughButton>
            }
          >
            <p className="red-pen">{error}</p>
          </Dialog>
        )}
      </div>
    );
  }

  const giveList = canonical(my);
  const getList = canonical(opp);
  const owned = Object.keys(save.collection)
    .map(Number)
    .filter((no) => CARD_DB[no] && (save.collection[no] ?? 0) > 0)
    .sort((a, b) => a - b);
  const warnings = confirm ? brokenDecks(save, my, opp) : [];


  return (
    <div className="trade-scene" data-testid="trade-scene" ref={tableRef}>
      {/* アカウント停止の確かめ（v2.0-J） */}
      <SuspensionGate />
      <h1 className="trade-scene__title">{tr.trade.title}</h1>
      <p className="trade-scene__room num">{tr.trade.room(room)}</p>
      {trading && (
        <p className="trade-scene__opp" data-testid="trade-opp">
          {tr.trade.opp(safeName(v!.oppName, tr.lobby.nameless))}
        </p>
      )}
      <RoughButton
        seed="trade-quit"
        className="trade-scene__back"
        onClick={() => {
          leave();
          setPhase('input');
        }}
        data-testid="trade-quit"
      >
        {tr.trade.quit}
      </RoughButton>

      {!trading ? (
        <div className="trade-wait" data-testid="trade-waiting">
          <p className="trade-wait__text">
            {tr.trade.waiting}
            <span className="lobby-wait__dots">{tr.lobby.dot.repeat(dots)}</span>
          </p>
        </div>
      ) : (
        <>
          <RoughBox seed="trade-give" className={`trade-panel trade-panel--give ${v!.myLock ? 'is-locked' : ''}`} paper radius={10} stroke={v!.myLock ? 'var(--pen-green)' : undefined} strokeWidth={v!.myLock ? 3.4 : 2.4}>
            <h2 className="trade-panel__title">{tr.trade.give}</h2>
            <div className="trade-panel__cards" data-testid="trade-give">
              {giveList.length === 0 && <p className="trade-panel__empty pencil">{tr.trade.nothing}</p>}
              {giveList.map(([no, n]) => (
                <div key={no} className="trade-item">
                  <CardMini def={CARD_DB[no]} seed={`give-${no}`} variant="slot" count={n} />
                  {!locked && (
                    <span className="trade-item__btns">
                      <button type="button" className="trade-item__btn" aria-label={tr.trade.minus} onClick={() => setCount(no, n - 1)} data-testid={`give-minus-${no}`}>
                        −
                      </button>
                      <button type="button" className="trade-item__btn" aria-label={tr.trade.plus} onClick={() => add(no)} data-testid={`give-plus-${no}`}>
                        +
                      </button>
                    </span>
                  )}
                </div>
              ))}
            </div>
            <div className="trade-panel__foot">
              <span className="trade-panel__size" data-testid="trade-give-size">
                {tr.trade.size(mySize.kinds, mySize.cards)}
                <small className="pencil">{tr.trade.max(TRADE_MAX_KINDS, TRADE_MAX_CARDS)}</small>
              </span>
              {!v!.myCommit && (
                <RoughButton
                  seed="trade-ok"
                  className="trade-panel__ok"
                  highlight={!v!.myLock}
                  onClick={() => {
                    if (oppUserId && oppChecked !== oppUserId) return say(tr.suspension.checking);
                    if (!s?.setLock(!v!.myLock)) say(mySize.cards + oppSize.cards === 0 ? tr.trade.empty : tr.trade.notEnough);
                  }}
                  data-testid="trade-ok"
                >
                  {v!.myLock ? tr.trade.unok : tr.trade.ok}
                </RoughButton>
              )}
            </div>
          </RoughBox>

          <RoughBox seed="trade-get" className={`trade-panel trade-panel--get ${v!.oppLock ? 'is-locked' : ''}`} paper radius={10} stroke={v!.oppLock ? 'var(--pen-green)' : undefined} strokeWidth={v!.oppLock ? 3.4 : 2.4}>
            <h2 className="trade-panel__title">{tr.trade.get}</h2>
            <div className="trade-panel__cards" data-testid="trade-get">
              {getList.length === 0 && <p className="trade-panel__empty pencil">{tr.trade.nothing}</p>}
              {getList.map(([no, n]) => (
                <div key={no} className="trade-item">
                  <CardMini def={CARD_DB[no]} seed={`get-${no}`} variant="slot" count={n} />
                </div>
              ))}
            </div>
            <div className="trade-panel__foot">
              <span className="trade-panel__size">{tr.trade.size(oppSize.kinds, oppSize.cards)}</span>
              {v!.oppLock && (
                <span className="trade-panel__mark blue-pen" data-testid="trade-opp-ok">
                  {tr.trade.okMark}
                </span>
              )}
            </div>
          </RoughBox>

          {v!.myLock && v!.oppLock && !v!.myCommit && (
            <RoughButton
              seed="trade-go"
              className="trade-scene__go"
              highlight
              strokeWidth={3.4}
              onClick={() => {
                // 別の相手との とちゅうの交換が残っている間は、新しい交換をしない（記録が上書きされないように）
                const p = loadPendingTrade();
                if (p && p.oppPlayerId !== v!.oppPlayerId) {
                  say(tr.trade.pendingNote(p.room));
                  return;
                }
                setConfirm(true);
              }}
              data-testid="trade-go"
            >
              {tr.trade.trade}
            </RoughButton>
          )}
          {v!.myCommit && (
            <p className="trade-scene__waitopp blue-pen" data-testid="trade-wait-opp">
              {tr.trade.waitOpp}
            </p>
          )}

          <RoughBox seed="trade-mine" className="trade-mine" paper radius={10}>
            <h2 className="trade-panel__title">{tr.trade.mine}</h2>
            <div className="trade-mine__grid">
              {owned.map((no) => {
                const left = (save.collection[no] ?? 0) - (my[no] ?? 0);
                return (
                  <div key={no} className="trade-mine__item" data-testid={`trade-mine-${no}`}>
                    <CardMini def={CARD_DB[no]} seed={`mine-${no}`} variant="slot" owned={left} dim={locked || left <= 0} onTap={() => add(no)} />
                  </div>
                );
              })}
            </div>
          </RoughBox>
        </>
      )}

      {confirm && trading && (
        <Dialog
          seed="trade-confirm"
          title={tr.trade.confirmTitle}
          width={820}
          onClose={() => setConfirm(false)}
          actions={
            <>
              <RoughButton seed="trade-confirm-no" onClick={() => setConfirm(false)} data-testid="trade-confirm-no">
                {tr.common.cancel}
              </RoughButton>
              <RoughButton
                seed="trade-confirm-yes"
                highlight
                onClick={() => {
                  setConfirm(false);
                  if (oppUserId && oppChecked !== oppUserId) return say(tr.suspension.checking);
                  if (!s?.commit()) say(tr.trade.changed);
                }}
                data-testid="trade-confirm-yes"
              >
                {tr.trade.confirmYes}
              </RoughButton>
            </>
          }
        >
          <div className="trade-confirm" data-testid="trade-confirm">
            <div>
              <h3>{tr.trade.confirmGive}</h3>
              <ul>{giveList.length ? giveList.map(([no, n]) => <li key={no}>{`${CARD_DB[no].name} ×${n}`}</li>) : <li className="pencil">{tr.trade.nothing}</li>}</ul>
            </div>
            <div>
              <h3>{tr.trade.confirmGet}</h3>
              <ul>{getList.length ? getList.map(([no, n]) => <li key={no}>{`${CARD_DB[no].name} ×${n}`}</li>) : <li className="pencil">{tr.trade.nothing}</li>}</ul>
            </div>
          </div>
          {getList.length === 0 && (
            <p className="trade-confirm__warn red-pen" data-testid="trade-zero-warn">
              {tr.trade.zeroGet}
            </p>
          )}
          {warnings.map((name) => (
            <p key={name} className="trade-confirm__warn red-pen" data-testid="trade-deck-warn">
              {tr.trade.broken(name)}
            </p>
          ))}
        </Dialog>
      )}

      {note && (
        <div key={note.n} className="lobby-room__note" role="status" data-testid="trade-note">
          {note.text}
        </div>
      )}
      <div className="trade-scene__layer" ref={layerRef} aria-hidden />
    </div>
  );
}
