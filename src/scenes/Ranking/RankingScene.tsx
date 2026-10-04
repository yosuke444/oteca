import { useEffect, useRef, useState } from 'react';
import { RANKING } from '../../config/rating';
import { useT } from '../../i18n/useT';
import { safeName } from '../../online/names';
import { applyServerRate, cacheFresh, countdown, type RankingRow } from '../../online/ranking';
import { type RankingCache, fetchRanking, myRowKey, nextBatchAfter, readRankingCache } from '../../online/rankingApi';
import { useNav } from '../../router';
import { useSave } from '../../state/SaveContext';
import { RateValue } from '../../ui/common/RateValue';
import { ModeGuide } from '../../ui/guide/ModeGuide';
import { RoughBox } from '../../ui/rough/RoughBox';
import { RoughButton } from '../../ui/rough/RoughButton';
import './ranking.css';

/** 更新の時刻を過ぎてから、聞き直すまでの時間（まとめ処理が終わるのを待つ） */
const REFETCH_AFTER_MS = 60 * 1000;

type View = { kind: 'loading' } | { kind: 'ok'; data: RankingCache; stale: boolean } | { kind: 'offline' };

/**
 * S19 ランキング（v2.0-I。UPDATE_v2 §10・SPEC §7 S19）
 * 上位100人と自分の順位。毎日 4:00 と 14:00 に更新。一覧は次の更新まで端末に保存しておき、サーバーに聞かない
 */
export function RankingScene() {
  const { go } = useNav();
  const { save, update } = useSave();
  const tr = useT();
  const [view, setView] = useState<View>(() => {
    const c = readRankingCache();
    return cacheFresh(c, save.playerId, Date.now()) && c ? { kind: 'ok', data: c, stale: false } : { kind: 'loading' };
  });
  const [now, setNow] = useState(() => Date.now());
  const [myKey, setMyKey] = useState('');
  const saveRef = useRef(save);
  saveRef.current = save;
  const alive = useRef(true);

  const load = () => {
    void fetchRanking(saveRef.current).then((data) => {
      if (!alive.current) return;
      if (data) {
        setView({ kind: 'ok', data, stale: false });
        // 次の更新の後なら、正式なレートで上書きする
        if (data.me) update((d) => void applyServerRate(d, data.me, data.updatedAt, Date.now()));
        return;
      }
      // つながらない：前に保存した一覧があれば、それを出す
      const c = readRankingCache();
      setView(c && c.playerId === saveRef.current.playerId ? { kind: 'ok', data: c, stale: true } : { kind: 'offline' });
    });
  };

  useEffect(() => {
    alive.current = true;
    if (view.kind === 'loading') load();
    void myRowKey(save.playerId).then((k) => alive.current && setMyKey(k));
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => {
      alive.current = false;
      window.clearInterval(id);
    };
  }, []);

  // 保存した一覧の「次の更新」が過ぎていたら（つながらない時）、次の更新（4:00 か 14:00）までを数える
  const nextAt = view.kind === 'ok' && view.data.nextAt > now ? view.data.nextAt : nextBatchAfter(now);
  // 画面を開いたまま更新の時刻を過ぎた：少し待ってから聞き直す（1回だけ）
  const refetched = useRef(0);
  useEffect(() => {
    const due = view.kind === 'ok' ? view.data.nextAt : 0;
    if (view.kind !== 'ok' || view.stale || now < due + REFETCH_AFTER_MS || refetched.current === due) return;
    refetched.current = due;
    load();
  }, [now, nextAt, view.kind]);

  const nameless = tr.lobby.nameless;
  const showName = (n: string) => safeName(n, nameless) || nameless;
  const data = view.kind === 'ok' ? view.data : null;
  const me = data?.me ?? null;
  const myRank = me && me.visible && me.rank ? me.rank : null;
  const timeText = (ms: number) => {
    const d = new Date(ms);
    return tr.ranking.time(d.getMonth() + 1, d.getDate(), d.getHours(), d.getMinutes());
  };

  return (
    <div className="ranking-scene" data-testid="ranking-scene">
      <h1 className="ranking-scene__title">{tr.ranking.title}</h1>
      <p className="ranking-scene__daily">
        <span className="blue-pen">{tr.ranking.daily(RANKING.batchHoursJst)}</span>
        <span className="ranking-scene__countdown num" data-testid="ranking-countdown">
          {tr.ranking.next(countdown(nextAt, now))}
        </span>
      </p>
      <RoughButton seed="ranking-back" className="ranking-scene__back" onClick={() => go('menu')}>
        {tr.common.back}
      </RoughButton>

      <RoughBox seed="ranking-list" className="ranking-scene__list" paper radius={10}>
        <div className="ranking-table" role="table">
          <div className="ranking-table__head pencil" role="row">
            <span role="columnheader">{tr.ranking.colRank}</span>
            <span role="columnheader">{tr.ranking.colName}</span>
            <span role="columnheader">{tr.ranking.colRate}</span>
            <span role="columnheader">{tr.ranking.colRecord}</span>
          </div>
          <div className="ranking-table__body" data-testid="ranking-rows">
            {view.kind === 'loading' && <p className="ranking-table__msg pencil">{tr.ranking.loading}</p>}
            {view.kind === 'offline' && <p className="ranking-table__msg red-pen">{tr.ranking.offline}</p>}
            {data && data.top.length === 0 && <p className="ranking-table__msg pencil">{tr.ranking.empty}</p>}
            {data?.top.map((row) => (
              <Row key={`${row.rank}-${row.key}`} row={row} mine={!!myKey && row.key === myKey} name={showName(row.name)} />
            ))}
          </div>
        </div>
      </RoughBox>

      <RoughBox seed="ranking-me" className="ranking-scene__me" paper radius={10}>
        <div className="ranking-me">
          <p className="ranking-me__name">{save.playerName}</p>
          {myRank ? (
            <p className="ranking-me__rank" data-testid="ranking-my-rank">
              <span className="marker">{tr.ranking.myRank(myRank)}</span>
            </p>
          ) : view.kind === 'ok' ? (
            <p className="ranking-me__not-yet pencil" data-testid="ranking-not-yet">
              {tr.ranking.notYet}
            </p>
          ) : null}
          <p className="ranking-me__rate num">
            <RateValue value={save.rate} provisional={save.ranking.provisional} format={tr.online.myRate} />
          </p>
          {view.kind === 'ok' && view.stale && (
            <p className="ranking-me__stale red-pen" data-testid="ranking-offline">
              {tr.ranking.offline}
              <br />
              <span className="pencil">{tr.ranking.lastSeen(timeText(view.data.savedAt))}</span>
            </p>
          )}
        </div>
      </RoughBox>
      <ModeGuide mode="ranking" className="ranking-scene__guide" />
      <p className="ranking-scene__note pencil">{tr.ranking.hidden}</p>
    </div>
  );
}

