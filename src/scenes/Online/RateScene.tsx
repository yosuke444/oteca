import { useEffect, useRef, useState } from 'react';
import { audio } from '../../audio/audioManager';
import { badOnlineStart, onlineSetup } from '../../battle/setup';
import { t } from '../../i18n';
import { useT } from '../../i18n/useT';
import { type OnlineLink, createRateLobby, currentOnline, endOnline, startOnline } from '../../net/online';
import type { RateLobby, RatePaired } from '../../net/rateLobby';
import { safeName, startRateMatch } from '../../online/rate';
import { isDebugMode, useNav } from '../../router';
import { usableDecks } from '../../save/collection';
import { useSave } from '../../state/SaveContext';
import { DeckPickerDialog } from '../../ui/deck/DeckPicker';
import { RoughBox } from '../../ui/rough/RoughBox';
import { RoughButton } from '../../ui/rough/RoughButton';
import './online.css';

/** リザルトの「つぎの しあいへ」から来た時は、すぐ さがす */
export type RatePayload = { autoSearch?: boolean } | null;

type Phase = { kind: 'idle' } | { kind: 'searching' } | { kind: 'vs'; opp: RatePaired } | { kind: 'error'; text: string };

/** VS 画面を出す時間 */
const VS_MS = 2000;
/** 相手が決まってから、この時間たっても対戦が始まらなければ さがし直す */
const START_TIMEOUT_MS = 20000;

/**
 * S15 レートたいせん（v2.0-G。UPDATE_v2 §8-4・SPEC §7 S15）
 * デッキ → 「さがす」（待合所）→ 相手が決まったら2人だけの部屋へ移って VS → 対戦。
 */
