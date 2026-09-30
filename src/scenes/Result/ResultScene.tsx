import { useEffect, useRef, useState } from 'react';
import { audio } from '../../audio/audioManager';
import { useFx } from '../../fx/fxSettings';
import { Particles } from '../../fx/particles';
import { playLose, playWin, stopResultFx } from '../../fx/resultFx';
import { buildActionLog, downloadActionLog } from '../../battle/actionLog';
import { type BattleSetup, badOnlineStart, onlineSetup } from '../../battle/setup';
import { currentOnline, endOnline } from '../../net/online';
import { isDebugMode } from '../../router';
import type { MatchStats } from '../../battle/stats';
import { CARD_DB } from '../../data/cards';
import type { Action, EndReason, Side } from '../../engine/types';
import { useNav } from '../../router';
import { useSave } from '../../state/SaveContext';
import { CardMini } from '../../ui/card/CardMini';
import { RoughBox } from '../../ui/rough/RoughBox';
import { RoughButton } from '../../ui/rough/RoughButton';
import { rematchSetup } from '../Battle/BattleScene';
import './result.css';

export type ResultPayload = {
  setup: BattleSetup;
  winner: Side;
  reason: EndReason;
  stats: MatchStats;
  log: Action[];
  /** 最後の状態ハッシュ（行動ログの保存用） */
  finalHash: string;
};

const REASON_TEXT: Record<EndReason, string> = {
  ko: 'たおした かずで',
  noBench: 'ベンチが からっぽに なって',
  surrender: 'おてあげ（こうさん）で',
};

