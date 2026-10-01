import { it } from 'vitest';
import { ladder } from './ladderLib';

// C04 さいきょう vs つよい（200試合を10本に分けて並列で動かす。これは 41〜60試合め）
it('C04 さいきょう vs つよい 2', () => {
  ladder('strongest', 'strong', 20, 30);
});
