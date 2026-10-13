import { useEffect, useRef, useState } from 'react';
import { markStart } from '../../net/startTiming';
import { useFx, vsDur } from '../../fx/fxSettings';
import { preloadCards } from '../../ui/imageLoader';
import { t } from '../../i18n';
import { SuspensionGate } from '../../ui/common/SuspensionGate';
import { opponentAllowed } from '../../online/status';
import { useT } from '../../i18n/useT';
import { badOnlineStart, onlineSetup } from '../../battle/setup';
import { usableDecks } from '../../save/collection';
import { DeckChooser } from '../../ui/deck/DeckPicker';
import { audio } from '../../audio/audioManager';
import { isValidRoomNumber } from '../../net/protocol';
import { type OnlineLink, currentOnline, endOnline, startOnline } from '../../net/online';
import { type InviteState, ROOM_MAX, type RoomMember, type SessionStatus } from '../../net/session';
import { safeName } from '../../online/rate';
import { Dialog } from '../../ui/common/Dialog';
import { DeckPickerDialog } from '../../ui/deck/DeckPicker';
import { isDebugMode, useNav } from '../../router';
import { useSave } from '../../state/SaveContext';
import { NumberPad } from '../../ui/common/NumberPad';
import { RoughBox } from '../../ui/rough/RoughBox';
import { RoughButton } from '../../ui/rough/RoughButton';
import { tiltStyle } from '../../ui/rough/seed';
import './lobby.css';

type Phase =
  | { kind: 'input' }
  | { kind: 'waiting' }
  /** 「あいてが きた！」 */
  | { kind: 'found'; opp: string }
  /** VS 画面（2秒） */
  | { kind: 'vs'; opp: string }
  | { kind: 'error'; text: string };

/** VS 画面を出す時間（SPEC §7 S03。v2.7 で 2000 → 1400。演出スピードに合わせる） */
const VS_MS = 1400;
/** 「あいてが きた！」を出す時間（v2.7 で 1000 → 600。演出スピードに合わせる） */
const FOUND_MS = 600;
/** 相手が見つかってから、この時間がたっても対戦が始まらなければ「つながらなかった」 */
const START_TIMEOUT_MS = 20000;
/** この時間たっても相手が来なければ、番号の確認をうながす（SPEC §7 S03） */
const HINT_AFTER_MS = 60000;

const MIN_DIGITS = 4;
const MAX_DIGITS = 8;

/** 通信の状態 → エラー文（SPEC §7 S03 のエラー表示） */
function errorText(s: SessionStatus): string | null {
  switch (s.kind) {
    case 'full':
      return t().lobby.full;
    case 'version':
      return t().lobby.version;
    case 'error':
      return t().lobby.failed;
    case 'aborted':
      return s.reason === 'cheat' ? t().lobby.cheat : t().lobby.oppQuit;
    default:
      return null;
  }
}

/** リザルトの「ほかの ひとと あそぶ」から戻る時（いまの部屋の通信のまま、へやの なかま を出す。v2.0-G） */
export type LobbyPayload = { backToRoom?: boolean; oppCut?: boolean } | null;

