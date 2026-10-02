import { cardById } from '../data/cards';
import tutorialRaw from '../data/tutorial.json';
import { validateAction } from '../engine';
import type { GameConfig } from '../engine/setup';
import type { Action, CardDb, GameState, LocalText, Side } from '../engine/types';
import type { CpuLevel } from '../cpu/brains';

/**
 * チュートリアルの台本を進める係（UPDATE_v2 §6T・SPEC §7 S13）。
 * 画面（React）にも通信にも関係しない、ふつうの処理だけ。自動テストでもこのまま使う。
 * 決めておく結果（サイコロの目・山札の順番・相手の操作）は src/data/tutorial.json にある。
 * エンジンには「サイコロの目の列（forcedDice）」と「山札を切らない（noShuffle）」を対戦の設定として渡すだけ（エンジンは純粋なまま）。
 */

/** 案内を出す・進める条件。turn：その人のメインの番。promote：その人が くりだしを選ぶ番 */
export type StepCond = { turn?: 'me' | 'opp'; promote?: 'me' | 'opp' };

/** 操作の型紙。書いた項目だけ一致を見る */
export type ActionPattern = { type: Action['type']; uid?: string; benchUid?: string; targetUid?: string };

export type StepKind =
  /** タップで次へ */
  | 'tap'
  /** 先攻決めのサイコロをタップ */
  | 'dice'
  /** カードを長押しして詳しく見る */
  | 'longPress'
  /** 決めた操作をしてもらう */
  | 'act'
  /** 見るだけ（until になったら次へ） */
  | 'watch';

export type TutorialStep = {
  id: string;
  /** UPDATE_v2 §6T-4 の表の番号 */
  no: number;
  kind: StepKind;
  text: LocalText;
  /** 囲む場所（card:<uid>・zone:<data-zone>・end・dice・draw） */
  spot?: string[];
  allow?: ActionPattern[];
  /** この条件になってから案内を出す */
  when?: StepCond;
  /** watch：この条件になったら次へ */
  until?: StepCond;
};

export type TutorialData = {
  decks: { me: string[]; opp: string[] };
  dice: number[];
  oppScript: ActionPattern[];
  steps: TutorialStep[];
};

export const TUTORIAL = tutorialRaw as unknown as TutorialData;

/** 台本では自分は p1（下）、相手は p2 */
export const ME: Side = 'p1';
export const OPP: Side = 'p2';

/** カード id の列 → カードNo の列 */
export function deckNos(ids: string[]): number[] {
  return ids.map((id) => {
    const def = cardById(id);
    if (!def) throw new Error(`tutorial.json：カード ${id} が cards.json にありません`);
    return def.no;
  });
}

/** 台本で決めておく対戦の中身（画面の対戦設定と、自動テストの両方がこれを使う） */
export function tutorialMatch(data: TutorialData = TUTORIAL): Pick<GameConfig, 'forcedDice' | 'noShuffle'> & { decks: Record<Side, number[]> } {
  return {
    decks: { p1: deckNos(data.decks.me), p2: deckNos(data.decks.opp) },
    forcedDice: [...data.dice],
    noShuffle: true,
  };
}

/** チュートリアルの対戦の設定（エンジンに渡す） */
export function tutorialConfig(cardDb: CardDb, seed: string, data: TutorialData = TUTORIAL): GameConfig {
  return { seed, cardDb, ...tutorialMatch(data) };
}

/** CPU の考え方（CpuHooks.think と同じ形） */
export type ThinkFn = (level: CpuLevel, state: GameState, side: Side, noSwap: boolean) => Promise<Action | null> | Action | null;

/**
 * チュートリアルの相手の考え方：案内を読んでいる間は待ち、台本があれば台本の操作、終わったら ふつうの考え方（fallback）。
 * @param current いまの正式な状態（待っている間に進んだ時のため）
 */
export function tutorialThink(driver: TutorialDriver, current: () => GameState | null, fallback: ThinkFn): ThinkFn {
  return async (level, state, side, noSwap) => {
    await driver.waitCpu(() => current() ?? state);
    const now = current() ?? state;
    return driver.oppAction(now) ?? fallback(level, now, side, noSwap);
  };
}

/** 条件に合っているか */
export function condMet(c: StepCond | undefined, s: GameState): boolean {
  if (!c) return true;
  const side = (w: 'me' | 'opp') => (w === 'me' ? ME : OPP);
  if (c.turn && !(s.phase === 'main' && s.currentPlayer === side(c.turn))) return false;
  if (c.promote && !(s.phase === 'promote' && s.pendingPromote.includes(side(c.promote)))) return false;
  return true;
}

/** 操作が型紙に合うか */
export function matches(p: ActionPattern, a: Action): boolean {
  if (p.type !== a.type) return false;
  const rec = a as Record<string, unknown>;
  if (p.uid !== undefined && rec.uid !== p.uid) return false;
  if (p.benchUid !== undefined && rec.benchUid !== p.benchUid) return false;
  if (p.targetUid !== undefined && rec.targetUid !== p.targetUid) return false;
  return true;
}

/** 型紙 → 本物の操作（相手の台本用。player を入れる） */
export function toAction(p: ActionPattern, player: Side): Action {
  return { ...p, player } as Action;
}

/** 進み具合が変わった時に知らせる中身 */
export type DriverEvent = { kind: 'step'; index: number } | { kind: 'good'; spot: string[] };

