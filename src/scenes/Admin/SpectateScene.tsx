import { useEffect, useState } from 'react';
import type { BattleSetup } from '../../battle/setup';
import { SPECTATE_BOTTOM } from '../../battle/spectate';
import { useT } from '../../i18n/useT';
import { currentSpectator, endSpectator, startSpectator } from '../../net/online';
import type { SpecMatch, SpecStart, SpectatorStatus } from '../../net/spectator';
import { isAdmin } from '../../online/adminApi';
import { safeName } from '../../online/names';
import { useNav } from '../../router';
import { RoughBox } from '../../ui/rough/RoughBox';
import { RoughButton } from '../../ui/rough/RoughButton';
import type { AdminPayload } from './AdminScene';
import './admin.css';

/** 観戦の画面に渡すもの：部屋番号 */
export type SpectatePayload = { room: string } | null;

/** 観戦する試合 → 対戦の画面の設定（下側は先攻。何も操作できない。記録しない） */
export function spectateSetup(st: SpecStart, room: string): BattleSetup {
  return { mode: 'spectate', decks: st.decks, names: st.names, seed: st.seed, me: SPECTATE_BOTTOM, record: false, game: st.game, spectate: { room, key: st.key } };
}

/**
 * 大会閲覧（v2.0-J。管理者メニュー。SPEC §7 S20・§11-10）：部屋の対戦を観戦する。
 * だれもいなければ「まだ ひとは いません」と出して待つ。対戦が1つなら すぐ映し、2つ以上なら選ぶ
 */
export function SpectateScene() {
  const tr = useT();
  const W = tr.admin.watch;
  const { go, payload } = useNav();
  const room = (payload as SpectatePayload)?.room ?? currentSpectator()?.room ?? '';
  const [status, setStatus] = useState<SpectatorStatus>('connecting');
  const [matches, setMatches] = useState<SpecMatch[]>([]);

  useEffect(() => {
    // 管理者メニューに入っていない（ページを開き直した など）なら、管理者メニューへ（入り直しを出す）
    if (!isAdmin()) {
      endSpectator();
      go('admin');
      return;
    }
    if (!room) return;
    const cur = currentSpectator();
    const s = cur && cur.room === room ? cur.session : startSpectator(room);
    const sync = () => {
      setStatus(s.state);
      setMatches(s.matches);
    };
    const autoWatch = () => {
      if (!s.watchingMatch && s.matches.length === 1) s.watch(s.matches[0]);
    };
    s.onStatus = sync;
    s.onMatches = () => {
      sync();
      autoWatch();
    };
    s.onStart = (st) => go('battle', spectateSetup(st, room));
    s.onActions = () => {};
    sync();
    autoWatch();
    // 見ている試合が もう始まっている（決着の後に戻ってきた・途中から入った）
    const started = s.currentStart;
    if (started && s.watchingMatch === started.key && s.matches.some((m) => m.key === started.key && m.game === started.game)) {
      // 決着の後は次の試合（再戦）の始まりを待つ。同じ試合の途中なら対戦の画面へ
      if (!finishedGames.has(`${started.key}:${started.game}`)) go('battle', spectateSetup(started, room));
    }
    return () => {
      s.onStatus = () => {};
      s.onMatches = () => {};
      s.onStart = () => {};
    };
  }, [room]);

  const leave = () => {
    endSpectator();
    go('admin', { fn: 'watch' } satisfies AdminPayload);
  };

  const message =
    status === 'full' ? W.full : status === 'connecting' ? W.connecting : status === 'empty' ? W.empty : matches.length > 1 ? W.choose : status === 'watching' ? W.catchingUp : W.waiting;

  return (
    <div className="spectate-scene" data-testid="spectate-scene">
      <h1 className="admin-scene__title">{W.title(room)}</h1>
      <RoughButton seed="spectate-leave" className="admin-scene__back" onClick={leave} data-testid="spectate-leave">
        {W.leave}
      </RoughButton>
      <RoughBox seed="spectate-panel" className="spectate-panel" paper radius={12}>
        <div className="spectate-panel__inner">
          <p className={`spectate-panel__msg ${status === 'full' ? 'red-pen' : 'pencil'}`} data-testid={`spectate-${status}`}>
            {message}
          </p>
          {matches.length > 1 && (
            <div className="spectate-panel__list">
              {matches.map((m) => (
                <RoughButton key={m.key} seed={`spectate-${m.key}`} className="spectate-panel__match" onClick={() => currentSpectator()?.session.watch(m)} data-testid="spectate-match">
                  {W.vs(safeName(m.names.p1, tr.lobby.nameless), safeName(m.names.p2, tr.lobby.nameless))}
                </RoughButton>
              ))}
            </div>
          )}
        </div>
      </RoughBox>
    </div>
  );
}

/** 決着まで見た試合（決着の後に観戦の画面へ戻った時、同じ試合をもう一度映さない） */
export const finishedGames = new Set<string>();
