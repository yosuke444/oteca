import { useEffect, useRef, useState } from 'react';
import { audio } from '../../audio/audioManager';
import { badOnlineStart, onlineSetup } from '../../battle/setup';
import { t } from '../../i18n';
import { useT } from '../../i18n/useT';
import { features } from '../../config/features';
import type { RateSearch } from '../../net/matchmaker';
import { type OnlineLink, createRateSearch, currentOnline, endOnline, startOnline } from '../../net/online';
import type { RatePaired } from '../../net/rateLobby';
import { safeName, startRateMatch } from '../../online/rate';
import { type Identity, ensureIdentity, syncRanking } from '../../online/rankingApi';
import { queueReport } from '../../online/ranking';
import { RateValue } from '../../ui/common/RateValue';
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
 * デッキ → 「さがす」（受付係。つながらなければ予備の待合所）→ 相手が決まったら2人だけの部屋へ移って VS → 対戦。
 */
export function RateScene() {
  const { go, payload } = useNav();
  const { save, update } = useSave();
  const tr = useT();
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [count, setCount] = useState(1);
  const [dots, setDots] = useState(0);
  const [picking, setPicking] = useState(false);
  /** 予備の待合所で さがしている（「いまは こみあっているので…」） */
  const [fallback, setFallback] = useState(false);
  const lobbyRef = useRef<RateSearch | null>(null);
  /** 決まった相手（試合ID を報告に使う） */
  const pairedRef = useRef<RatePaired | null>(null);
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
    // 試合ID は、組んだ相手と同じ人と始まった時だけ使う（違う人なら報告しない）
    const p = pairedRef.current;
    const matchId = p && p.opponentId === g.oppPlayerId ? p.matchId : undefined;
    go('battle', onlineSetup(g, isDebugMode(), { oppRate, oppId: g.oppPlayerId, ...(matchId ? { matchId } : {}) }));
  };

  /**
   * 組んだのに対戦が始まらなかった（部屋につながらない・相手が来ない）：その試合は「無効」と報告しておく
   * （来なかった相手が1人で「勝ち」を報告しても、食い違いで記録されないように）
   */
  const abandonPair = () => {
    const p = pairedRef.current;
    pairedRef.current = null;
    if (!p || toBattle.current || !features.ranking) return;
    update((d) => queueReport(d, { matchId: p.matchId, winner: 'void' }));
  };
  const abandonRef = useRef(abandonPair);
  abandonRef.current = abandonPair;
  /** 「さがす」を押している（token をもらう間に「やめる」を押したら、さがさない） */
  const wantSearch = useRef(false);

  const search = () => {
    if (!deckOk || lobbyRef.current || wantSearch.current) return;
    endOnline();
    setFallback(false);
    setPhase({ kind: 'searching' });
    wantSearch.current = true;
    // 初めてのレート対戦：受付係に並ぶ・結果を報告するための token をもらう（もらえなければ予備の待合所で遊べる）
    const start = (id: Identity | null) => {
      if (!wantSearch.current || lobbyRef.current) return;
      wantSearch.current = false;
      const cur = saveRef.current;
      // 相手の判別はユーザーID（v2.0-J）
      const userId = id?.userId ?? cur.userId;
      const lobby = createRateSearch({ userId, name: cur.playerName, rate: cur.rate, lastOpponentId: cur.lastRateOpponentId, token: id?.token ?? '' });
      lobbyRef.current = lobby;
      lobby.onWaiting = setCount;
      lobby.onFallback = () => setFallback(true);
      lobby.onReplaced = () => stopRef.current();
      lobby.onPaired = onPaired;
      lobby.join();
    };
    if (features.ranking) void ensureIdentity(saveRef.current, update).then(start);
    else start(null);
  };
  const onPaired = (p: RatePaired) => {
    {
      stopLobby();
      pairedRef.current = p;
      audio.play('se_match_found');
      vsDone.current = false;
      // 2人だけの部屋へ移る（2人の部屋と同じ流れで、自動で始まる）
      const cur = saveRef.current;
      const d = cur.decks[cur.selectedDeck];
      const link = startOnline({ kind: 'rate', roomId: p.roomId }, { name: cur.playerName, deck: d.cards, deckName: d.name, rate: cur.rate, playerId: cur.userId });
      linkRef.current = link;
      // 聞き取りは、対戦へ進む時・画面を出る時に外す（リザルトで相手が出ていった時に、裏で さがし直さないように）
      offLink();
      linkOffs.current = [
        link.on('start', () => tryGoRef.current()),
        link.on('status', (s) => {
          if (toBattle.current || mounted.current === 0) return;
          if (s.kind === 'version' || s.kind === 'error' || s.kind === 'aborted' || s.kind === 'full') {
            abandonRef.current();
            offLink();
            endOnline();
            linkRef.current = null;
            setPhase({ kind: 'searching' });
            searchRef.current();
          }
        }),
      ];
      setPhase({ kind: 'vs', opp: p });
    }
  };
  const tryGoRef = useRef(tryGo);
  tryGoRef.current = tryGo;
  const searchRef = useRef(search);
  searchRef.current = search;
  const stopRef = useRef<() => void>(() => {});

  const stop = () => {
    wantSearch.current = false;
    stopLobby();
    setFallback(false);
    endOnline();
    linkRef.current = null;
    setPhase({ kind: 'idle' });
  };
  stopRef.current = stop;

  // 次の更新の後なら、正式なレートで上書きしておく（送れなかった報告も送る）
  useEffect(() => {
    if (features.ranking) void syncRanking(() => saveRef.current, update);
  }, []);

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
      abandonRef.current();
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
        wantSearch.current = false;
        // VS のまま画面を出た（対戦が始まらなかった）
        if (!toBattle.current) abandonRef.current();
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
          <span className="rate-vs__rate num">
            <RateValue value={save.rate} provisional={save.ranking.provisional} format={tr.rate.vsRate} />
          </span>
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
        <p className="rate-scene__rate num">
          <RateValue value={save.rate} provisional={save.ranking.provisional} format={tr.online.myRate} />
        </p>
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
            {fallback && (
              <p className="rate-scene__busy pencil" data-testid="rate-fallback">
                {tr.rate.busy}
              </p>
            )}
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
