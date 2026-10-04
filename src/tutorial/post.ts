import raw from '../data/tutorial.json';
import type { LocalText } from '../engine/types';
import type { RouteId } from '../router';
import type { SaveData } from '../save/saveData';
import { DEFAULT_RULES } from '../engine/rules';

/**
 * チュートリアルの延長（UPDATE_v2_1 §6-2：#16〜#25）。対戦の後、メニュー → パックガチャ → デッキ編集 → メニュー と、
 * 本物の画面の上に案内を重ねて進める（src/scenes/Tutorial/PostGuide.tsx）。
 * ここは手順の決まり（どこを囲むか・いつ次へ進むか）と、進み具合の入れ物だけ。文は tutorial.json の post。
 */

/** 手順が進む条件を調べる時に渡すもの */
export type PostCtx = {
  route: RouteId;
  save: SaveData;
  /** 舞台（.stage）の中から要素を探す */
  has: (selector: string) => boolean;
  /** 見返し（見本）か */
  review: boolean;
  /** この手順に入った時の、いまのデッキの枚数 */
  enterLen: number;
};

export type PostStep = {
  id: string;
  /** UPDATE_v2_1 §6-2 の番号 */
  no: number;
  /** tap：吹き出しをタップで次へ／act：until がそろったら次へ（花丸） */
  kind: 'tap' | 'act';
  /** 囲む場所（CSS セレクタ。どれか見つかったものを全部囲む）。空なら囲まない（全部押せない） */
  spot: string[];
  /** 吹き出しの置き場所 */
  at: 'left' | 'right' | 'topLeft' | 'topRight' | 'bottomLeft' | 'bottomRight';
  /** act：次へ進む条件 */
  until?: (c: PostCtx) => boolean;
  /** この手順を出さない時（飛ばす） */
  skipIf?: (c: PostCtx) => boolean;
  /** この手順に入った時に、画面をここへ動かす */
  goTo?: RouteId;
};

type PostText = { id: string; text: LocalText };
const TEXTS = new Map((raw as unknown as { post: PostText[] }).post.map((p) => [p.id, p.text]));

/** 文（tutorial.json の post）。{coins} などは差し込む */
export function postText(id: string, lang: 'hira' | 'kanji', vars: Record<string, string | number> = {}): string {
  const t = TEXTS.get(id);
  if (!t) throw new Error(`tutorial.json の post に ${id} がありません`);
  return t[lang].replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ''));
}

const deckLen = (c: PostCtx) => c.save.decks[c.save.selectedDeck]?.cards.length ?? 0;
const DECK_SIZE = DEFAULT_RULES.deckSize;

/** #16〜#25（UPDATE_v2_1 §6-2） */
export const POST_STEPS: PostStep[] = [
  // 16 コインとパックガチャ
  { id: 'coins', no: 16, kind: 'act', spot: ['[data-testid="menu-gacha"]'], at: 'left', until: (c) => c.route === 'gacha' && c.has('[data-testid="gacha-scene"]'), goTo: 'menu' },
  // 17 パックの選び方・なかみ → 15まい
  { id: 'packs', no: 17, kind: 'tap', spot: ['[data-testid="gacha-pack"]', '.gacha-scene__arrow'], at: 'bottomLeft' },
  { id: 'buy', no: 17, kind: 'act', spot: ['[data-testid="gacha-buy-fifteen"]'], at: 'topLeft', until: (c) => c.has('[data-testid="gacha-opening"]') },
  // 18 袋の開け方・「つぎへ」
  {
    id: 'open',
    no: 18,
    kind: 'act',
    spot: ['.gacha-open__bags', '[data-testid="gacha-next"]', '.gacha-bag--center'],
    // 右下：袋の並び・「つぎへ」・真ん中の袋を隠さない所
    at: 'bottomRight',
    until: (c) => c.has('[data-testid="gacha-summary"]'),
  },
  // 19 まとめの見方 → デッキへんしゅうへ
  { id: 'summary', no: 19, kind: 'tap', spot: ['.gacha-summary__grid'], at: 'bottomLeft' },
  // 換金できるスーパーおてあげがあれば、ここで換金もできる（換金のボタンと確認も押せる。換金しても次へは進まない）
  { id: 'toDeck', no: 19, kind: 'act', spot: ['[data-testid="gacha-tutorial-deck"]', '.gacha-summary__convert', '.dialog'], at: 'topLeft', until: (c) => c.route === 'deck' && c.has('.deck-scene') },
  // 20 デッキ選択パネルと「はじめての デッキ」
  { id: 'picker', no: 20, kind: 'act', spot: ['[data-testid="deck-pick"]'], at: 'bottomLeft', until: (c) => c.has('[data-testid="deck-slot-0"]'), goTo: 'deck' },
  { id: 'first', no: 20, kind: 'act', spot: ['[data-testid="deck-slot-0"]'], at: 'right', until: (c) => !c.has('[data-testid="deck-slot-0"]') && c.save.selectedDeck === 0 },
  // 21 カードいちらんの見方（持っているカードだけが並ぶ。v2.2）
  { id: 'list', no: 21, kind: 'tap', spot: ['.list-panel__grid'], at: 'bottomLeft' },
  // 22 デッキから外す（入った時より1枚減ったら）
  { id: 'remove', no: 22, kind: 'act', spot: ['.deck-panel__slots'], at: 'right', until: (c) => deckLen(c) < c.enterLen },
  // 23 デッキに入れる（NEW のカード。入った時より1枚増えたら）
  { id: 'add', no: 23, kind: 'act', spot: ['.list-panel__grid'], at: 'bottomLeft', until: (c) => deckLen(c) > c.enterLen },
  // 23 のあと 16まい以上なら 1まい外す
  { id: 'back15', no: 23, kind: 'act', spot: ['.deck-panel__slots'], at: 'right', until: (c) => deckLen(c) < c.enterLen, skipIf: (c) => deckLen(c) <= DECK_SIZE },
  // 24 デッキの決まり（スーパーを2種類以上引いた時は補足）
  { id: 'rules', no: 24, kind: 'tap', spot: [], at: 'bottomLeft' },
  // 25 メニューの紹介
  { id: 'menu', no: 25, kind: 'tap', spot: [], at: 'right', goTo: 'menu' },
  { id: 'tourOnline', no: 25, kind: 'tap', spot: ['[data-testid="menu-online"]'], at: 'right' },
  { id: 'tourCpu', no: 25, kind: 'tap', spot: ['.menu-scene__cpu', '.menu-scene__locked--story'], at: 'left' },
  { id: 'tourGacha', no: 25, kind: 'tap', spot: ['.menu-scene__locked--gacha', '.menu-scene__locked--trade'], at: 'left' },
  { id: 'tourDaily', no: 25, kind: 'tap', spot: ['.daily-icon'], at: 'left' },
  { id: 'end', no: 25, kind: 'tap', spot: [], at: 'left' },
];

