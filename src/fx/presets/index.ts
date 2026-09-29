import { gsap } from 'gsap';
import type { GameEvent } from '../../engine/types';
import type { FxEnv, FxPreset } from '../env';
import { STAGE_CENTER, boxOf, centerOf, spawn } from '../overlay';
import { play, wait } from '../timing';
import '../fx.css';

/**
 * イベントごとの演出（フェーズ3-1 の基本版。フェーズ5-1 で §9 の豪華版に置き換える）
 */

type PresetMap = { [K in GameEvent['type']]?: FxPreset<Extract<GameEvent, { type: K }>> };

/** 文字をポンと出して消す */
async function popText(env: FxEnv, at: { x: number; y: number }, text: string, cls: string, ms = 700): Promise<void> {
  const el = spawn(env, `fx-pop ${cls}`, at, text);
  await play(gsap.fromTo(el, { scale: 0.4, opacity: 0, y: 0 }, { scale: 1, opacity: 1, y: -18, duration: 0.18, ease: 'back.out(2)' }));
  await wait(ms);
  await play(gsap.to(el, { opacity: 0, y: -40, duration: 0.2 }));
  el.remove();
}

/** カードの裏面（演出の層に一時的に出す） */
function spawnBack(env: FxEnv, at: { x: number; y: number }, w: number, h: number): HTMLElement {
  const el = spawn(env, 'fx-cardback', at, '<span class="fx-cardback__logo">オテカ</span>');
  el.style.width = `${w}px`;
  el.style.height = `${h}px`;
  return el;
}

/**
 * 裏面から表に返す（SPEC §8-3「相手が手札からカードを出す時は、裏面から表に返る」）
 * 手札の場所から裏面が飛んできて、横に縮んで、表のカードが広がる。
 */
async function flipIn(env: FxEnv, el: HTMLElement, fromKey: string): Promise<void> {
  const to = boxOf(env, el);
  if (!to) return;
  const from = centerOf(env, env.zoneEl(fromKey)) ?? { x: to.x + to.w / 2, y: -100 };
  el.style.visibility = 'hidden';
  const back = spawnBack(env, from, to.w, to.h);
  await play(gsap.fromTo(back, { scale: 0.4, rotate: -20 }, { left: to.x + to.w / 2, top: to.y + to.h / 2, scale: 1, rotate: 0, duration: 0.35, ease: 'power2.out' }));
  await play(gsap.to(back, { scaleX: 0, duration: 0.14, ease: 'power1.in' }));
  back.remove();
  el.style.visibility = '';
  await play(gsap.fromTo(el, { scaleX: 0 }, { scaleX: 1, duration: 0.14, ease: 'power1.out', clearProps: 'scale,transform' }));
}

