import { it } from 'vitest';
import { ladder } from './ladderLib';

// C04 さいきょう vs つよい（200試合を10本に分けて並列で動かす。これは 101〜120試合め）
it('C04 さいきょう vs つよい 5', () => {
  ladder('strongest', 'strong', 50, 60);
});
