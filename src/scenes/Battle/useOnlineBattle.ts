import { type MutableRefObject, useEffect, useState } from 'react';
import { connectLockstep } from '../../battle/lockstep';
import type { BattleSetup } from '../../battle/setup';
import type { Match } from '../../controllers/match';
import type { RemoteController } from '../../controllers/remote';
import type { Side } from '../../engine/types';
import { currentOnline } from '../../net/online';
import type { Connection } from '../../net/session';

/** 対戦を続けられなくなった理由 */
export type OnlineProblem = 'desync' | 'left' | 'cheat' | null;

/**
 * フレンド対戦のつなぎ（SPEC §11-3〜§11-7）
 * 自分の操作を送り、相手の操作をエンジンに通し、通信の様子を画面に知らせる。
 */
export function useOnlineBattle(setup: BattleSetup, matchRef: MutableRefObject<Match | null>, matchId: number) {
  const [connection, setConnection] = useState<Connection>('ok');
  const [problem, setProblem] = useState<OnlineProblem>(null);
  const [desyncTurn, setDesyncTurn] = useState<number | null>(null);

  useEffect(() => {
    if (setup.mode !== 'online') return;
    const link = currentOnline();
    const match = matchRef.current;
    if (!link || !match) {
      setProblem('left');
      return;
    }
    const opp: Side = setup.me === 'p1' ? 'p2' : 'p1';
    const remote = match.controllers[opp] as RemoteController;
    const offs = [
      connectLockstep(match, setup.me, link.session),
      link.receiveActions(setup.game ?? 0, (a) => remote.feed(a)),
      link.on('connection', (c) => setConnection(c)),
      link.on('desync', (turn) => {
        setDesyncTurn(turn);
        setProblem('desync');
      }),
      link.on('status', (s) => {
        if (s.kind === 'aborted') setProblem(s.reason);
      }),
    ];
    setConnection(link.session.connection);
    return () => offs.forEach((f) => f());
    // 試合（Match）が作り直されたら、つなぎ直す
  }, [matchId]);

  return { connection, problem, desyncTurn };
}