/** S03 フレンド対戦ロビー（SPEC §7。v2.0-G：へやの なかま） */
export function LobbyScene() {
  const { go, payload } = useNav();
  const back = (payload as LobbyPayload)?.backToRoom ? currentOnline() : null;
  const { save, update } = useSave();
  const tr = useT();
  const fx = useFx();
  /** 相手の停止の確認（種が決まったらすぐ始める。VS の間に済ませておく。v2.7） */
  const allowedRef = useRef<{ game: number; opp: string; ok: Promise<boolean> } | null>(null);
  const usable = usableDecks(save)
    .map((ok, i) => ({ ok, i }))
    .filter((u) => u.ok);
  const [room, setRoom] = useState(back?.roomNumber ?? '');
  const [deck, setDeck] = useState(usable.some((u) => u.i === save.selectedDeck) ? save.selectedDeck : (usable[0]?.i ?? -1));
  const [phase, setPhase] = useState<Phase>(back ? { kind: 'waiting' } : { kind: 'input' });
  const [waitedMs, setWaitedMs] = useState(0);
  const [dots, setDots] = useState(0);
  const linkRef = useRef<OnlineLink | null>(back);
  const [link, setLink] = useState<OnlineLink | null>(back);
  const [members, setMembers] = useState<RoomMember[]>(back?.members ?? []);
  const [invite, setInvite] = useState<InviteState>(back?.session.invite ?? { kind: 'none' });
  const [note, setNote] = useState<{ text: string; n: number } | null>(null);
  const [picking, setPicking] = useState(false);
  const say = (text: string) => setNote((x) => ({ text, n: (x?.n ?? 0) + 1 }));
  // 対戦が始まる前に相手の通信が切れて戻ってきた（v2.4）
  useEffect(() => {
    if (!(payload as LobbyPayload)?.oppCut) return;
    // 部屋に残っていれば まちあい の画面で一言、部屋の通信が終わっていれば部屋番号の画面でお知らせ
    if (back) say(t().lobby.oppCut);
    else setPhase({ kind: 'error', text: t().lobby.oppCut });
  }, []);
  /** 対戦画面へ進んだ（画面を出ても通信は切らない） */
  const toBattle = useRef(false);
  const vsDone = useRef(false);

  const canJoin = isValidRoomNumber(room) && deck >= 0;

  const fail = (text: string) => {
    endOnline();
    linkRef.current = null;
    setLink(null);
    setPhase({ kind: 'error', text });
  };

  /** VS 画面が終わっていて、種も決まっていれば対戦へ */
  const tryGo = () => {
    const g = linkRef.current?.lastStart;
    if (!vsDone.current || !g || toBattle.current) return;
    if (badOnlineStart(g)) {
      fail(t().lobby.cheat);
      return;
    }
    toBattle.current = true;
    // 相手のアカウントが停止中なら始めない（v2.0-J。結果は10分覚えておく）
    const allowed = allowedRef.current?.game === g.game && allowedRef.current.opp === (g.oppUserId ?? '') ? allowedRef.current.ok : opponentAllowed(g.oppUserId);
    void allowed.then((ok) => {
      markStart('allowed');
      if (ok) go('battle', onlineSetup(g, isDebugMode()));
      else fail(t().suspension.opponent);
    });
  };

  const join = () => {
    if (!canJoin) return;
    vsDone.current = false;
    setWaitedMs(0);
    const l = startOnline({ kind: 'friend', roomNumber: room }, { name: save.playerName, deck: save.decks[deck].cards, deckName: save.decks[deck].name, userId: save.userId });
    linkRef.current = l;
    setLink(l);
    setPhase({ kind: 'waiting' });
  };

  const cancel = () => {
    endOnline();
    linkRef.current = null;
    setLink(null);
    setPhase({ kind: 'input' });
  };

  // 通信の知らせ（部屋に入ってから対戦画面へ進むまで、ずっと聞く）
  useEffect(() => {
    if (!link) return;
    const offs = [
      link.on('status', (s) => {
        const text = errorText(s);
        if (text) fail(text);
      }),
      link.on('matched', (opp) => {
        markStart('found');
        audio.play('se_match_found');
        setPhase({ kind: 'found', opp });
      }),
      link.on('waitingTick', (ms) => setWaitedMs(ms)),
      link.on('members', (m) => setMembers(m)),
      link.on('invite', (s) => {
        setInvite(s);
        if (s.kind === 'received') audio.play('se_match_found');
        if (s.kind === 'declined') {
          say(t().lobby.declined(safeName(s.name, t().lobby.nameless)));
          link.session.clearInviteNote();
        }
        if (s.kind === 'expired') {
          say(t().lobby.expired);
          link.session.clearInviteNote();
        }
      }),
      link.on('joinLeave', (e) => say(e.kind === 'join' ? t().lobby.joined(safeName(e.name, t().lobby.nameless)) : t().lobby.left(safeName(e.name, t().lobby.nameless)))),
      link.on('start', (g) => {
        // VS の間に、相手の停止の確認と、2人のデッキのカードの絵の読み込みを始めておく（v2.7）
        allowedRef.current = { game: g.game, opp: g.oppUserId ?? '', ok: opponentAllowed(g.oppUserId) };
        void preloadCards([...new Set([...g.decks.p1, ...g.decks.p2])]);
        tryGo();
      }),
      // 相手が見つかった後に、相手が消えてしまった
      link.on('connection', (c) => {
        if (c === 'lost') fail(errorText({ kind: 'error', reason: 'lost' })!);
      }),
    ];
    return () => offs.forEach((f) => f());
  }, [link]);

  // 「あいてが きた！」→ VS（1.4秒。演出スピードに合わせる）→ 種が決まっていれば対戦へ
  useEffect(() => {
    if (phase.kind === 'found') {
      const id = window.setTimeout(() => setPhase({ kind: 'vs', opp: phase.opp }), vsDur(fx, FOUND_MS));
      return () => window.clearTimeout(id);
    }
    if (phase.kind === 'vs') {
      // VS に入る前に中止されていないか
      const st = linkRef.current?.session.status;
      const text = st ? errorText(st) : t().lobby.failedShort;
      if (text) {
        fail(text);
        return;
      }
      markStart('vs');
      const id = window.setTimeout(() => {
        markStart('vsEnd');
        vsDone.current = true;
        tryGo();
      }, vsDur(fx, VS_MS));
      // 相手とつながったのに、しばらくたっても種が決まらない
      const giveUp = window.setTimeout(() => {
        if (!toBattle.current) fail(errorText({ kind: 'error', reason: 'timeout' })!);
      }, START_TIMEOUT_MS);
      return () => {
        window.clearTimeout(id);
        window.clearTimeout(giveUp);
      };
    }
  }, [phase]);

  // 知らせ（人の出入り・ことわられた）は少しで消す
  useEffect(() => {
    if (!note) return;
    const id = window.setTimeout(() => setNote(null), 2600);
    return () => window.clearTimeout(id);
  }, [note]);

  // 待っている間の「…」が増えていくアニメ
  useEffect(() => {
    if (phase.kind !== 'waiting') return;
    const id = window.setInterval(() => setDots((d) => (d + 1) % 4), 600);
    return () => window.clearInterval(id);
  }, [phase.kind]);

  // PC のキーボードでも入力できる
  useEffect(() => {
    if (phase.kind !== 'input') return;
    const onKey = (e: KeyboardEvent) => {
      if (/^[0-9]$/.test(e.key)) setRoom((r) => (r.length < MAX_DIGITS ? r + e.key : r));
      else if (e.key === 'Backspace') setRoom((r) => r.slice(0, -1));
      else if (e.key === 'Enter') join();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // 画面を出る時（対戦へ進む時以外）は部屋を出る。
  // 開発時の StrictMode は「片付け → すぐ作り直し」をするので、少し待って本当に出た時だけ（部屋に戻ってきた時の通信を切らないように）
  const mounted = useRef(0);
  useEffect(() => {
    mounted.current += 1;
    return () => {
      mounted.current -= 1;
      window.setTimeout(() => {
        if (mounted.current === 0 && !toBattle.current && linkRef.current && currentOnline() === linkRef.current) endOnline();
      }, 0);
    };
  }, []);

  const others = members.filter((m) => !m.me);
  const nameless = tr.lobby.nameless;
  const curDeck = save.decks[save.selectedDeck];
  /** 次の試合から使うデッキを変える（「デッキを かえる」） */
  const changeDeck = (i: number) => {
    update((d) => void (d.selectedDeck = i));
    setDeck(i);
    linkRef.current?.session.setDeck(save.decks[i].cards, save.decks[i].name);
    setPicking(false);
  };
  const deckRow = (
    <div className="lobby-room__deck">
      <span>{tr.lobby.myDeck(curDeck.name)}</span>
      <RoughButton seed="lobby-room-deck" className="lobby-room__deck-btn" onClick={() => setPicking(true)} data-testid="room-change-deck">
        {tr.lobby.changeDeck}
      </RoughButton>
    </div>
  );
  const overlays = (
    <>
      {picking && <DeckPickerDialog save={save} current={save.selectedDeck} mode="battle" title={tr.lobby.changeDeck} note={tr.lobby.nextGameNote} onPick={changeDeck} onClose={() => setPicking(false)} />}
      {invite.kind === 'received' && (
        <Dialog
          seed="lobby-invite"
          title={tr.lobby.inviteReceived(safeName(invite.name, nameless))}
          actions={
            <>
              <RoughButton seed="invite-no" onClick={() => link?.session.answerInvite(false)} data-testid="invite-decline">
                {tr.lobby.decline}
              </RoughButton>
              <RoughButton seed="invite-yes" highlight onClick={() => link?.session.answerInvite(true)} data-testid="invite-accept">
                {tr.lobby.accept}
              </RoughButton>
            </>
          }
        >
          {null}
        </Dialog>
      )}
      {note && (
        <div key={note.n} className="lobby-room__note" role="status">
          {note.text}
        </div>
      )}
    </>
  );

  // 部屋にほかの人がいる時：へやの なかま（v2.0-G。8人まで。名前を押すと「あそぼう！」）
  if (phase.kind === 'waiting' && others.length > 0) {
    return (
      <div className="lobby lobby--room" data-testid="room">
        <h1 className="lobby__title">{tr.lobby.roomTitle}</h1>
        <div className="lobby-room__num">
          <span className="pencil">{tr.lobby.roomLabel}</span>
          <span className="num" data-testid="room-number">
            {room}
          </span>
        </div>
        <p className="lobby-room__tell pencil">{tr.lobby.tell}</p>
        <RoughBox seed="lobby-room-list" className="lobby-room__list" paper radius={10}>
          <p className="lobby-room__count pencil">{tr.lobby.count(members.length, ROOM_MAX)}</p>
          <ul className="lobby-room__members">
            {members.map((m) => {
              // 同じユーザーID の人（v2.2）には申し込めない
              const canInvite = !m.me && !m.sameUser && m.state === 'waiting' && invite.kind === 'none';
              const label = m.me ? m.name : safeName(m.name, nameless);
              return (
                <li key={m.peerId} className={`lobby-room__member is-${m.state} ${m.me ? 'is-me' : ''}`}>
                  {canInvite ? (
                    <button type="button" className="lobby-room__name lobby-room__name--btn" aria-label={tr.lobby.inviteAria(label)} onClick={() => link?.session.inviteTo(m.peerId)} data-testid={`invite-${label}`}>
                      {label}
                    </button>
                  ) : (
                    <span className="lobby-room__name">
                      {label}
                      {m.me && <small className="pencil">{tr.lobby.meTag}</small>}
                      {m.sameUser && (
                        <small className="red-pen" data-testid="room-cannot-play">
                          {tr.common.cannotPlay}
                        </small>
                      )}
                    </span>
                  )}
                  <span className={`lobby-room__state ${m.state === 'waiting' ? 'blue-pen' : 'pencil'}`}>{m.state === 'waiting' ? tr.lobby.stateWaiting : tr.lobby.statePlaying}</span>
                </li>
              );
            })}
          </ul>
        </RoughBox>
        <div className="lobby-room__side">
          {deckRow}
          {invite.kind === 'sent' ? (
            <div className="lobby-room__sent">
              <p>{tr.lobby.inviteSent(safeName(invite.name, nameless))}</p>
              <RoughButton seed="invite-cancel" onClick={() => link?.session.cancelInvite()} data-testid="invite-cancel">
                {tr.lobby.inviteCancel}
              </RoughButton>
            </div>
          ) : others.every((m) => m.sameUser) ? (
            <p className="lobby-room__hint red-pen" data-testid="room-only-same">
              {tr.common.cannotPlay}
            </p>
          ) : (
            <p className="lobby-room__hint">{tr.lobby.inviteHint}</p>
          )}
        </div>
        <RoughButton seed="lobby-cancel" className="lobby-room__leave" onClick={cancel}>
          {tr.lobby.leaveRoom}
        </RoughButton>
        {overlays}
      </div>
    );
  }

  if (phase.kind === 'waiting') {
    return (
      <div className="lobby lobby--wait">
        <p className="lobby-wait__label">{tr.lobby.roomLabel}</p>
        <RoughBox seed="lobby-wait-num" className="lobby-wait__num" paper radius={10} strokeWidth={3}>
          <span className="num" data-testid="room-number">
            {room}
          </span>
        </RoughBox>
        <p className="lobby-wait__tell">{tr.lobby.tell}</p>
        <p className="lobby-wait__waiting">
          {tr.lobby.waiting}
          <span className="lobby-wait__dots">{tr.lobby.dot.repeat(dots)}</span>
        </p>
        {waitedMs >= HINT_AFTER_MS && <p className="lobby-wait__hint red-pen">{tr.lobby.checkNumber}</p>}
        <div className="lobby-wait__deck">{deckRow}</div>
        <RoughButton seed="lobby-cancel" className="lobby-wait__cancel" onClick={cancel}>
          {tr.common.cancel}
        </RoughButton>
        {overlays}
      </div>
    );
  }

  if (phase.kind === 'found') {
    return (
      <div className="lobby lobby--found">
        <p className="lobby-found" style={tiltStyle('lobby-found')}>
          {tr.lobby.came}
        </p>
      </div>
    );
  }

  if (phase.kind === 'vs') {
    return (
      <div className="lobby lobby--vs" data-testid="vs">
        <div className="lobby-vs__side lobby-vs__side--me">
          <span className="lobby-vs__who pencil">{tr.common.me}</span>
          <span className="lobby-vs__name blue-pen">{save.playerName}</span>
        </div>
        <div className="lobby-vs__vs">VS</div>
        <div className="lobby-vs__side lobby-vs__side--opp">
          <span className="lobby-vs__who pencil">{tr.common.opp}</span>
          <span className="lobby-vs__name red-pen">{safeName(phase.opp, nameless)}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="lobby">
      {/* アカウント停止の確かめ（v2.0-J） */}
      <SuspensionGate />
      <h1 className="lobby__title">{tr.lobby.title}</h1>
      <RoughButton seed="lobby-back" className="lobby__back" onClick={() => go('online')}>
        {tr.common.back}
      </RoughButton>

      <section className="lobby__left">
        <p className="lobby__label">{tr.lobby.roomInput}</p>
        <RoughBox seed="lobby-num" className="lobby__num" paper radius={10} strokeWidth={3}>
          <span className="lobby__digits" data-testid="room-input">
            {Array.from({ length: MAX_DIGITS }, (_, i) => (
              <span key={i} className={i < room.length ? 'num lobby__digit' : 'lobby__digit lobby__digit--empty'}>
                {room[i] ?? tr.lobby.blank}
              </span>
            ))}
          </span>
        </RoughBox>
        <NumberPad value={room} maxLength={MAX_DIGITS} onChange={setRoom} className="lobby__pad" />
      </section>

      <section className="lobby__right">
        <div className="lobby__decks">
          <DeckChooser
            save={save}
            seed="lobby-deck"
            value={deck}
            onChange={(i) => {
              setDeck(i);
              // 選んだデッキは「いまのデッキ」にする
              if (save.selectedDeck !== i) update((d) => void (d.selectedDeck = i));
            }}
          />
        </div>
        <RoughButton seed="lobby-join" className="lobby__join" strokeWidth={3} highlight={canJoin} disabled={!canJoin} onClick={join}>
          {tr.lobby.enter}
        </RoughButton>
        <p className="lobby__note pencil">
          {tr.lobby.note1}
          <br />
          {tr.lobby.note2}
          {room.length > 0 && room.length < MIN_DIGITS && <span className="lobby__more red-pen">{tr.lobby.moreDigits(MIN_DIGITS - room.length)}</span>}
        </p>
      </section>

      {phase.kind === 'error' && (
        <div className="lobby__error" role="alert">
          <RoughBox seed="lobby-error" className="lobby__error-box" paper radius={10} stroke="var(--pen-red)" strokeWidth={3}>
            <p className="lobby__error-text red-pen">{phase.text}</p>
            <RoughButton seed="lobby-error-ok" className="lobby__error-ok" onClick={() => setPhase({ kind: 'input' })}>
              {tr.common.ok}
            </RoughButton>
          </RoughBox>
        </div>
      )}
    </div>
  );
}