export const PRESETS: PresetMap = {
  DiceRolled: {
    async before(env, e) {
      const at = centerOf(env, env.zoneEl('dice')) ?? STAGE_CENTER;
      const x = e.purpose === 'order' ? at.x + (e.player === 'p1' ? -50 : 50) : at.x;
      const el = spawn(env, 'fx-die', { x, y: at.y }, `<span class="num">${e.value}</span>`);
      await play(gsap.fromTo(el, { rotate: -200, x: 120, opacity: 0 }, { rotate: 0, x: 0, opacity: 1, duration: 0.4, ease: 'power2.out' }));
      await wait(350);
      gsap.to(el, { opacity: 0, duration: 0.25, onComplete: () => el.remove() });
    },
  },
  MoveSelected: {
    async after(env, e) {
      env.markMove(e.uid, e.moveIndex);
      await wait(350);
    },
  },
  Damaged: {
    async after(env, e) {
      const card = env.cardEl(e.uid);
      const at = centerOf(env, card) ?? STAGE_CENTER;
      if (card && !env.reduce()) gsap.fromTo(card, { x: -6 }, { x: 0, duration: 0.25, ease: 'elastic.out(3, 0.3)' });
      await popText(env, at, `-${e.amount}`, 'fx-pop--damage');
    },
  },
  Healed: {
    async after(env, e) {
      const at = centerOf(env, env.cardEl(e.uid)) ?? STAGE_CENTER;
      await popText(env, at, `+${e.amount}`, 'fx-pop--heal');
    },
  },
  HpSet: {
    async after(env, e) {
      const at = centerOf(env, env.cardEl(e.uid)) ?? STAGE_CENTER;
      await popText(env, at, `HP ${e.hpAfter}`, 'fx-pop--purple', 500);
    },
  },
  BuffChanged: {
    async after() {
      await wait(150);
    },
  },
  Fainted: {
    async before(env, e) {
      const card = env.cardEl(e.uid);
      if (card) await play(gsap.to(card, { scale: 0.3, rotate: 40, opacity: 0, duration: 0.45, ease: 'power2.in' }));
    },
    async after(env) {
      await popText(env, STAGE_CENTER, 'きぜつ！', 'fx-pop--stamp', 600);
    },
  },
  BenchPlaced: {
    async after(env, e) {
      const card = env.cardEl(e.uid);
      if (!card) return;
      if (e.player !== env.me()) {
        await flipIn(env, card, `${e.player}-hand`);
        return;
      }
      await play(gsap.from(card, { y: 50, rotate: 12, opacity: 0, duration: 0.4, ease: 'power2.out' }));
    },
  },
  Swapped: {
    async after(env, e) {
      const a = env.cardEl(e.toActive);
      const b = env.cardEl(e.toBench);
      await Promise.all([a && play(gsap.from(a, { y: 60, duration: 0.35 })), b && play(gsap.from(b, { y: -60, duration: 0.35 }))]);
    },
  },
  ItemUsed: {
    async before(env, e) {
      const at = centerOf(env, env.cardEl(e.targetUid)) ?? STAGE_CENTER;
      const name = env.view().cardDefs[env.view().cards[e.itemUid].no]?.name ?? '';
      if (e.player !== env.me()) {
        // 相手のアイテム：裏面で出てきて、表に返ってから名前を見せる
        const from = centerOf(env, env.zoneEl(`${e.player}-hand`)) ?? { x: at.x, y: -80 };
        const back = spawnBack(env, from, 90, 126);
        await play(gsap.to(back, { left: at.x, top: at.y - 60, duration: 0.35, ease: 'power2.out' }));
        await play(gsap.to(back, { scaleX: 0, duration: 0.14, ease: 'power1.in' }));
        back.remove();
      }
      await popText(env, { x: at.x, y: at.y - 60 }, name, 'fx-pop--item', 400);
    },
  },
  TurnStarted: {
    async after(env, e) {
      env.markMove(null, null);
      const mine = e.player === env.me();
      await popText(env, STAGE_CENTER, mine ? 'あなたの ターン' : 'あいての ターン', mine ? 'fx-pop--banner' : 'fx-pop--banner fx-pop--opp', 500);
    },
  },
  Drew: {
    async after(env, e) {
      const card = env.cardEl(e.uid);
      if (card) await play(gsap.from(card, { x: 300, y: -100, opacity: 0, duration: 0.35 }));
    },
  },
  Promoted: {
    async after(env, e) {
      const card = env.cardEl(e.uid);
      if (card) await play(gsap.from(card, { y: 60, scale: 1.1, duration: 0.35 }));
    },
  },
  ActivesRevealed: {
    async after(env, e) {
      const els = [env.cardEl(e.p1), env.cardEl(e.p2)].filter((x): x is HTMLElement => !!x);
      await play(gsap.from(els, { rotateY: 180, duration: 0.45 }));
      await popText(env, STAGE_CENTER, 'バトル スタート！', 'fx-pop--banner', 600);
    },
  },
  Mulligan: {
    async before(env, e) {
      const who = e.player === env.me() ? '' : 'あいて：';
      await popText(env, STAGE_CENTER, `${who}おてあげが いない！ ひきなおし`, 'fx-pop--banner', 700);
    },
  },
  TurnEnded: {
    async after(env) {
      env.markMove(null, null);
    },
  },
  GameOver: {
    async after(env) {
      await popText(env, STAGE_CENTER, 'けっちゃく！', 'fx-pop--stamp', 800);
    },
  },
};
