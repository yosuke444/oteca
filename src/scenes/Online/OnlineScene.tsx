import { ECONOMY, rewardedToday, todayKey } from '../../economy/rewards';
import { useT } from '../../i18n/useT';
import { useNav } from '../../router';
import { useSave } from '../../state/SaveContext';
import { CoinCounter } from '../../ui/coin/Coin';
import { OtegeArt } from '../../ui/common/OtegeArt';
import { RoughBox } from '../../ui/rough/RoughBox';
import { RoughButton } from '../../ui/rough/RoughButton';
import { ModeGuide } from '../../ui/guide/ModeGuide';
import './online.css';

/**
 * S14 オンラインたいせん（v2.0-G。UPDATE_v2 §8-1）：レートたいせん／フレンドたいせん を選ぶ。
 * 自分のレート、レート対戦の勝敗、今日もらえるコインの残り回数を出す。
 */
export function OnlineScene() {
  const { go } = useNav();
  const { save } = useSave();
  const tr = useT();
  const left = Math.max(0, ECONOMY.dailyRewardLimit - rewardedToday(save, todayKey(new Date())));
  return (
    <div className="online-scene" data-testid="online-scene">
      <h1 className="online-scene__title">{tr.online.title}</h1>
      <CoinCounter value={save.coins} className="online-scene__coins" />
      <RoughButton seed="online-back" className="online-scene__back" onClick={() => go('menu')}>
        {tr.common.back}
      </RoughButton>

      <ModeGuide mode="online" className="online-scene__guide" />

      <RoughButton seed="online-rate" className="online-scene__choice online-scene__choice--rate" strokeWidth={3} onClick={() => go('rate')} data-testid="online-rate">
        <span className="online-scene__label">
          {tr.online.rate}
          <small>{tr.online.rateSub}</small>
        </span>
      </RoughButton>
      <RoughButton seed="online-friend" className="online-scene__choice online-scene__choice--friend" strokeWidth={3} onClick={() => go('lobby')} data-testid="online-friend">
        <span className="online-scene__label">
          {tr.online.friend}
          <small>{tr.online.friendSub}</small>
        </span>
      </RoughButton>

      <RoughBox seed="online-info" className="online-scene__info" paper radius={10}>
        <p className="online-scene__rate">
          <span className="num">{tr.online.myRate(save.rate)}</span>
        </p>
        <p className="online-scene__rec pencil">{tr.online.record(save.rateStats.wins, save.rateStats.losses, save.rateStats.best)}</p>
        <p className="online-scene__coins-left blue-pen">{tr.online.coinsLeft(left)}</p>
      </RoughBox>
      <OtegeArt width={170} className="online-scene__art" />
    </div>
  );
}
