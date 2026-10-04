import { describe, expect, it } from 'vitest';
import { GUIDE_MODES, type GuideWords, guideNumbers } from '../src/guide/guideData';
import { hira } from '../src/i18n/ja-hira';
import { kanji } from '../src/i18n/ja-kanji';
import { ECONOMY } from '../src/economy/rewards';
import { DRAW } from '../src/gacha/gacha';
import { DAILY } from '../src/daily/daily';
import { STORY } from '../src/story/story';
import { ROOM_MAX } from '../src/net/session';
import { RATING } from '../src/config/rating';

/** このモードの せつめい（SPEC §7 共通・§16-2o。UPDATE_v2_1 §5） */

const n = guideNumbers();
const wordsOf = (d: typeof hira): GuideWords => ({ levels: d.cpu.level, levelNotes: d.cpu.levelNote, missions: DAILY.missions.map((m) => d.daily.mission[m.id](m.target)) });

describe('O01 説明の数はデータの値、行とページの数', () => {
  it('説明に入る数が、各データの値と一致する', () => {
    expect(n.cpu.levels.map((l) => l.coins)).toEqual([ECONOMY.cpuWinReward.weak, ECONOMY.cpuWinReward.normal, ECONOMY.cpuWinReward.strong, ECONOMY.cpuWinReward.strongest]);
    expect(n.online).toEqual({ friend: ECONOMY.onlineReward.friend, rate: ECONOMY.onlineReward.rate, dailyLimit: ECONOMY.dailyRewardLimit, minTurns: ECONOMY.minTurnsEach, rateStart: RATING.initial, roomMax: ROOM_MAX });
    expect(n.gacha.offers).toEqual(DRAW.offers.map((o) => ({ bags: o.bags, price: o.price, guarantee: o.lastBagSuper })));
    // v2.2：スーパー 5%・光る 80%・15まいの確定
    expect(n.gacha.superRate).toBe('5');
    expect(n.gacha.guaranteeBags).toEqual([15]);
    expect(n.deck).toEqual({ size: 15, superMax: 1, slots: 20 });
    expect(n.trade).toEqual({ kinds: 99, cards: 99 });
    expect(n.daily.resetHour).toBe(DAILY.resetHour);
    expect(n.daily.missions).toHaveLength(DAILY.missions.length);
    expect(n.story).toMatchObject({ stages: STORY.stages.length, bosses: 4, normalFirst: STORY.rewards.normal.first, bossAgain: STORY.rewards.boss.again });
  });

  for (const [name, dict] of [['にほんご', hira], ['日本語', kanji]] as const) {
    it(`${name}：どのモードも、短い説明は2〜3行、詳しい説明は1〜3ページ。主な数が文に入っている`, () => {
      const w = wordsOf(dict as typeof hira);
      const text = (mode: (typeof GUIDE_MODES)[number]) => {
        const g = dict.guide.modes[mode](n, w);
        expect(g.short.length, mode).toBeGreaterThanOrEqual(2);
        expect(g.short.length, mode).toBeLessThanOrEqual(3);
        expect(g.pages.length, mode).toBeGreaterThanOrEqual(1);
        expect(g.pages.length, mode).toBeLessThanOrEqual(3);
        for (const p of g.pages) {
          expect(p.title, mode).toBeTruthy();
          expect(p.lines.length, mode).toBeGreaterThan(0);
        }
        return JSON.stringify(g);
      };
      for (const mode of GUIDE_MODES) text(mode);
      const has = (mode: (typeof GUIDE_MODES)[number], ...nums: (string | number)[]) => {
        const t = text(mode);
        for (const x of nums) expect(t, `${mode} ${x}`).toMatch(new RegExp(`(^|[^0-9])${x}([^0-9]|$)`));
      };
      has('online', RATING.initial, ROOM_MAX, ECONOMY.onlineReward.friend, ECONOMY.minTurnsEach, ECONOMY.dailyRewardLimit);
      has('cpu', CPU_COUNT, ...n.cpu.levels.map((l) => l.coins));
      has('story', STORY.stages.length, STORY.rewards.normal.first, STORY.rewards.normal.again, STORY.rewards.boss.first, STORY.rewards.boss.again);
      has('gacha', ...DRAW.offers.map((o) => o.price), DRAW.superToCoins, '5', '15');
      has('deck', 15, 20);
      has('trade', 99);
      has('daily', DAILY.resetHour, DAILY.pick, DAILY.missions.length, DAILY.allClear.bags, DAILY.allClear.coins, ...DAILY.missions.map((m) => m.target));
      // CPU の強さの名前は、CPU 画面と同じ言葉
      for (const l of n.cpu.levels) expect(text('cpu')).toContain(dict.cpu.level[l.level]);
    });
  }
});

const CPU_COUNT = 4;