function Row({ row, mine, name }: { row: RankingRow; mine: boolean; name: string }) {
  const tr = useT();
  return (
    <div className={`ranking-table__row ${mine ? 'is-mine' : ''}`} role="row" data-testid={mine ? 'ranking-row-mine' : 'ranking-row'}>
      <span className="ranking-table__rank num" role="cell">
        {row.rank <= 3 ? <Medal rank={row.rank} label={tr.ranking.medal(row.rank)} /> : null}
        {tr.ranking.rank(row.rank)}
      </span>
      <span className="ranking-table__name" role="cell">
        {name}
      </span>
      <span className="ranking-table__rate num" role="cell">
        {row.rate}
      </span>
      <span className="ranking-table__record" role="cell">
        {tr.ranking.record(row.wins, row.losses)}
      </span>
    </div>
  );
}

/** 1〜3位のメダルの落書き（金・銀・銅） */
function Medal({ rank, label }: { rank: number; label: string }) {
  const cls = rank === 1 ? 'gold' : rank === 2 ? 'silver' : 'bronze';
  return (
    <svg className={`ranking-medal ranking-medal--${cls}`} viewBox="0 0 32 36" role="img" aria-label={label}>
      <path className="ranking-medal__ribbon" d="M9 2 L14 15 M23 2 L18 15" />
      <path className="ranking-medal__disc" d="M16 13 C23 12.5 27 17 26.5 23.5 C26 30 21.5 33.5 15.5 33 C9.5 32.5 5.5 28.5 6 22.5 C6.5 16.5 10 13.3 16.5 13.2" />
      <path className="ranking-medal__star" d="M16 18.5 L17.6 22 L21 22.3 L18.4 24.6 L19.2 28 L16 26.2 L12.8 28 L13.6 24.6 L11 22.3 L14.4 22 Z" />
    </svg>
  );
}