/** 見返しでは、デッキ編集から先（#20〜）で使う番号 */
export const POST_DECK_START = POST_STEPS.findIndex((s) => s.id === 'picker');

/** tutorial.step の値（UPDATE_v2_1 §7）。0＝はじめから、1＝アップデートの おしらせ で「やる」を選んだ（ことば・なまえを出さない）、16・20＝延長の再開位置 */
export const STEP_FROM_NOTICE = 1;

/** セーブの tutorial.step：16＝ガチャの案内から、20＝デッキ編集の案内から（それより前の対戦の分は null） */
export function resumeIndex(step: number): number | null {
  if (step >= 20) return POST_DECK_START;
  if (step >= 16) return 0;
  return null;
}

/**
 * タイトルを押した時の行き先（UPDATE_v2_1 §6-1・§7）。
 * もう終えた・今までのプレイヤー（おしらせ を見ていない）はメニュー。延長の途中で閉じた人は再開（ガチャから再開でもコインが足りなければデッキ編集から）。
 * おしらせ で「やる」を選んで対戦の途中で閉じた人は、ことば・なまえ を出さずにチュートリアル。新しい人は ことば から
 */
export function titleNext(t: { done: boolean; step: number }, updateNoticeSeen: boolean, coins: number, price: number): { go: 'menu' | 'deck' | 'lang' | 'tutorial'; post?: number } {
  if (t.done || !updateNoticeSeen) return { go: 'menu' };
  const resume = resumeIndex(t.step);
  if (resume !== null) {
    const index = resume < POST_DECK_START && coins < price ? POST_DECK_START : resume;
    return { go: index >= POST_DECK_START ? 'deck' : 'menu', post: index };
  }
  if (t.step === STEP_FROM_NOTICE) return { go: 'tutorial' };
  return { go: 'lang' };
}

/** 今の手順の番号から、セーブに書く tutorial.step（途中で閉じた時の再開位置） */
export function stepForSave(index: number): number {
  return index >= POST_DECK_START ? 20 : 16;
}

// ---------------------------------------------------------------- 進み具合（画面をまたぐので、画面の外に置く）

export type PostState = {
  active: boolean;
  index: number;
  /** 見本で進める（ガチャは見本、デッキは練習用の写し）：見返しの時と、初めてでも 15まい を引くコインが無い時 */
  review: boolean;
  /** 初めて（まだチュートリアルを終えていない）：終えた・とばした時に本物のセーブに印を書く */
  first: boolean;
  /** ガチャで引いたスーパーおてあげの種類の数（#24 の補足） */
  supers: number;
  /** ガチャで初めて手に入れたカード（デッキ編集の一覧に NEW の印。#21・#23） */
  newCards: number[];
};

let state: PostState = { active: false, index: 0, review: false, first: false, supers: 0, newCards: [] };
const subs = new Set<(s: PostState) => void>();

export function postState(): PostState {
  return state;
}

export function setPostState(patch: Partial<PostState>): void {
  state = { ...state, ...patch };
  for (const f of subs) f(state);
}

export function subscribePost(f: (s: PostState) => void): () => void {
  subs.add(f);
  return () => void subs.delete(f);
}

/** #16 から（または index から）始める */
export function startPost(review: boolean, first: boolean, index = 0): void {
  setPostState({ active: true, index, review, first, supers: 0, newCards: [] });
}

export function endPost(): void {
  setPostState({ active: false, index: 0, review: false, first: false, supers: 0, newCards: [] });
}
