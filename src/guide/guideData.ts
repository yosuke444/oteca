import { CPU_LEVELS, type CpuLevel } from '../cpu/brains';
import { DAILY } from '../daily/daily';
import { SHOP_PACKS } from '../data/packs';
import { ECONOMY } from '../economy/rewards';
import { DEFAULT_RULES } from '../engine/rules';
import { DRAW, superRate } from '../gacha/gacha';
import { DECK_SLOTS } from '../save/saveData';
import { STORY } from '../story/story';
import { TRADE_MAX_CARDS, TRADE_MAX_KINDS } from '../trade/trade';
import { RANKING, RATING } from '../config/rating';
import { ROOM_MAX } from '../net/session';

/**
 * 「このモードの せつめい」（SPEC §7 共通・UPDATE_v2_1 §5）に出す数。
 * 文は辞書（guide）にあり、数はここで各データ（economy.json・packs.json・story.json・daily.json・RuleSet・rating.ts）から集める。
 * 数値を変えても、説明の文が自動でそろう。
 */

/** 説明を付けるモード */
export const GUIDE_MODES = ['online', 'cpu', 'story', 'gacha', 'deck', 'trade', 'daily', 'ranking'] as const;
export type GuideMode = (typeof GUIDE_MODES)[number];

/** % の文字（小数1けたまで） */
const pct = (p: number) => String(Math.round(p * 1000) / 10);

export type GuideNumbers = ReturnType<typeof guideNumbers>;

/** 説明に入れる、ほかの辞書の言葉（CPU の強さの名前と一言・ミッションの文。ModeGuide が今の言語の辞書から作る） */
export type GuideWords = {
  levels: Record<CpuLevel, string>;
  levelNotes: Record<CpuLevel, string>;
  /** daily.missions と同じ順のミッションの文（目標の数入り） */
  missions: string[];
};

export function guideNumbers() {
  const offers = DRAW.offers;
  return {
    online: {
      friend: ECONOMY.onlineReward.friend,
      rate: ECONOMY.onlineReward.rate,
      dailyLimit: ECONOMY.dailyRewardLimit,
      minTurns: ECONOMY.minTurnsEach,
      rateStart: RATING.initial,
      roomMax: ROOM_MAX,
    },
    cpu: {
      levels: CPU_LEVELS.map((l: CpuLevel) => ({ level: l, coins: ECONOMY.cpuWinReward[l] })),
    },
    story: {
      stages: STORY.stages.length,
      bosses: STORY.stages.filter((s) => s.kind === 'boss').length,
      normalFirst: STORY.rewards.normal.first,
      normalAgain: STORY.rewards.normal.again,
      bossFirst: STORY.rewards.boss.first,
      bossAgain: STORY.rewards.boss.again,
    },
    gacha: {
      offers: offers.map((o) => ({ bags: o.bags, price: o.price })),
      double: pct(DRAW.doubleRate),
      supers: SHOP_PACKS.map((p) => ({ name: p.name, rate: pct(superRate(p)) })),
      superToCoins: DRAW.superToCoins,
    },
    deck: {
      size: DEFAULT_RULES.deckSize,
      superMax: DEFAULT_RULES.superMaxPerDeck,
      slots: DECK_SLOTS,
    },
    trade: { kinds: TRADE_MAX_KINDS, cards: TRADE_MAX_CARDS },
    ranking: { rateStart: RATING.initial, hour: RANKING.batchHourJst, pair: RANKING.pairDailyLimit, hideDays: RANKING.hideAfterDays, top: RANKING.top },
    daily: {
      resetHour: DAILY.resetHour,
      pick: DAILY.pick,
      missions: DAILY.missions.map((m) => ({ id: m.id, target: m.target, coins: m.coins })),
      allClearBags: DAILY.allClear.bags,
      allClearCoins: DAILY.allClear.coins,
    },
  };
}
