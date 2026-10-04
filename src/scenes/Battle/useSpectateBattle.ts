import { type MutableRefObject, useEffect, useState } from 'react';
import type { BattleSetup } from '../../battle/setup';
import type { Match } from '../../controllers/match';
import { currentSpectator } from '../../net/online';
import { useNav } from '../../router';
import { spectateSetup } from '../Admin/SpectateScene';

/**
 * 観戦（v2.0-J。SPEC §11-10）のつなぎ：観戦の通信から届いた2人の操作を、試合に通す。
 * 途中から入った時は、それまでの操作を演出なしで通してから（quietRef）、そのあとは対戦と同じ演出で進める。
 * @param matchId 試合（Match）を作った回数。0 はまだ作っていない
 */
export function useSpectateBattle(setup: BattleSetup, matchRef: MutableRefObject<Match | null>, matchId: number, quietRef: MutableRefObject<boolean>) {
  const { go } = useNav();
  /** 見ていた試合が終わった（対戦者が まちあいに戻った・部屋を出た） */
  const [gone, setGone] = useState(false);

  useEffect(() => {
    if (setup.mode !== 'spectate' || matchId === 0 || !setup.spectate) return;
    const sp = currentSpectator();
    const match = matchRef.current;
    if (!sp || !match) {
      setGone(true);
      return;
    }
    const { room, key } = setup.spectate;
    const s = sp.session;
    const submit = (a: Parameters<Match['submit']>[0]) => match.submit(a);
    // それまでの操作：演出なしで、今の場面まで
    quietRef.current = true;
    s.drain(submit);
    quietRef.current = false;
    s.onActions = () => s.drain(submit);
    // 次の試合（再戦・別の組）が始まった：その試合を映す
    s.onStart = (st) => {
      if (st.key !== key || st.game !== setup.game) go('battle', spectateSetup(st, room));
    };
    s.onMatches = (list) => {
      if (!list.some((m) => m.key === key)) setGone(true);
    };
    s.onStatus = () => {};
    return () => {
      s.onActions = () => {};
      s.onStart = () => {};
      s.onMatches = () => {};
    };
  }, [matchId]);

  return { gone };
}