export class TutorialDriver {
  private _index = 0;
  private oppIndex = 0;
  private readonly listeners = new Set<(e: DriverEvent) => void>();
  /** 相手（CPU）の操作を待たせている間の待ち手 */
  private cpuWaiters: (() => void)[] = [];
  /** 長押しして詳しく見た（閉じたら次へ） */
  private pressed = false;

  constructor(readonly data: TutorialData = TUTORIAL) {}

  get index(): number {
    return this._index;
  }

  /** 今の手順（全部終わったら null＝自由に対戦） */
  get step(): TutorialStep | null {
    return this.data.steps[this._index] ?? null;
  }

  /** 案内が全部終わって、自由に対戦している */
  get free(): boolean {
    return this.step === null;
  }

  subscribe(fn: (e: DriverEvent) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(e: DriverEvent): void {
    for (const fn of this.listeners) fn(e);
  }

  /** 次の手順へ */
  advance(): void {
    if (!this.step) return;
    this._index += 1;
    this.pressed = false;
    this.emit({ kind: 'step', index: this._index });
    this.releaseCpu();
  }

  /** 今の手順の案内を出してよいか（演出が終わっていて、when の条件に合う） */
  visible(s: GameState): boolean {
    const st = this.step;
    return !!st && condMet(st.when, s);
  }

  /**
   * 相手（CPU）を待たせるか：タップ・サイコロ・長押しの案内を出している間は、相手は動かない
   * （説明を読んでいる間に、場面が先へ進まないように）
   */
  holdsCpu(s: GameState): boolean {
    const st = this.step;
    if (!st || !this.visible(s)) return false;
    if (st.kind === 'tap' || st.kind === 'dice' || st.kind === 'longPress') return true;
    // 準備（バトル場を裏向きで決める）は、自分が置いてから相手が置く（相手の演出の間に押したカードが無視されないように）
    return st.kind === 'act' && s.phase === 'setup';
  }

  /** CPU が動いてよくなるまで待つ */
  waitCpu(s: () => GameState): Promise<void> {
    if (!this.holdsCpu(s())) return Promise.resolve();
    return new Promise((resolve) => {
      const check = () => {
        if (this.holdsCpu(s())) this.cpuWaiters.push(check);
        else resolve();
      };
      this.cpuWaiters.push(check);
    });
  }

  private releaseCpu(): void {
    const ws = this.cpuWaiters;
    this.cpuWaiters = [];
    for (const w of ws) w();
  }

  /** 自分が今してよい操作か（案内中は決めた操作だけ。案内が終われば何でも） */
  allows(a: Action, s: GameState): boolean {
    if (a.player !== ME) return true;
    const st = this.step;
    if (!st) return true;
    if (st.kind !== 'act' || !this.visible(s)) return false;
    return (st.allow ?? []).some((p) => matches(p, a));
  }

  /** 操作が通った（match.submit のあと）。決めた操作なら花丸を出して次へ */
  applied(a: Action, before: GameState): void {
    // 相手の台本は、実際に通った時に1つ進める（CPU が考え直しても飛ばさないように）
    const next = this.data.oppScript[this.oppIndex];
    if (a.player === OPP && next && matches(next, a)) this.oppIndex += 1;
    const st = this.step;
    if (!st || a.player !== ME || st.kind !== 'act') return;
    if (!condMet(st.when, before) || !(st.allow ?? []).some((p) => matches(p, a))) return;
    this.emit({ kind: 'good', spot: st.spot ?? [] });
    this.advance();
  }

  /** watch：条件になったら次へ（画面は演出が終わるたびに呼ぶ） */
  idle(s: GameState): void {
    const st = this.step;
    if (st?.kind === 'watch' && condMet(st.until, s)) this.advance();
    else this.releaseCpu();
  }

  /** タップで次へ（tap の手順だけ） */
  tap(s: GameState): boolean {
    const st = this.step;
    if (!st || st.kind !== 'tap' || !this.visible(s)) return false;
    this.advance();
    return true;
  }

  /** 先攻決めのサイコロを押した */
  rollDice(): boolean {
    const st = this.step;
    if (!st || st.kind !== 'dice') return false;
    this.emit({ kind: 'good', spot: st.spot ?? [] });
    this.advance();
    return true;
  }

  /** カードを長押しした（詳しく見る画面を閉じたら次へ） */
  longPressed(uid: string): void {
    const st = this.step;
    if (st?.kind === 'longPress' && (st.spot ?? []).includes(`card:${uid}`)) this.pressed = true;
  }

  /** 詳しく見る画面を閉じた */
  detailClosed(): void {
    const st = this.step;
    if (st?.kind === 'longPress' && this.pressed) {
      this.emit({ kind: 'good', spot: st.spot ?? [] });
      this.advance();
    }
  }

  /** 相手の次の操作（台本）。台本が終わった・今は使えない時は null（ふつうの CPU に任せる） */
  oppAction(s: GameState): Action | null {
    const p = this.data.oppScript[this.oppIndex];
    if (!p) return null;
    const a = toAction(p, OPP);
    return validateAction(s, a) === null ? a : null;
  }

  /** 相手の台本が残っているか */
  get oppScriptLeft(): number {
    return this.data.oppScript.length - this.oppIndex;
  }
}
