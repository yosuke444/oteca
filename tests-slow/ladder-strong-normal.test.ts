import { it } from 'vitest';
import { ladder } from './ladderLib';

// C04 つよい vs ふつう（200試合）
it('C04 つよい vs ふつう', () => {
  ladder('strong', 'normal', 0, 100);
});
