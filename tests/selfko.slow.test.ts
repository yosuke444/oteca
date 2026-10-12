import { describe, expect, it } from 'vitest';
import { deckOf } from './helpers';

/**
 * 重いテスト（npm run test:slow）：v2.6 確認⑤ オンライン対戦で、自爆で両方が気絶する時の順番が両方の画面で同じ
 * （軽い方は tests/selfko.v26.test.ts の⑤。ここは本物の通信のつなぎ（セッション2つ・エンジン2つ・CPU）で確かめる）
 */

describe('⑤b オンライン対戦（2つのセッション・2つのエンジン、送るのは操作だけ）', () => {
  it('ばけあげ だけのデッキで CPU どうし：両方の端末のイベントの順番が同じ。自爆で両方HP0の場面も通る', async () => {
    const { playLockstep } = await import('./net.helpers');
    const deck = deckOf([['bakeage', 15]]);
    let deferredSeen = 0;
    for (let seed = 1; seed <= 12 && deferredSeen < 1; seed++) {
      const { sides, logs } = await playLockstep(seed, seed + 100, { deck });
      expect(sides.every((x) => x.match.state.phase === 'over')).toBe(true);
      expect(logs[0]).toEqual(logs[1]);
      // HP0 になってから気絶するまでの間に、相手の Promoted が入った（自爆した側の気絶が後回しになった）回数
      // 1回の攻撃（MoveSelected から次の TurnStarted まで）で2体が気絶し、その間に くりだし が入った回数
      // （相手の気絶 → 相手のくりだし → 自爆した側の気絶。相手が選ぶ時は、くりだしの操作を待ってから）
      const log = logs[0];
      for (let i = 0; i < log.length; i++) {
        if (log[i].type !== 'MoveSelected') continue;
        const endAt = log.findIndex((x, j) => j > i && (x.type === 'TurnStarted' || x.type === 'GameOver'));
        const part = log.slice(i, endAt < 0 ? undefined : endAt);
        const faints = part.map((x, k) => (x.type === 'Fainted' ? k : -1)).filter((k) => k >= 0);
        if (faints.length === 2 && part.slice(faints[0], faints[1]).some((x) => x.type === 'Promoted')) deferredSeen++;
      }
    }
    expect(deferredSeen).toBeGreaterThan(0);
  }, 600000);
});