/** S05 リザルト（SPEC §7） */
export function ResultScene() {
  const { payload, go } = useNav();
  const r = payload as ResultPayload;
  const { update } = useSave();
  const recorded = useRef(false);
  const me = r.setup.me;
  const opp: Side = me === 'p1' ? 'p2' : 'p1';
  const hotSeat = r.setup.mode === 'local';
  const win = r.winner === me;
  const s = r.stats.sides[hotSeat ? r.winner : me];
  const mvp = s.mvpNo !== null ? CARD_DB[s.mvpNo] : null;
  // フレンド対戦の再戦（両者が「もういっかい」を押したら先攻決めから。SPEC §7 S05）
  const link = r.setup.mode === 'online' ? currentOnline() : null;
  const [waitingRematch, setWaitingRematch] = useState(false);
  const [oppWants, setOppWants] = useState(link?.oppRematch ?? false);
  const [oppGone, setOppGone] = useState(r.setup.mode === 'online' && !link);
  // 決着の結果が2人でそろったか（同時に降参した時など、食い違ったら記録しない）
  const [agree, setAgree] = useState<boolean | null>(link ? link.resultAgree : null);
  useEffect(() => (link ? link.on('result', setAgree) : undefined), [link]);


  useEffect(() => {
    if (!link) return;
    const offs = [
      link.on('oppRematch', () => setOppWants(true)),
      link.on('start', (g) => {
        if (g.game <= (r.setup.game ?? 0)) return;
        if (badOnlineStart(g)) {
          endOnline();
          setOppGone(true);
          return;
        }
        go('battle', onlineSetup(g, isDebugMode()));
      }),
      link.on('status', (st) => {
        if (st.kind === 'aborted') setOppGone(true);
      }),
    ];
    return () => offs.forEach((f) => f());
  }, [link, go, r.setup.game]);

  const again = () => {
    if (!link) {
      go('battle', rematchSetup(r.setup));
      return;
    }
    setWaitingRematch(true);
    link.requestRematch();
  };
  const toMenu = () => {
    if (r.setup.mode === 'online') endOnline();
    go('menu');
  };
  const rematchNote = agree === false
    ? 'ふたりの けっかが ちがったので きろく しないよ'
    : oppGone
    ? 'あいては メニューに もどったよ'
    : waitingRematch
      ? oppWants
        ? 'はじまるよ！'
        : 'あいてを まってるよ…'
      : oppWants
        ? 'あいても まってるよ'
        : '';

  // 勝敗数をセーブデータに記録（フレンド対戦だけ。中断・切断は記録しない）
  useEffect(() => {
    if (recorded.current || !r.setup.record) return;
    if (r.setup.mode === 'online' && agree !== true) return;
    recorded.current = true;
    update((d) => {
      if (win) d.stats.wins += 1;
      else d.stats.losses += 1;
    });
  }, [r.setup.record, r.setup.mode, update, win, agree]);

  const title = hotSeat ? `${r.setup.names[r.winner]} の かち！` : win ? 'かち！' : 'まけ…';
  const happy = win || hotSeat;

  // 勝ち・負けの演出（SPEC §9-2）
  const fx = useFx();
  const fxRef = useRef(fx);
  fxRef.current = fx;
  const rootRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const mvpRef = useRef<HTMLDivElement>(null);
  const nextRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    // 画面を離れたら（もういっかい・メニューへ）、途中でも止めて音も鳴らさない
    let alive = true;
    const particles = new Particles(canvasRef.current!, () => fxRef.current.speed);
    const t = {
      root: rootRef.current!,
      overlay: overlayRef.current!,
      canvas: canvasRef.current!,
      title: titleRef.current!,
      mvp: mvpRef.current,
      next: nextRef.current,
      speed: () => fxRef.current.speed,
      reduce: () => fxRef.current.reduceFx,
      sound: (k: string) => {
        if (alive) audio.play(k);
      },
      particles,
    };
    void (happy ? playWin(t) : playLose(t));
    return () => {
      alive = false;
      stopResultFx(t);
      particles.dispose();
    };
  }, []);

  return (
    <div className={`result ${happy ? 'result--win' : 'result--lose'}`} ref={rootRef}>
      <h1 ref={titleRef} className={[...title].length > 5 ? "result__title result__title--long" : "result__title"}>
        <span>{title}</span>
      </h1>
      <p className="result__reason">
        {REASON_TEXT[r.reason]}
        {hotSeat ? '' : win ? ' あなたの かち' : ` ${r.setup.names[opp]} の かち`}
      </p>

      <RoughBox seed="result-memo" className="result__memo" paper radius={6}>
        <h2 className="result__memo-title">きろく {hotSeat ? `（${r.setup.names[r.winner]}）` : ''}</h2>
        <ul className="result__list">
          <li>
            ターンすう <b className="num">{r.stats.turns}</b>
          </li>
          <li>
            あたえた ダメージ <b className="num">{s.damage}</b>
          </li>
          <li>
            たおした かず <b className="num">{s.kos}</b>
          </li>
          <li>
            MVP：{mvp ? <b>{mvp.name}</b> : 'なし'}
            {mvp && <span className="pencil">（{s.mvpDamage} ダメージ）</span>}
          </li>
        </ul>
      </RoughBox>

      {mvp && (
        <div className="result__mvp" data-zone="mvp" ref={mvpRef}>
          <CardMini def={mvp} seed="result-mvp" variant="tile" />
          <span className="result__mvp-label">MVP</span>
        </div>
      )}

      {!happy && (
        <p className="result__next" ref={nextRef}>
          つぎは かてる！
        </p>
      )}
      <div key="fx-overlay" className="fx-overlay" ref={overlayRef} />
      <canvas key="fx-particles" className="fx-particles" ref={canvasRef} />

      <div className="result__buttons">
        <RoughButton seed="result-again" className="result__btn" highlight={!waitingRematch && !oppGone} disabled={waitingRematch || oppGone} onClick={again}>
          もういっかい
        </RoughButton>
        <RoughButton seed="result-menu" className="result__btn" onClick={toMenu}>
          メニューへ
        </RoughButton>
      </div>
      {r.setup.debug && (
        <RoughButton seed="result-savelog" className="result__savelog" onClick={() => downloadActionLog(buildActionLog(r.setup, r.log, r.finalHash))}>
          こうどうログを ほぞん
        </RoughButton>
      )}
      {rematchNote && (
        <p className={`result__wait ${oppWants && !oppGone ? 'blue-pen' : 'pencil'}`} data-testid="rematch-note">
          {rematchNote}
        </p>
      )}
    </div>
  );
}
