import { it } from 'vitest';
import { ladder } from './ladderLib';

// C04 ふつう vs よわい（200試合）
it('C04 ふつう vs よわい', () => {
  ladder('normal', 'weak', 0, 100);
});
