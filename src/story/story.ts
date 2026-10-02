import { CARD_DB, cardById } from '../data/cards';
import storyRaw from '../data/story.json';
import type { CpuLevel } from '../cpu/brains';
import { addCoins } from '../economy/rewards';
import type { LocalText, RuleSet, Side } from '../engine/types';
import { OWN_MAX, type SaveData, type StoryStage } from '../save/saveData';

/**
 * ストーリーモード（UPDATE_v2 §7・SPEC §7 S08）の決まり。画面にも通信にも関係しない、ふつうの処理だけ。
 * ステージ・敵デッキ・ボスルール・報酬の数は src/data/story.json にある。
 */

export type StageKind = 'normal' | 'boss';
export type BossId = 'ningen' | 'usagi' | 'zamurai' | 'dragon';

export type StageDef = {
  no: number;
  kind: StageKind;
  /** 敵の名前（固有名詞なので言語で変えない） */
  name: string;
  theme: LocalText;
  /** 前のステージ（どれか1つをクリアすると行ける） */
  after: number[];
  /** 木の中の位置 */
  x: number;
  y: number;
  /** [カード id, 枚数] */
  deck: [string, number][];
  boss?: BossId;
  /** ボスの初クリアで手に入る限定カードの id */
  card?: string;
  bossRule?: { text: LocalText; boss?: Partial<RuleSet>; player?: Partial<RuleSet> };
};

export type StoryData = {
  version: number;
  map: { height: number };
  levels: Record<StageKind, CpuLevel>;
  rewards: Record<StageKind, { first: number; again: number }>;
  stages: StageDef[];
};

export const STORY = storyRaw as unknown as StoryData;

/** ストーリーでは、自分が p1（下）、敵が p2 */
export const PLAYER: Side = 'p1';
export const ENEMY: Side = 'p2';

export function stageByNo(no: number, data: StoryData = STORY): StageDef | undefined {
  return data.stages.find((s) => s.no === no);
}

/** 敵デッキ → カードNo の配列 */
export function stageDeckNos(stage: StageDef): number[] {
  const out: number[] = [];
  for (const [id, n] of stage.deck) {
    const def = cardById(id);
    if (!def) throw new Error(`story.json：ステージ ${stage.no} のカード ${id} が cards.json にありません`);
    for (let i = 0; i < n; i++) out.push(def.no);
  }
  return out;
}

/** 敵の強さ（雑魚は ふつう、ボスは つよい） */
export function stageLevel(stage: StageDef, data: StoryData = STORY): CpuLevel {
  return data.levels[stage.kind];
}

/** ボスルール → プレイヤー別のルール（エンジンに渡す） */
export function stageRules(stage: StageDef): Partial<Record<Side, Partial<RuleSet>>> | undefined {
  const r = stage.bossRule;
  if (!r) return undefined;
  return { [PLAYER]: { ...r.player }, [ENEMY]: { ...r.boss } };
}

function recordOf(save: Pick<SaveData, 'story'>, no: number): StoryStage | undefined {
  return save.story.stages.find((s) => s.no === no);
}

export function isCleared(save: Pick<SaveData, 'story'>, no: number): boolean {
  return !!recordOf(save, no)?.cleared;
}

/** 行けるか：前のステージが無い、または前のステージのどれかをクリアしている */
export function isUnlocked(save: Pick<SaveData, 'story'>, no: number, data: StoryData = STORY): boolean {
  const st = stageByNo(no, data);
  if (!st) return false;
  return st.after.length === 0 || st.after.some((a) => isCleared(save, a));
}

export type StageState = 'locked' | 'open' | 'cleared';

export function stageState(save: Pick<SaveData, 'story'>, no: number, data: StoryData = STORY): StageState {
  if (isCleared(save, no)) return 'cleared';
  return isUnlocked(save, no, data) ? 'open' : 'locked';
}

/** このステージをクリアすると新しく行けるようになるステージ（まだ行けないもの） */
export function opensAfter(save: Pick<SaveData, 'story'>, no: number, data: StoryData = STORY): number[] {
  return data.stages.filter((s) => s.after.includes(no) && !isUnlocked(save, s.no, data)).map((s) => s.no);
}

export type StoryReward = {
  /** 初クリアの報酬か */
  first: boolean;
  /** もらうコイン（上限で減った後の数） */
  coins: number;
  /** もらう限定カードの No（無ければ null） */
  cardNo: number | null;
};

/** 勝った時の報酬（表示用。保存はしない） */
export function storyReward(save: Pick<SaveData, 'story' | 'coins'>, stage: StageDef, coinsMax: number, data: StoryData = STORY): StoryReward {
  const first = !recordOf(save, stage.no)?.firstClear;
  const table = data.rewards[stage.kind];
  const coins = Math.max(0, Math.min(first ? table.first : table.again, coinsMax - save.coins));
  const cardNo = first && stage.card ? (cardById(stage.card)?.no ?? null) : null;
  return { first, coins, cardNo };
}

/**
 * 対戦の結果をセーブの下書きに書く（クリアの印・コイン・限定カードを同じ保存で）。負けは何もしない。
 * @returns もらった報酬（負けは null）
 */
export function applyStoryResult(draft: Pick<SaveData, 'story' | 'coins' | 'collection'>, stageNo: number, win: boolean, data: StoryData = STORY): StoryReward | null {
  const stage = stageByNo(stageNo, data);
  if (!stage || !win) return null;
  const first = !recordOf(draft, stageNo)?.firstClear;
  const table = data.rewards[stage.kind];
  const before = draft.coins;
  addCoins(draft, first ? table.first : table.again);
  let cardNo: number | null = null;
  if (first && stage.card) {
    const def = cardById(stage.card);
    if (def) {
      const before = draft.collection[def.no] ?? 0;
      draft.collection[def.no] = Math.min(OWN_MAX, before + 1);
      // 所持数が上限で増えなかった時は「手に入れた」にしない（演出も出さない）
      if (draft.collection[def.no] > before) cardNo = def.no;
    }
  }
  const rec = recordOf(draft, stageNo);
  if (rec) {
    rec.cleared = true;
    rec.firstClear = true;
  } else {
    draft.story.stages.push({ no: stageNo, cleared: true, firstClear: true });
    draft.story.stages.sort((a, b) => a.no - b.no);
  }
  return { first, coins: draft.coins - before, cardNo };
}

/** ボスの絵（public/story/boss_<id>.png） */
export function bossImagePath(boss: BossId): string {
  return `story/boss_${boss}.png`;
}

/** カードの定義（限定カードの表示用） */
export function limitedCard(stage: StageDef) {
  const def = stage.card ? cardById(stage.card) : undefined;
  return def ? CARD_DB[def.no] : null;
}
