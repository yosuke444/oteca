import { afterEach, describe, expect, it, vi } from 'vitest';
import { gsap } from 'gsap';
import { DIE_ATTR, DIE_SAFETY_MS, clearDice, holdDie, liveDice, releaseDie } from '../src/fx/dieSlot';
import { FxQueue } from '../src/fx/fxQueue';
import type { FxEnv } from '../src/fx/env';
import type { GameEvent, GameState } from '../src/engine/types';

/**
 * v2.7 サイコロが場に残るバグの直し：サイコロ専用の入れ物（src/fx/dieSlot.ts）。
 * サイコロだけを消し、ほかの演出（粒・数字・文字）は止めない・消さない。
 * 画面での確かめは scripts/dice-e2e.mjs（Playwright）
 */

/** DOM の要素の代わり（印・消した・動き用の値） */
function fakeEl(name: string) {
  const el = {
    name,
    attrs: {} as Record<string, string>,
    removed: false,
    x: 0,
    setAttribute(k: string, v: string) {
      el.attrs[k] = v;
    },
    remove() {
      el.removed = true;
    },
  };
  return el;
}
type Fake = ReturnType<typeof fakeEl>;
/** 演出の層の代わり：querySelectorAll は印（data-fx-die）の付いた要素だけを返す */
function fakeLayer(els: Fake[]) {
  return { querySelectorAll: (sel: string) => (sel === `[${DIE_ATTR}]` ? els.filter((e) => e.attrs[DIE_ATTR] && !e.removed) : []) };
}

afterEach(() => {
  clearDice();
  vi.useRealTimers();
});

describe('サイコロ専用の入れ物', () => {
  it('入れたサイコロだけに印が付き、空にするとサイコロだけが消える', () => {
    const die = fakeEl('die');
    const circle = fakeEl('circle');
    const spark = fakeEl('spark');
    holdDie(die, circle);
    expect(die.attrs[DIE_ATTR]).toBe('1');
    expect(spark.attrs[DIE_ATTR]).toBeUndefined();
    expect(liveDice()).toBe(2);
    clearDice();
    expect([die.removed, circle.removed, spark.removed]).toEqual([true, true, false]);
    expect(liveDice()).toBe(0);
  });

  it('ほかの演出（粒・数字）のアニメーションは止めない（最後まで流れる）', () => {
    const die = fakeEl('die');
    const particle = fakeEl('particle');
    holdDie(die);
    gsap.to(die, { x: 100, duration: 5 });
    const fxTween = gsap.to(particle, { x: 100, duration: 5 });
    clearDice();
    // サイコロの動きは最後まで進めて終わる（終わりを待っている演出が止まらない）。ほかの演出の動きはそのまま
    expect(gsap.getTweensOf(die)).toEqual([]);
    expect(die.x).toBe(100);
    expect(gsap.getTweensOf(particle)).toEqual([fxTween]);
    expect(particle.removed).toBe(false);
    fxTween.kill();
  });

  it('サイコロの動きの終わりを待っている演出は、片づけられても先へ進む（止まったままにならない）', async () => {
    const die = fakeEl('die');
    holdDie(die);
    let done = false;
    gsap.to(die, { x: 50, duration: 10, onComplete: () => void (done = true) });
    clearDice();
    expect(done).toBe(true);
  });

  it('保険：サイコロがまだ動いている間は消さずに待ち直す', () => {
    vi.useFakeTimers();
    const die = fakeEl('die');
    holdDie(die);
    const tw = gsap.to(die, { x: 50, duration: 100 });
    vi.spyOn(tw, 'isActive').mockReturnValue(true);
    vi.advanceTimersByTime(DIE_SAFETY_MS);
    expect(die.removed).toBe(false);
    expect(liveDice()).toBe(1);
    (tw.isActive as unknown as { mockReturnValue(v: boolean): void }).mockReturnValue(false);
    vi.advanceTimersByTime(DIE_SAFETY_MS);
    expect(die.removed).toBe(true);
  });

  it('自分で消したサイコロ（先攻決めの振り直しなど）は入れ物から出る', () => {
    const a = fakeEl('a');
    const b = fakeEl('b');
    holdDie(a, b);
    releaseDie(a);
    expect(liveDice()).toBe(1);
    clearDice();
    expect(a.removed).toBe(false);
    expect(b.removed).toBe(true);
  });

  it(`保険：${DIE_SAFETY_MS / 1000}秒たっても残っていたら、サイコロだけを消す`, () => {
    vi.useFakeTimers();
    const die = fakeEl('die');
    const other = fakeEl('other');
    holdDie(die);
    vi.advanceTimersByTime(DIE_SAFETY_MS - 1);
    expect(die.removed).toBe(false);
    vi.advanceTimersByTime(1);
    expect(die.removed).toBe(true);
    expect(other.removed).toBe(false);
  });

  it('入れ物の外に残った印つきの要素も、層を渡すと消える（印の無い要素は消さない）', () => {
    const stray = fakeEl('stray');
    stray.setAttribute(DIE_ATTR, '1');
    const fx = fakeEl('fx');
    clearDice({ root: fakeLayer([stray, fx]) as never });
    expect(stray.removed).toBe(true);
    expect(fx.removed).toBe(false);
  });
});

/** 演出のない出来事だけの FxQueue（DOM なしで動く） */
function fakeEnv(layerEls: Fake[]): FxEnv {
  let view = {} as GameState;
  return {
    overlay: fakeLayer(layerEls) as never,
    root: {} as never,
    me: () => 'p1',
    speed: () => 1,
    reduce: () => false,
    view: () => view,
    setView: (fn) => void (view = fn(view)),
    cardEl: () => null,
    zoneEl: () => null,
    markMove: () => {},
    sound: () => {},
    particles: null,
    slowMo: () => {},
    duckBgm: () => {},
    nameOf: () => '',
    turnLabel: () => ({ text: '', mine: true }),
    log: () => {},
  };
}
const quiet = { type: 'ChoiceNeeded', player: 'p1', kind: 'discard', count: 1 } as unknown as GameEvent;

describe('いつサイコロを片づけるか（FxQueue）', () => {
  it('次の操作の演出が始まった時（カードを選んだ後など）：前の操作のサイコロは消える', async () => {
    const die = fakeEl('die');
    const keep = fakeEl('keep');
    const q = new FxQueue(fakeEnv([die, keep]));
    holdDie(die);
    await new Promise<void>((done) => {
      q.onIdle = done;
      q.enqueue({ actor: 'p1', gap: false, events: [quiet], state: {} as GameState });
    });
    expect(liveDice()).toBe(0);
    // 薄くしてから消す（0.3秒）
    await vi.waitFor(() => expect(die.removed).toBe(true), { timeout: 3000 });
    expect(keep.removed).toBe(false);
  });

  it('画面を離れた時（dispose）：サイコロだけを すぐ消す', () => {
    const die = fakeEl('die');
    const stray = fakeEl('stray');
    stray.setAttribute(DIE_ATTR, '1');
    const fx = fakeEl('fx');
    const q = new FxQueue(fakeEnv([die, stray, fx]));
    holdDie(die);
    q.dispose();
    expect([die.removed, stray.removed, fx.removed]).toEqual([true, true, false]);
  });
});
