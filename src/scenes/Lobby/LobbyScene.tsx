import { useEffect, useRef, useState } from 'react';
import { badOnlineStart, onlineSetup } from '../../battle/setup';
import { CARD_DB } from '../../data/cards';
import { validateDeck } from '../../engine';
import { audio } from '../../audio/audioManager';
import { isValidRoomNumber } from '../../net/protocol';
import { type OnlineLink, currentOnline, endOnline, startOnline } from '../../net/online';
import type { SessionStatus } from '../../net/session';
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

/** VS 画面を出す時間（SPEC §7 S03） */
const VS_MS = 2000;
const FOUND_MS = 1000;
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
      return 'このへやは まんいんだよ。\nちがう ばんごうに してね';
    case 'version':
      return 'バージョンが ちがうよ。\nふたりとも ページを よみこみなおしてね';
    case 'error':
      return 'つながらなかったよ。\nネットワークを かえると つながることが あるよ';
    case 'aborted':
      return s.reason === 'cheat' ? 'データが おかしいみたい。\nもういちど へやに はいってね' : 'あいてが やめたみたい';
    default:
      return null;
  }
}

/** S03 フレンド対戦ロビー（SPEC §7） */
export function LobbyScene() {
  const { go } = useNav();
  const { save } = useSave();
  const usable = save.decks.map((d, i) => ({ i, d })).filter(({ d }) => validateDeck(d.cards, CARD_DB).length === 0);
  const [room, setRoom] = useState('');
  const [deck, setDeck] = useState(usable.some((u) => u.i === save.selectedDeck) ? save.selectedDeck : (usable[0]?.i ?? -1));
  const [phase, setPhase] = useState<Phase>({ kind: 'input' });
  const [waitedMs, setWaitedMs] = useState(0);
  const [dots, setDots] = useState(0);
  const linkRef = useRef<OnlineLink | null>(null);
  const [link, setLink] = useState<OnlineLink | null>(null);
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
      fail('データが おかしいみたい。\nもういちど へやに はいってね');
      return;
    }
    toBattle.current = true;
    go('battle', onlineSetup(g, isDebugMode()));
  };

  const join = () => {
    if (!canJoin) return;
    vsDone.current = false;
    setWaitedMs(0);
    const l = startOnline(room, save.playerName, save.decks[deck].cards);
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
        audio.play('se_match_found');
        setPhase({ kind: 'found', opp });
      }),
      link.on('waitingTick', (ms) => setWaitedMs(ms)),
      link.on('start', () => tryGo()),
      // 相手が見つかった後に、相手が消えてしまった
      link.on('connection', (c) => {
        if (c === 'lost') fail(errorText({ kind: 'error', reason: 'lost' })!);
      }),
    ];
    return () => offs.forEach((f) => f());
  }, [link]);

  // 「あいてが きた！」→ VS（2秒）→ 種が決まっていれば対戦へ
  useEffect(() => {
    if (phase.kind === 'found') {
      const id = window.setTimeout(() => setPhase({ kind: 'vs', opp: phase.opp }), FOUND_MS);
      return () => window.clearTimeout(id);
    }
    if (phase.kind === 'vs') {
      // VS に入る前に中止されていないか
      const st = linkRef.current?.session.status;
      const text = st ? errorText(st) : 'つながらなかったよ';
      if (text) {
        fail(text);
        return;
      }
      const id = window.setTimeout(() => {
        vsDone.current = true;
        tryGo();
      }, VS_MS);
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

  // 画面を出る時（対戦へ進む時以外）は部屋を出る
  useEffect(
    () => () => {
      if (!toBattle.current && linkRef.current && currentOnline() === linkRef.current) endOnline();
    },
    [],
  );

  if (phase.kind === 'waiting') {
    return (
      <div className="lobby lobby--wait">
        <p className="lobby-wait__label">へやばんごう</p>
        <RoughBox seed="lobby-wait-num" className="lobby-wait__num" paper radius={10} strokeWidth={3}>
          <span className="num" data-testid="room-number">
            {room}
          </span>
        </RoughBox>
        <p className="lobby-wait__tell">この ばんごうを ともだちに おしえてね</p>
        <p className="lobby-wait__waiting">
          あいてを まってるよ<span className="lobby-wait__dots">{'・'.repeat(dots)}</span>
        </p>
        {waitedMs >= HINT_AFTER_MS && <p className="lobby-wait__hint red-pen">ばんごうが あってるか たしかめてね</p>}
        <RoughButton seed="lobby-cancel" className="lobby-wait__cancel" onClick={cancel}>
          やめる
        </RoughButton>
      </div>
    );
  }

  if (phase.kind === 'found') {
    return (
      <div className="lobby lobby--found">
        <p className="lobby-found" style={tiltStyle('lobby-found')}>
          あいてが きた！
        </p>
      </div>
    );
  }

  if (phase.kind === 'vs') {
    return (
      <div className="lobby lobby--vs" data-testid="vs">
        <div className="lobby-vs__side lobby-vs__side--me">
          <span className="lobby-vs__who pencil">じぶん</span>
          <span className="lobby-vs__name blue-pen">{save.playerName}</span>
        </div>
        <div className="lobby-vs__vs">VS</div>
        <div className="lobby-vs__side lobby-vs__side--opp">
          <span className="lobby-vs__who pencil">あいて</span>
          <span className="lobby-vs__name red-pen">{phase.opp}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="lobby">
      <h1 className="lobby__title">フレンドたいせん</h1>
      <RoughButton seed="lobby-back" className="lobby__back" onClick={() => go('menu')}>
        もどる
      </RoughButton>

      <section className="lobby__left">
        <p className="lobby__label">へやばんごう（4〜8けた）</p>
        <RoughBox seed="lobby-num" className="lobby__num" paper radius={10} strokeWidth={3}>
          <span className="lobby__digits" data-testid="room-input">
            {Array.from({ length: MAX_DIGITS }, (_, i) => (
              <span key={i} className={i < room.length ? 'num lobby__digit' : 'lobby__digit lobby__digit--empty'}>
                {room[i] ?? '＿'}
              </span>
            ))}
          </span>
        </RoughBox>
        <NumberPad value={room} maxLength={MAX_DIGITS} onChange={setRoom} className="lobby__pad" />
      </section>

      <section className="lobby__right">
        <p className="lobby__label">つかう デッキ</p>
        <div className="lobby__decks">
          {save.decks.map((d, i) => {
            const ok = usable.some((u) => u.i === i);
            return (
              <RoughButton key={i} seed={`lobby-deck-${i}`} className="lobby__deck" disabled={!ok} highlight={deck === i} onClick={() => setDeck(i)}>
                <span className="lobby__deck-name">{d.name}</span>
                <span className={ok ? 'lobby__deck-note pencil' : 'lobby__deck-note red-pen'}>{ok ? `${d.cards.length}まい` : 'つかえない'}</span>
              </RoughButton>
            );
          })}
        </div>
        <RoughButton seed="lobby-join" className="lobby__join" strokeWidth={3} highlight={canJoin} disabled={!canJoin} onClick={join}>
          へやに はいる
        </RoughButton>
        <p className="lobby__note pencil">
          ともだちと おなじ ばんごうを いれてね。
          <br />
          6けた いじょうが おすすめ
          {room.length > 0 && room.length < MIN_DIGITS && <span className="lobby__more red-pen">（あと {MIN_DIGITS - room.length}けた）</span>}
        </p>
      </section>

      {phase.kind === 'error' && (
        <div className="lobby__error" role="alert">
          <RoughBox seed="lobby-error" className="lobby__error-box" paper radius={10} stroke="var(--pen-red)" strokeWidth={3}>
            <p className="lobby__error-text red-pen">{phase.text}</p>
            <RoughButton seed="lobby-error-ok" className="lobby__error-ok" onClick={() => setPhase({ kind: 'input' })}>
              わかった
            </RoughButton>
          </RoughBox>
        </div>
      )}
    </div>
  );
}
