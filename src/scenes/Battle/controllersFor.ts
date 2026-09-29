import type { BattleSetup } from '../../battle/setup';
import { type Controller, HumanController } from '../../controllers/types';
import type { Side } from '../../engine/types';

/** 対戦の種類 → 両者の Controller */
export function createControllers(setup: BattleSetup): Record<Side, Controller> {
  switch (setup.mode) {
    case 'local':
      return { p1: new HumanController('p1'), p2: new HumanController('p2') };
    default:
      throw new Error(`対戦の種類 ${setup.mode} はまだ つかえません`);
  }
}
