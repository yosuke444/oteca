import { useState } from 'react';
import type { Action, GameState, Side } from '../../engine/types';
import { useT } from '../../i18n/useT';
import { BattleCard } from '../../ui/card/BattleCard';
import { Dialog } from '../../ui/common/Dialog';
import { RoughButton } from '../../ui/rough/RoughButton';

/**
 * 「カードを選ぶ」パネル（SPEC §8-2・§4-5 ⑤。v2.0）。
 * 手札を捨てる・山札から選ぶ（ひきかえカード）・ベンチの誰と交代するか を、同じ部品で選ぶ。
 * 山札は順番が分からないよう、カードNo の順に並べる。
 */
export function ChoosePanel({ view, me, onSubmit, onDetail }: { view: GameState; me: Side; onSubmit: (a: Action) => void; onDetail: (uid: string) => void }) {
  const tr = useT();
  const pc = view.pendingChoice;
  const [picked, setPicked] = useState<string[]>([]);
  if (!pc || pc.player !== me) return null;
  const need = Math.min(pc.count, pc.options.length);
  const options = pc.kind === 'search' ? [...pc.options].sort((a, b) => view.cards[a].no - view.cards[b].no || (a < b ? -1 : 1)) : pc.options;
  const title = pc.kind === 'discard' ? tr.battle.choose.discard(need) : pc.kind === 'search' ? tr.battle.choose.search(need) : tr.battle.choose.switch;
  const toggle = (uid: string) =>
    setPicked((cur) => (cur.includes(uid) ? cur.filter((u) => u !== uid) : need === 1 ? [uid] : cur.length < need ? [...cur, uid] : cur));
  return (
    <Dialog
      seed={`choose-${pc.kind}`}
      title={title}
      width={1060}
      actions={
        <>
          <span className="choose-panel__count num">{tr.battle.choose.picked(picked.length, need)}</span>
          <RoughButton
            seed="choose-ok"
            highlight={picked.length === need}
            disabled={picked.length !== need}
            onClick={() => onSubmit({ type: 'CHOOSE', player: me, uids: picked })}
          >
            {tr.battle.choose.ok}
          </RoughButton>
        </>
      }
    >
      <div className={`choose-panel choose-panel--${pc.kind}`} data-testid="choose-panel">
        {options.map((uid) => {
          const card = view.cards[uid];
          const def = view.cardDefs[card.no];
          const on = picked.includes(uid);
          return (
            <button
              key={uid}
              type="button"
              className={`choose-panel__card ${on ? 'is-picked' : ''}`}
              aria-pressed={on}
              onClick={() => toggle(uid)}
              onContextMenu={(e) => {
                e.preventDefault();
                onDetail(uid);
              }}
            >
              <BattleCard def={def} card={card} size="hand" view={view} onField={pc.kind === 'switch'} highlight={on} selected={on} />
            </button>
          );
        })}
      </div>
      {pc.kind === 'search' && <p className="choose-panel__note pencil">{tr.battle.choose.deckNote}</p>}
    </Dialog>
  );
}
