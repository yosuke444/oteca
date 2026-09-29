import { useEffect, useRef, useState } from 'react';
import type { BattleSetup } from '../../battle/setup';
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
  const [waitingRematch] = useState(false);

  // 勝敗数をセーブデータに記録（フレンド対戦だけ。中断・切断は記録しない）
  useEffect(() => {
    if (recorded.current || !r.setup.record) return;
    recorded.current = true;
    update((d) => {
      if (win) d.stats.wins += 1;
      else d.stats.losses += 1;
    });
  }, [r.setup.record, update, win]);

  const title = hotSeat ? `${r.setup.names[r.winner]} の かち！` : win ? 'かち！' : 'まけ…';

  return (
    <div className={`result ${win || hotSeat ? 'result--win' : 'result--lose'}`}>
      <h1 className={[...title].length > 5 ? "result__title result__title--long" : "result__title"}>
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
        <div className="result__mvp" data-zone="mvp">
          <CardMini def={mvp} seed="result-mvp" variant="tile" />
          <span className="result__mvp-label">MVP</span>
        </div>
      )}

      <div className="result__buttons">
        <RoughButton seed="result-again" className="result__btn" highlight onClick={() => go('battle', rematchSetup(r.setup))}>
          もういっかい
        </RoughButton>
        <RoughButton seed="result-menu" className="result__btn" onClick={() => go('menu')}>
          メニューへ
        </RoughButton>
      </div>
      {waitingRematch && <p className="result__wait pencil">あいても まってるよ</p>}
    </div>
  );
}
