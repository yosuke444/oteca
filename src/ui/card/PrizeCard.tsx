import type { CardDef, CardInstance } from '../../engine/types';
import { BattleCard, CARD_SIZE, type CardSize } from './BattleCard';

/**
 * 手に入れたカード（v2.3）：対戦中と同じ縦長・イラスト付きのカード（BattleCard）を、そのまま使い回す。
 * 対戦の外なので、まっさらな1枚（HP 満タン・持続効果なし）として描き、決まった幅に合わせて拡大縮小する。
 * 幅 180 より小さい時は手札の大きさ（文字が大きめの並び）、大きい時はバトル場の大きさを元にする（844×390 でも名前とHPが読めるように）
 */
export function PrizeCard({ def, seed, width, className }: { def: CardDef; seed: string; width: number; className?: string }) {
  const size: CardSize = width >= 180 ? 'active' : 'hand';
  const base = CARD_SIZE[size];
  const k = width / base.w;
  const hp = def.kind === 'otege' ? def.hp : 0;
  const card: CardInstance = {
    uid: seed,
    no: def.no,
    owner: 'p1',
    hp,
    maxHp: hp,
    attackAdd: 0,
    attackOverride: null,
    itemsThisTurn: [],
    itemsUsed: [],
    benchedOnTurn: null,
  };
  return (
    <div className={`prize-card ${className ?? ''}`} style={{ width: base.w * k, height: base.h * k }} data-card-no={def.no}>
      <div className="prize-card__inner" style={{ width: base.w, height: base.h, transform: k === 1 ? undefined : `scale(${k})` }}>
        {/* 対戦の外：取り消し線（preview）・場の印（onField）を使わないので、場面の状態は渡さない */}
        <BattleCard def={def} card={card} size={size} />
      </div>
    </div>
  );
}
