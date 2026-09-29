import type { BattleSetup } from '../../battle/setup';
import { CPU_THINK_MS, CpuController } from '../../controllers/cpu';
import { RemoteController } from '../../controllers/remote';
import { type Controller, HumanController } from '../../controllers/types';
import type { Side } from '../../engine/types';

/**
 * 対戦の種類 → 両者の Controller（SPEC §13-3）
 * @param speed 演出スピードの倍率（CPU の考える時間もこれで割る）
 */
export function createControllers(setup: BattleSetup, speed: () => number = () => 1): Record<Side, Controller> {
  const other: Side = setup.me === 'p1' ? 'p2' : 'p1';
  const human = new HumanController(setup.me);
  switch (setup.mode) {
    case 'local':
      return { p1: new HumanController('p1'), p2: new HumanController('p2') };
    case 'cpu': {
      const cpu = new CpuController(other, (fn) => setTimeout(fn, CPU_THINK_MS / speed()));
      return setup.me === 'p1' ? { p1: human, p2: cpu } : { p1: cpu, p2: human };
    }
    case 'online': {
      // フレンド対戦：相手の操作は通信で届く（届け役は useOnlineBattle）
      const remote = new RemoteController(other);
      return setup.me === 'p1' ? { p1: human, p2: remote } : { p1: remote, p2: human };
    }
  }
}
