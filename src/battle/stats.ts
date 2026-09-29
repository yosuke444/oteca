import type { GameEvent, GameState, Side } from '../engine/types';

/** リザルトの集計（SPEC §7 S05） */
export type SideStats = {
  /** 与えたダメージの合計 */
  damage: number;
  /** 倒した数 */
  kos: number;
  /** 一番ダメージを与えたおてあげ（カードNo）。いなければ null */
  mvpNo: number | null;
  mvpDamage: number;
};

export type MatchStats = {
  /** 通算ターン数 */
  turns: number;
  sides: Record<Side, SideStats>;
};

/** 試合のイベント全部から集計する */
export class StatsCollector {
  private attacker: string | null = null;
  private readonly byCard = new Map<string, number>();
  private readonly damage: Record<Side, number> = { p1: 0, p2: 0 };

  add(events: GameEvent[], state: GameState): void {
    for (const e of events) {
      if (e.type === 'MoveSelected') this.attacker = e.uid;
      if (e.type === 'TurnEnded') this.attacker = null;
      if (e.type === 'Damaged') {
        const target = state.cards[e.uid];
        const from = this.attacker ? state.cards[this.attacker] : null;
        // 技で相手に与えたダメージだけを数える
        if (target && from && from.owner !== target.owner) {
          this.damage[from.owner] += e.amount;
          this.byCard.set(from.uid, (this.byCard.get(from.uid) ?? 0) + e.amount);
        }
      }
    }
  }

  result(state: GameState): MatchStats {
    const sideStats = (side: Side): SideStats => {
      let mvp: string | null = null;
      let best = 0;
      for (const [uid, dmg] of this.byCard) {
        if (state.cards[uid]?.owner === side && dmg > best) {
          best = dmg;
          mvp = uid;
        }
      }
      return {
        damage: this.damage[side],
        kos: state.players[side].koCount,
        mvpNo: mvp ? state.cards[mvp].no : null,
        mvpDamage: best,
      };
    };
    return { turns: state.turnNumber, sides: { p1: sideStats('p1'), p2: sideStats('p2') } };
  }
}
