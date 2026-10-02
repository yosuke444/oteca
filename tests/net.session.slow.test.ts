import { describe, expect, it } from 'vitest';
import { hashState } from '../src/engine';
import { playLockstep } from './net.helpers';

/** 重いテスト（npm run test:slow）：2つの端末（セッション＋エンジン）で決着まで対戦する（SPEC §11-3） */

describe('オンライン：ロックステップ（重い）', () => {
  it('通信なしで2つのエンジンを動かすと、最後まで状態ハッシュが一致する（3試合）', async () => {
    for (let i = 0; i < 3; i++) {
      const { sides, a, b } = await playLockstep(10 + i, 20 + i);
      const [x, y] = sides;
      expect(x.match.state.phase).toBe('over');
      expect(y.match.state.phase).toBe('over');
      expect(hashState(x.match.state)).toBe(hashState(y.match.state));
      expect(x.match.log).toEqual(y.match.log);
      expect(x.match.rejected).toEqual([]);
      expect(y.match.rejected).toEqual([]);
      expect(a.desync).toEqual([]);
      expect(b.desync).toEqual([]);
    }
  }, 60000);

  it('状態ハッシュが違えば「ずれ」を知らせる', async () => {
    const { a, b } = await playLockstep(3, 4, { tamper: true });
    expect(a.desync).toHaveLength(1);
    // 片方だけが気づいても、相手にも知らせて両方で止まる
    expect(b.desync).toHaveLength(1);
  }, 60000);
});