export function RateScene() {
  const { go, payload } = useNav();
  const { save, update } = useSave();
  const tr = useT();
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [count, setCount] = useState(1);
  const [dots, setDots] = useState(0);
  const [picking, setPicking] = useState(false);
  const lobbyRef = useRef<RateLobby | null>(null);
  const linkRef = useRef<OnlineLink | null>(null);
  const toBattle = useRef(false);
  const vsDone = useRef(false);
  const deckOk = usableDecks(save)[save.selectedDeck];
  const deck = save.decks[save.selectedDeck];

  const linkOffs = useRef<(() => void)[]>([]);
  const offLink = () => {
    for (const f of linkOffs.current) f();
    linkOffs.current = [];
  };
  const saveRef = useRef(save);
  saveRef.current = save;
  const stopLobby = () => {
    lobbyRef.current?.leave();
    lobbyRef.current = null;
  };

  const tryGo = () => {
    const link = linkRef.current;
    const g = link?.lastStart;
    if (!vsDone.current || !g || toBattle.current || !link) return;
    if (badOnlineStart(g)) {
      endOnline();
      setPhase({ kind: 'error', text: t().lobby.cheat });
      return;
    }
    const oppRate = g.oppRate ?? (phase.kind === 'vs' ? phase.opp.opponentRate : save.rate);
    // 試合が始まる：「レート対戦中」の印（ページを閉じたら次に開いた時に負け）と、直前の相手を保存
    update((d) => startRateMatch(d, g.oppPlayerId, oppRate));
    toBattle.current = true;
    offLink();
    go('battle', onlineSetup(g, isDebugMode(), { oppRate, oppId: g.oppPlayerId }));
  };

  const search = () => {
    if (!deckOk || lobbyRef.current) return;
    endOnline();
    const lobby = createRateLobby({ playerId: save.playerId, name: save.playerName, rate: save.rate, lastOpponentId: save.lastRateOpponentId });
    lobbyRef.current = lobby;
    lobby.onWaiting = setCount;
    lobby.onPaired = (p) => {
      stopLobby();
      audio.play('se_match_found');
      vsDone.current = false;
      // 2人だけの部屋へ移る（2人の部屋と同じ流れで、自動で始まる）
      const cur = saveRef.current;
      const d = cur.decks[cur.selectedDeck];
      const link = startOnline({ kind: 'rate', roomId: p.roomId }, { name: cur.playerName, deck: d.cards, deckName: d.name, rate: cur.rate, playerId: cur.playerId });
      linkRef.current = link;
      // 聞き取りは、対戦へ進む時・画面を出る時に外す（リザルトで相手が出ていった時に、裏で さがし直さないように）
      offLink();
      linkOffs.current = [
        link.on('start', () => tryGoRef.current()),
        link.on('status', (s) => {
          if (toBattle.current || mounted.current === 0) return;
          if (s.kind === 'version' || s.kind === 'error' || s.kind === 'aborted' || s.kind === 'full') {
            offLink();
            endOnline();
            linkRef.current = null;
            setPhase({ kind: 'searching' });
            searchRef.current();
          }
        }),
      ];
      setPhase({ kind: 'vs', opp: p });
    };
    lobby.join();
    setPhase({ kind: 'searching' });
  };
  const tryGoRef = useRef(tryGo);
  tryGoRef.current = tryGo;
  const searchRef = useRef(search);
  searchRef.current = search;

  const stop = () => {
    stopLobby();
    endOnline();
    linkRef.current = null;
    setPhase({ kind: 'idle' });
  };

  // つぎの しあいへ：すぐ さがす（StrictMode で2回呼ばれても、待合所には1回だけ入る）
  useEffect(() => {
    if ((payload as RatePayload)?.autoSearch && deckOk && !lobbyRef.current) search();
  }, []);

  // VS（2秒）→ 種が決まっていれば対戦へ。しばらく始まらなければ さがし直す
  useEffect(() => {
    if (phase.kind !== 'vs') return;
    const id = window.setTimeout(() => {
      vsDone.current = true;
      tryGoRef.current();
    }, VS_MS);
    const giveUp = window.setTimeout(() => {
      if (toBattle.current) return;
      endOnline();
      linkRef.current = null;
      searchRef.current();
    }, START_TIMEOUT_MS);
    return () => {
      window.clearTimeout(id);
      window.clearTimeout(giveUp);
    };
  }, [phase]);

  useEffect(() => {
    if (phase.kind !== 'searching') return;
    const id = window.setInterval(() => setDots((d) => (d + 1) % 4), 600);
    return () => window.clearInterval(id);
  }, [phase.kind]);

  // 画面を出る時（対戦へ進む時以外）は待合所・部屋を出る（StrictMode の作り直しでは出ない）
  const mounted = useRef(0);
  useEffect(() => {
    mounted.current += 1;
    return () => {
      mounted.current -= 1;
      window.setTimeout(() => {
        if (mounted.current !== 0) return;
        offLink();
        stopLobby();
        if (!toBattle.current && linkRef.current && currentOnline() === linkRef.current) endOnline();
      }, 0);
    };
  }, []);

  if (phase.kind === 'vs') {
    const opp = phase.opp;
    return (
      <div className="lobby lobby--vs rate-vs" data-testid="vs">
        <div className="lobby-vs__side lobby-vs__side--me">
          <span className="lobby-vs__who pencil">{tr.common.me}</span>
          <span className="lobby-vs__name blue-pen">{save.playerName}</span>
          <span className="rate-vs__rate num">{tr.rate.vsRate(save.rate)}</span>
        </div>
        <div className="lobby-vs__vs">VS</div>
        <div className="lobby-vs__side lobby-vs__side--opp">
          <span className="lobby-vs__who pencil">{tr.common.opp}</span>
          <span className="lobby-vs__name red-pen">{safeName(opp.opponentName, tr.lobby.nameless)}</span>
          <span className="rate-vs__rate num">{tr.rate.vsRate(opp.opponentRate)}</span>
        </div>
        <p className="rate-vs__warn red-pen">{tr.rate.leaveWarn}</p>
      </div>
    );
  }

  return (
    <div className="rate-scene" data-testid="rate-scene">
      <h1 className="online-scene__title">{tr.rate.title}</h1>
      <RoughButton seed="rate-back" className="online-scene__back" onClick={() => (phase.kind === 'searching' ? stop() : go('online'))}>
        {tr.common.back}
      </RoughButton>
      <RoughBox seed="rate-panel" className="rate-scene__panel" paper radius={12}>
        <p className="rate-scene__rate num">{tr.online.myRate(save.rate)}</p>
        <p className={`rate-scene__deck ${deckOk ? '' : 'red-pen'}`}>{deckOk ? tr.result.myDeck(deck.name) : tr.story.badDeck}</p>
        <RoughButton seed="rate-deck" className="rate-scene__deck-btn" onClick={() => setPicking(true)} data-testid="rate-change-deck">
          {tr.lobby.changeDeck}
        </RoughButton>
        {phase.kind === 'searching' ? (
          <div className="rate-scene__searching" data-testid="rate-searching">
            <p className="rate-scene__search-text">
              {tr.rate.searching}
              <span className="lobby-wait__dots">{tr.lobby.dot.repeat(dots)}</span>
            </p>
            <p className="rate-scene__count blue-pen" data-testid="rate-count">
              {tr.rate.waitingCount(count)}
            </p>
            <RoughButton seed="rate-stop" className="rate-scene__go" onClick={stop}>
              {tr.rate.stop}
            </RoughButton>
          </div>
        ) : (
          <RoughButton seed="rate-go" className="rate-scene__go" highlight={deckOk} disabled={!deckOk} strokeWidth={3} onClick={search} data-testid="rate-search">
            {tr.rate.search}
          </RoughButton>
        )}
        <p className="rate-scene__note pencil">{tr.rate.note}</p>
      </RoughBox>
      {phase.kind === 'error' && <p className="rate-scene__error red-pen">{phase.text}</p>}
      {picking && (
        <DeckPickerDialog
          save={save}
          current={save.selectedDeck}
          mode="battle"
          title={tr.lobby.changeDeck}
          onPick={(i) => {
            update((d) => void (d.selectedDeck = i));
            setPicking(false);
          }}
          onClose={() => setPicking(false)}
        />
      )}
    </div>
  );
}
