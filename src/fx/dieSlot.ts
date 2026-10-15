import { gsap } from 'gsap';

/**
 * サイコロ専用の入れ物（v2.7。サイコロが場に残るバグの直し）。
 * 攻撃のサイコロ・鉛筆の軌跡・赤丸と、先攻決めのサイコロだけをここに入れ、印（data-fx-die）を付ける。
 * 次の操作の演出が始まった時・ターンが変わった時・決着の時・画面を離れた時・演出が途中で止められた時に空にする。
 * 保険：入れてから DIE_SAFETY_MS たっても残っていたら消す（サイコロだけ。ほかの演出には触らない）。
 * 止める・消すのは、ここに入れた要素と、その要素のアニメーションだけ
 */

/** サイコロの要素に付ける印 */
export const DIE_ATTR = 'data-fx-die';
/** 保険で消すまでの時間（ms。演出スピードによらない実時間。カードを選んでいる間などに長く残らないように） */
export const DIE_SAFETY_MS = 15_000;

/** サイコロの要素（remove と setAttribute があれば何でも。テストでは DOM の代わりのものを入れる） */
export type DieEl = { remove(): void; setAttribute(name: string, value: string): void };

const live = new Set<DieEl>();
let safety: ReturnType<typeof setTimeout> | null = null;

function armSafety(): void {
  if (safety) clearTimeout(safety);
  safety = setTimeout(() => {
    safety = null;
    // タブが裏の間（演出の時計が止まっている）や、サイコロがまだ動いている間は消さずに待ち直す
    const hidden = typeof document !== 'undefined' && document.hidden;
    if (hidden || gsap.getTweensOf([...live]).some((t) => t.isActive())) {
      armSafety();
      return;
    }
    clearDice();
  }, DIE_SAFETY_MS);
}

/** サイコロの要素を入れ物に入れる（印を付け、保険の時計を動かし直す） */
export function holdDie(...els: (DieEl | null | undefined)[]): void {
  for (const el of els) {
    if (!el) continue;
    el.setAttribute(DIE_ATTR, '1');
    live.add(el);
  }
  if (live.size > 0) armSafety();
}

/** 入れ物から出す（演出の中で自分で消した時。もう消さなくてよい） */
export function releaseDie(...els: (DieEl | null | undefined)[]): void {
  for (const el of els) if (el) live.delete(el);
  if (live.size === 0 && safety) {
    clearTimeout(safety);
    safety = null;
  }
}

/**
 * 入れ物を空にする：サイコロの要素だけを消す（fade なら0.3秒で薄くしてから）。
 * root を渡すと、入れ物の外に残った印つきの要素（前の画面の取り残しなど）も消す
 */
export function clearDice(opts: { fade?: boolean; root?: { querySelectorAll(sel: string): ArrayLike<DieEl> } | null } = {}): void {
  const els = [...live];
  live.clear();
  if (safety) {
    clearTimeout(safety);
    safety = null;
  }
  if (opts.root) for (const el of Array.from(opts.root.querySelectorAll(`[${DIE_ATTR}]`))) if (!els.includes(el)) els.push(el);
  if (els.length === 0) return;
  // サイコロの要素のアニメーションだけを終わらせる（ほかの演出は止めない）。
  // 打ち切る（kill）と、その動きの終わりを待っている演出がいつまでも待つので、最後まで進めて終わらせる
  for (const tw of gsap.getTweensOf(els)) tw.progress(1);
  if (opts.fade) gsap.to(els, { opacity: 0, duration: 0.3, onComplete: () => els.forEach((e) => e.remove()) });
  else els.forEach((e) => e.remove());
}

/** 入れ物に入っているサイコロの数（テスト・確かめ用） */
export function liveDice(): number {
  return live.size;
}
