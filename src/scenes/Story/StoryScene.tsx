import { useEffect, useState } from 'react';
import { audio } from '../../audio/audioManager';
import { type BattleSetup, randomSeed } from '../../battle/setup';
import { useFx } from '../../fx/fxSettings';
import { setFxSpeed } from '../../fx/timing';
import { local } from '../../i18n';
import { useLang, useT } from '../../i18n/useT';
import { useNav } from '../../router';
import { usableDecks } from '../../save/collection';
import { useSave } from '../../state/SaveContext';
import { cardById } from '../../data/cards';
import { STORY, type StageDef, type StageState, stageByNo, stageDeckNos, stageLevel, stageRules, stageState, storyReward } from '../../story/story';
import { ECONOMY } from '../../economy/rewards';
import { CoinCounter } from '../../ui/coin/Coin';
import { Dialog } from '../../ui/common/Dialog';
import { DeckPickerDialog } from '../../ui/deck/DeckPicker';
import { RoughBox } from '../../ui/rough/RoughBox';
import { RoughButton } from '../../ui/rough/RoughButton';
import { BossArt, BossCutin } from './BossCutin';
import { StoryMap } from './StoryMap';
import { ModeGuide } from '../../ui/guide/ModeGuide';
import './story.css';

/** リザルトから戻る時に渡すもの：クリアしたステージと、それで新しく開いたステージ（線を描く演出に使う） */
export type StoryPayload = { justCleared?: number; opened?: number[]; retry?: number } | null;

/**
 * S08 ストーリー（UPDATE_v2 §7・UPDATE_v2_1 §4・SPEC §7 S08）：ステージ選択（マップ）→ 確認カード →（ボスはカットイン）→ 対戦。
 * マップは画面より大きいので、上下左右にドラッグ（スワイプ）して動かし、ホイール・2本指で拡大縮小する（StoryMap）。
 */
export function StoryScene() {
  const { go, payload } = useNav();
  const back = payload as StoryPayload;
  const { save, update } = useSave();
  const tr = useT();
  const fx = useFx();
  const [picked, setPicked] = useState<StageDef | null>(null);
  const [cutin, setCutin] = useState<{ stage: StageDef; setup: BattleSetup } | null>(null);
  // 新しく開いたステージは、線が描き終わるまで「まだ行けない」の見た目にしておく
  const [hold, setHold] = useState<Set<number>>(() => new Set(back?.opened ?? []));
  const [shakeLock, setShakeLock] = useState<{ no: number; n: number } | null>(null);

  useEffect(() => setFxSpeed(fx.speed), [fx.speed]);

  const stateOf = (no: number): StageState => (hold.has(no) ? 'locked' : stageState(save, no));
  // 開いた時にまんなかに来るステージ：戻ってきた時はクリアしたステージ、それ以外は「行ける」ステージの中でいちばん新しいもの
  const [focus] = useState(() => back?.justCleared ?? [...STORY.stages].reverse().find((s) => stageState(save, s.no) === 'open')?.no ?? STORY.stages[0].no);

  // ボスに負けて「もういちど ちょうせん」：カットインから始める
  useEffect(() => {
    const st = back?.retry ? stageByNo(back.retry) : undefined;
    if (st && stateOf(st.no) !== 'locked') start(st);
  }, []);

  const pick = (st: StageDef) => {
    if (stateOf(st.no) === 'locked') {
      audio.play('se_error');
      setShakeLock((s) => ({ no: st.no, n: (s?.n ?? 0) + 1 }));
      return;
    }
    audio.play('se_page');
    setPicked(st);
  };

  function start(st: StageDef) {
    const deck = save.decks[save.selectedDeck];
    const setup: BattleSetup = {
      mode: 'cpu',
      cpuLevel: stageLevel(st),
      decks: { p1: deck.cards, p2: stageDeckNos(st) },
      names: { p1: save.playerName, p2: st.name },
      seed: randomSeed(),
      me: 'p1',
      // CPU対戦の勝敗には数えない（報酬はリザルトでストーリーの分を）
      record: false,
      rules: stageRules(st),
      story: { stage: st.no },
    };
    setPicked(null);
    if (st.kind === 'boss') setCutin({ stage: st, setup });
    else go('battle', setup);
  }

  return (
    <div className="story-scene" data-testid="story-scene">
      <StoryMap
        stateOf={stateOf}
        focus={focus}
        fresh={back?.justCleared ?? null}
        drawing={back?.justCleared ? { from: back.justCleared, opened: back.opened ?? [] } : null}
        shake={shakeLock}
        onPick={pick}
        onDrawn={() => setHold(new Set())}
      />
      <h1 className="story-scene__title">{tr.story.title}</h1>
      <CoinCounter value={save.coins} className="story-scene__coins" />
      <RoughButton seed="story-back" className="story-scene__back" onClick={() => go('menu')}>
        {tr.common.back}
      </RoughButton>
      <p className="story-scene__hint pencil">{tr.story.dragHint}</p>
      <ModeGuide mode="story" className="story-scene__guide" />

      {picked && (
        <StageConfirm
          stage={picked}
          onClose={() => setPicked(null)}
          onStart={() => start(picked)}
          onPickDeck={(i) => update((d) => void (d.selectedDeck = i))}
        />
      )}

      {cutin && <BossCutin stage={cutin.stage} onDone={() => go('battle', cutin.setup)} />}
    </div>
  );
}

