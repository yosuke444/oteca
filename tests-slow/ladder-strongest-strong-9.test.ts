import { it } from 'vitest';
import { ladder } from './ladderLib';

// C04 さいきょう vs つよい（200試合を10本に分けて並列で動かす。これは 181〜200試合め）
it('C04 さいきょう vs つよい 9', () => {
  ladder('strongest', 'strong', 90, 100);
});