/** 確認カード：敵の名前・テーマ・強さ・ボスルール・報酬、自分のデッキ（デッキを かえる）→ ちょうせん！ */
function StageConfirm({ stage, onClose, onStart, onPickDeck }: { stage: StageDef; onClose: () => void; onStart: () => void; onPickDeck: (i: number) => void }) {
  const tr = useT();
  const lang = useLang();
  const { save } = useSave();
  const [picking, setPicking] = useState(false);
  const reward = storyReward(save, stage, ECONOMY.coinsMax);
  const table = STORY.rewards[stage.kind];
  const cardName = stage.card ? (cardById(stage.card)?.name ?? '') : '';
  const deckOk = usableDecks(save)[save.selectedDeck];
  const deck = save.decks[save.selectedDeck];
  return (
    <>
      <Dialog
        seed={`stage-confirm-${stage.no}`}
        title={`${tr.story.stageNo(stage.no)}  ${stage.name}`}
        width={820}
        onClose={onClose}
        actions={
          <>
            <RoughButton seed="stage-cancel" onClick={onClose}>
              {tr.common.back}
            </RoughButton>
            <RoughButton seed="stage-deck" onClick={() => setPicking(true)} data-testid="stage-change-deck">
              {tr.story.changeDeck}
            </RoughButton>
            <RoughButton seed="stage-go" highlight={deckOk} disabled={!deckOk} strokeWidth={3} onClick={onStart} data-testid="stage-go">
              {tr.story.go}
            </RoughButton>
          </>
        }
      >
        <div className={`stage-confirm stage-confirm--${stage.kind}`} data-testid="stage-confirm">
          <div className="stage-confirm__art">
            {stage.kind === 'boss' && stage.boss ? (
              <BossArt boss={stage.boss} name={stage.name} />
            ) : (
              <RoughBox seed={`confirm-${stage.no}`} className="stage-confirm__frame" stroke="var(--pen-green)" strokeWidth={3} paper radius={8} />
            )}
          </div>
          <dl className="stage-confirm__list">
            <dt>{tr.story.theme}</dt>
            <dd>{local(stage.theme, lang)}</dd>
            <dt>{tr.story.strength}</dt>
            <dd className={stage.kind === 'boss' ? 'red-pen' : ''}>{tr.story.level[stageLevel(stage)]}</dd>
            {stage.bossRule && (
              <>
                <dt>{tr.story.rule}</dt>
                <dd className="red-pen stage-confirm__rule">{local(stage.bossRule.text, lang)}</dd>
              </>
            )}
            <dt>{tr.story.reward}</dt>
            <dd>
              {reward.first ? tr.story.rewardFirst(table.first) : tr.story.rewardAgain(table.again)}
              {reward.first && cardName && <span className="stage-confirm__card blue-pen">{tr.story.rewardCard(cardName)}</span>}
            </dd>
          </dl>
          <p className={`stage-confirm__deck ${deckOk ? '' : 'red-pen'}`}>{deckOk ? tr.story.myDeck(deck.name) : tr.story.badDeck}</p>
        </div>
      </Dialog>
      {picking && (
        <DeckPickerDialog
          save={save}
          current={save.selectedDeck}
          mode="battle"
          title={tr.story.changeDeck}
          onPick={(i) => {
            onPickDeck(i);
            setPicking(false);
          }}
          onClose={() => setPicking(false)}
        />
      )}
    </>
  );
}

