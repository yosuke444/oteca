import { gsap } from 'gsap';
import type { GameEvent, Side } from '../../engine/types';
import { dieSvg } from '../dice';
import type { FxEnv, FxPreset, StepContext } from '../env';
import { ITEM_SOUND, type ItemFxKind, itemFxKind, noteColorOf } from '../itemFx';
import { type Box, type Point, STAGE_CENTER, boxOf, centerOf, rand, spawn, spawnSvg } from '../overlay';
import {
  burstNumber,
  cardCenter,
  drawPaths,
  dust,
  flash,
  focusLines,
  hatchFlash,
  hitStop,
  hpBarChange,
  inkBurst,
  marker,
  onomatopoeia,
  particles,
  penWrite,
  rulerUnderline,
  shake,
  speedLines,
  unveil,
  veil,
  stamp,
  swapArrow,
  tape,
} from '../parts';
import { play, wait } from '../timing';
import '../fx.css';

/**
 * イベントごとの演出（SPEC §9-2 の表の「対戦中」の行すべて）
 * before：表示を進める前（まだ前の見た目）／after：表示を進めた後（新しい見た目）
 * 演出は見た目だけを動かし、ゲームの状態は書き換えない（CLAUDE.md 8）。
 */

type PresetMap = { [K in GameEvent['type']]?: FxPreset<Extract<GameEvent, { type: K }>> };

const other = (s: Side): Side => (s === 'p1' ? 'p2' : 'p1');

// ---------------------------------------------------------------- 小さな道具

/** カードの裏面（演出の層に一時的に出す） */
function spawnBack(env: FxEnv, at: Point, w: number, h: number): HTMLElement {
  const el = spawn(env, 'fx-cardback', at, '<span class="fx-cardback__logo">オテカ</span>');
  el.style.width = `${w}px`;
  el.style.height = `${h}px`;
  return el;
}

/** 場所の中心（無ければ舞台の中央） */
function zoneCenter(env: FxEnv, key: string, fallback: Point = STAGE_CENTER): Point {
  return centerOf(env, env.zoneEl(key)) ?? fallback;
}

/** 赤ペンでぐるっと囲む */
async function redCircle(env: FxEnv, at: Point, rx: number, ry: number, seconds = 0.35): Promise<SVGSVGElement> {
  const k = 1.12;
  const d = `M${at.x + rx} ${at.y - 4} C${at.x + rx * k} ${at.y + ry * 1.05}, ${at.x - rx * 1.1} ${at.y + ry * 1.1}, ${at.x - rx} ${at.y}
    C${at.x - rx * 1.05} ${at.y - ry * 1.2}, ${at.x + rx * 1.15} ${at.y - ry * 1.15}, ${at.x + rx * 0.9} ${at.y + ry * 0.35}`;
  const svg = spawnSvg(env, 'fx-circle', `<path d="${d}" fill="none" stroke="var(--pen-red)" stroke-width="5" stroke-linecap="round"/>`);
  env.sound('se_pen');
  await drawPaths(svg.querySelectorAll('path'), seconds);
  return svg;
}

/** サイコロの面を、止まるまでぱらぱら変える */
function flicker(el: HTMLElement, seconds: number): Promise<void> {
  const proxy = { t: 0 };
  let last = -1;
  return play(
    gsap.to(proxy, {
      t: 1,
      duration: seconds,
      ease: 'none',
      onUpdate: () => {
        const step = Math.floor(proxy.t * seconds * 12);
        if (step !== last) {
          last = step;
          el.innerHTML = dieSvg(1 + Math.floor(Math.random() * 6));
        }
      },
    }),
  );
}

/** 画面の下にいる人か */
const isMe = (env: FxEnv, side: Side) => side === env.me();

/** カードを一時的に隠す／戻す（演出の層に代わりを出している間） */
function hide(el: Element | null, v: boolean): void {
  if (el instanceof HTMLElement) el.style.visibility = v ? 'hidden' : '';
}

/** 裏面から表に返る（相手が手札からカードを出す時。SPEC §8-3） */
async function flipIn(env: FxEnv, el: HTMLElement, fromKey: string): Promise<void> {
  const to = boxOf(env, el);
  if (!to) return;
  const from = zoneCenter(env, fromKey, { x: to.x + to.w / 2, y: -100 });
  hide(el, true);
  const back = spawnBack(env, from, to.w, to.h);
  env.sound('se_card_draw');
  await play(gsap.fromTo(back, { scale: 0.35, rotate: -25 }, { left: to.x + to.w / 2, top: to.y + to.h / 2, scale: 1, rotate: 0, duration: 0.38, ease: 'power2.out' }));
  await play(gsap.to(back, { scaleX: 0, duration: 0.13, ease: 'power1.in' }));
  back.remove();
  hide(el, false);
  await play(gsap.fromTo(el, { scaleX: 0 }, { scaleX: 1, duration: 0.13, ease: 'power1.out', clearProps: 'transform,scale' }));
}

// ---------------------------------------------------------------- 先攻決め（§9-2）

async function orderDice(env: FxEnv, ctx: StepContext): Promise<void> {
  const dice = ctx.events.filter((e): e is Extract<GameEvent, { type: 'DiceRolled' }> => e.type === 'DiceRolled' && e.purpose === 'order');
  const pairs: { p1: number; p2: number }[] = [];
  for (let i = 0; i + 1 < dice.length; i += 2) pairs.push({ [dice[i].player]: dice[i].value, [dice[i + 1].player]: dice[i + 1].value } as { p1: number; p2: number });
  const left = env.me();
  const right = other(left);
  const y = 330;
  const cover = veil(env);
  const title = spawn(env, 'fx-write fx-write--big', { x: 640, y: 150 }, 'せんこう きめ');
  gsap.fromTo(title, { opacity: 0, y: -20 }, { opacity: 1, y: 0, duration: 0.3 });
  const labels = [
    spawn(env, 'fx-die-label blue-pen', { x: 500, y: y + 80 }, env.nameOf(left)),
    spawn(env, 'fx-die-label red-pen', { x: 780, y: y + 80 }, env.nameOf(right)),
  ];
  gsap.fromTo(labels, { opacity: 0 }, { opacity: 1, duration: 0.3 });

  for (let n = 0; n < pairs.length; n++) {
    const pair = pairs[n];
    const dl = spawn(env, 'fx-die2', { x: -120, y }, dieSvg(1));
    const dr = spawn(env, 'fx-die2', { x: 1400, y }, dieSvg(1));
    env.sound('se_dice_roll');
    const roll = (el: HTMLElement, toX: number, dir: number) =>
      play(
        gsap
          .timeline()
          .to(el, { left: toX, rotate: dir * 900, duration: 1.0, ease: 'power2.out' }, 0)
          // 3回バウンド
          .to(el, { keyframes: { y: [0, -110, 0, -55, 0, -22, 0], easeEach: 'sine.inOut' }, duration: 1.0 }, 0),
      );
    await Promise.all([roll(dl, 500, 1), roll(dr, 780, -1), flicker(dl, 0.95), flicker(dr, 0.95)]);
    dl.innerHTML = dieSvg(pair[left]);
    dr.innerHTML = dieSvg(pair[right]);
    gsap.set([dl, dr], { rotate: 0 });
    env.sound('se_dice_land');
    await play(gsap.fromTo([dl, dr], { scale: 1.15 }, { scale: 1, duration: 0.15, ease: 'back.out(3)' }));
    await wait(250);

    if (pair.p1 === pair.p2) {
      // 同じ目：両方「？」顔になって振り直し
      dl.innerHTML = dieSvg('?');
      dr.innerHTML = dieSvg('?');
      env.sound('se_error');
      const same = spawn(env, 'fx-write red-pen', { x: 640, y: y - 110 }, 'おなじ！ もういちど');
      await play(gsap.fromTo([dl, dr], { rotate: -14 }, { rotate: 14, duration: 0.12, yoyo: true, repeat: 3, ease: 'sine.inOut' }));
      await wait(350);
      await play(gsap.to([dl, dr, same], { opacity: 0, duration: 0.2 }));
      [dl, dr, same].forEach((e) => e.remove());
      continue;
    }
    // 大きい方の目を赤ペンで囲む →「せんこう！」はんこ
    const winLeft = pair[left] > pair[right];
    const winAt = { x: winLeft ? 500 : 780, y };
    const circle = await redCircle(env, winAt, 64, 60);
    await stamp(env, { x: winAt.x, y: y - 110 }, 'せんこう！', winLeft ? 'fx-stamp--blue' : '', 650);
    await play(gsap.to([dl, dr, circle, title, ...labels], { opacity: 0, duration: 0.25 }));
    [dl, dr, circle, title, ...labels].forEach((e) => e.remove());
    await unveil(cover);
    return;
  }
  [title, ...labels].forEach((e) => e.remove());
  await unveil(cover);
}

// ---------------------------------------------------------------- おてあげチェックの引き直し（§9-2）

async function mulligan(env: FxEnv, side: Side): Promise<void> {
  const mine = isMe(env, side);
  const cover = veil(env, 0.6);
  const handAt = zoneCenter(env, `${side}-hand`, { x: 640, y: mine ? 640 : 40 });
  const deckAt = zoneCenter(env, `${side}-deck`, { x: 1060, y: mine ? 430 : 120 });
  const text = spawn(env, `fx-write ${mine ? 'fx-write--me' : 'fx-write--opp'}`, { x: 640, y: 300 }, `${mine ? '' : 'あいて：'}おてあげが いない！ ひきなおし`);
  gsap.fromTo(text, { scale: 0.5, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.25, ease: 'back.out(2)' });
  env.sound('se_error');
  // 手札が山札に吸い込まれる
  const backs = Array.from({ length: 5 }, (_, i) => spawnBack(env, { x: handAt.x + (i - 2) * 50, y: handAt.y }, 70, 98));
  env.sound('se_card_draw');
  await play(gsap.to(backs, { left: deckAt.x, top: deckAt.y, rotate: () => rand(-30, 30), scale: 0.8, duration: 0.4, stagger: 0.05, ease: 'power2.in' }));
  // 山札をシャッフル（カードが左右に3回はじかれる）
  env.sound('se_swap');
  const tl = gsap.timeline();
  for (let i = 0; i < 3; i++) {
    tl.to(backs.slice(0, 2), { left: deckAt.x - 60, rotate: -15, duration: 0.09 })
      .to(backs.slice(2, 4), { left: deckAt.x + 60, rotate: 15, duration: 0.09 }, '<')
      .to(backs.slice(0, 4), { left: deckAt.x, rotate: 0, duration: 0.09 });
  }
  await play(tl);
  // 配り直し
  env.sound('se_card_draw');
  await play(gsap.to(backs, { left: (i: number) => handAt.x + (i - 2) * 50, top: handAt.y, rotate: 0, scale: 1, duration: 0.35, stagger: 0.06, ease: 'power2.out' }));
  await play(gsap.to([...backs, text], { opacity: 0, duration: 0.2 }));
  [...backs, text].forEach((e) => e.remove());
  await unveil(cover);
}

// ---------------------------------------------------------------- バトル場オープン（§9-2）

async function revealBefore(env: FxEnv, ctx: StepContext): Promise<void> {
  // 裏向きのカードを、それぞれのバトル場の上に出しておく
  const backs: HTMLElement[] = [];
  for (const side of ['p1', 'p2'] as const) {
    const b = boxOf(env, env.zoneEl(`${side}-active`));
    if (b) backs.push(spawnBack(env, { x: b.x + b.w / 2, y: b.y + b.h / 2 }, 150, 210));
  }
  ctx.flags.revealBacks = backs;
}

async function revealAfter(env: FxEnv, e: Extract<GameEvent, { type: 'ActivesRevealed' }>, ctx: StepContext): Promise<void> {
  const backs = (ctx.flags.revealBacks as HTMLElement[] | undefined) ?? [];
  const cards = [env.cardEl(e.p1), env.cardEl(e.p2)].filter((x): x is HTMLElement => !!x);
  cards.forEach((c) => hide(c, true));
  env.sound('se_card_place');
  await play(gsap.to(backs, { scaleX: 0, duration: 0.14, ease: 'power1.in' }));
  backs.forEach((b) => b.remove());
  cards.forEach((c) => hide(c, false));
  await play(gsap.fromTo(cards, { scaleX: 0 }, { scaleX: 1, duration: 0.14, ease: 'power1.out', clearProps: 'transform,scale' }));
  // 集中線＋「バトル スタート！」に黄色の蛍光ペンで下線
  void focusLines(env, STAGE_CENTER, 1.1);
  env.sound('se_stamp');
  const text = await penWrite(env, { x: 640, y: 300 }, 'バトル スタート！', 'fx-write--big', 0.45);
  const b = boxOf(env, text);
  const line = b ? await marker(env, { x: b.x, y: b.y + b.h * 0.55, w: b.w, h: b.h * 0.4 }, 'var(--marker-yellow)', 0.3) : null;
  if (line) line.style.zIndex = '-1';
  await wait(600);
  await play(gsap.to([text, line].filter(Boolean), { opacity: 0, duration: 0.25 }));
  text.remove();
  line?.remove();
}

// ---------------------------------------------------------------- 攻撃のサイコロ（§9-2）

async function attackDie(env: FxEnv, value: number, ctx: StepContext): Promise<void> {
  const at = zoneCenter(env, 'dice', { x: 640, y: 300 });
  const start = { x: 1360, y: at.y - 40 };
  // 鉛筆の軌跡線
  const path = `M${start.x} ${start.y} C${start.x - 200} ${start.y - 70}, ${at.x + 360} ${at.y + 50}, ${at.x + 200} ${at.y - 10} S${at.x + 60} ${at.y + 20}, ${at.x} ${at.y}`;
  const trail = spawnSvg(env, 'fx-trail', `<path d="${path}" fill="none" stroke="var(--pencil)" stroke-width="2.5" stroke-dasharray="7 6" stroke-linecap="round"/>`);
  const trailPath = trail.querySelector('path')!;
  const len = trailPath.getTotalLength();
  const die = spawn(env, 'fx-die2', start, dieSvg(1));
  env.sound('se_dice_roll');
  const proxy = { p: 0 };
  const mask = { off: len };
  trailPath.style.strokeDasharray = `${len}`;
  trailPath.style.strokeDashoffset = `${len}`;
  await Promise.all([
    play(
      gsap.to(proxy, {
        p: 1,
        duration: 1.0,
        ease: 'power2.out',
        onUpdate: () => {
          const pt = trailPath.getPointAtLength(proxy.p * len);
          die.style.left = `${pt.x}px`;
          die.style.top = `${pt.y}px`;
          mask.off = len * (1 - proxy.p);
          trailPath.style.strokeDashoffset = `${mask.off}`;
        },
      }),
    ),
    play(gsap.to(die, { rotate: -1080, duration: 1.0, ease: 'power2.out' })),
    flicker(die, 0.95),
  ]);
  die.innerHTML = dieSvg(value);
  gsap.set(die, { rotate: rand(-8, 8) });
  env.sound('se_dice_land');
  await play(gsap.fromTo(die, { scale: 1.2 }, { scale: 1, duration: 0.14, ease: 'back.out(3)' }));
  gsap.to(trail, { opacity: 0, duration: 0.3, onComplete: () => trail.remove() });
  const circle = await redCircle(env, at, 58, 54, 0.3);
  ctx.flags.die = [die, circle];
}

function clearDie(ctx: StepContext): void {
  const els = ctx.flags.die as Element[] | undefined;
  if (!els) return;
  ctx.flags.die = undefined;
  gsap.to(els, { opacity: 0, duration: 0.3, onComplete: () => els.forEach((e) => e.remove()) });
}

// ---------------------------------------------------------------- ダメージ（§9-2）

const SMALL_WORDS = ['ドカッ', 'バキッ', 'ドンッ', 'ボコッ'];

async function damageBefore(env: FxEnv, e: Extract<GameEvent, { type: 'Damaged' }>, ctx: StepContext): Promise<void> {
  const target = env.cardEl(e.uid);
  const attacker = ctx.attackerUid ? env.cardEl(ctx.attackerUid) : null;
  const tAt = cardCenter(env, e.uid);
  ctx.flags.hpBefore = env.view().cards[e.uid]?.hp;
  // 決着の最後の一撃はスローモーション（0.4倍速）
  if (ctx.finalBlow) env.slowMo(0.4);
  // 攻撃側がぐっと下がってから前へ突進（速度線）
  if (attacker) {
    const aAt = centerOf(env, attacker) ?? tAt;
    const dir = Math.sign(tAt.y - aAt.y) || -1;
    await play(gsap.to(attacker, { y: -dir * 26, scale: 0.96, duration: 0.2, ease: 'power2.out' }));
    speedLines(env, aAt, { x: aAt.x, y: aAt.y + dir * 90 });
    await play(gsap.to(attacker, { y: dir * 78, scale: 1.04, duration: 0.11, ease: 'power3.in' }));
    gsap.to(attacker, { y: 0, scale: 1, duration: 0.32, delay: 0.08, ease: 'power2.out', clearProps: 'transform,scale' });
  }
  // 当たった瞬間
  if (e.big) {
    env.sound('se_hit_big');
    env.sound('se_pen');
    env.duckBgm();
    void focusLines(env, STAGE_CENTER, 0.8);
    void flash(env, 0.3, 0.9);
  } else {
    env.sound('se_hit_small');
  }
  await hitStop(env, e.big);
  void shake(env, e.big);
  inkBurst(env, tAt, e.big ? ['var(--ink)', 'var(--pen-red)'] : ['var(--ink)'], e.big ? 56 : 26, e.big ? 1.5 : 1);
  void hatchFlash(env, target);
  if (target) gsap.fromTo(target, { x: -10 }, { x: 0, duration: 0.35, ease: 'elastic.out(3, 0.3)', clearProps: 'transform' });
  void onomatopoeia(env, { x: tAt.x - (e.big ? 150 : 110), y: tAt.y + 20 }, e.big ? 'ズドーン' : SMALL_WORDS[Math.floor(Math.random() * SMALL_WORDS.length)], e.big);
}

async function damageAfter(env: FxEnv, e: Extract<GameEvent, { type: 'Damaged' }>, ctx: StepContext): Promise<void> {
  // スローモーションは最後の一撃が当たるところまで
  env.slowMo(1);
  const at = cardCenter(env, e.uid);
  const max = env.view().cards[e.uid]?.maxHp ?? 0;
  const before = (ctx.flags.hpBefore as number | undefined) ?? e.hpAfter + e.amount;
  await Promise.all([burstNumber(env, { x: at.x + 70, y: at.y - 30 }, `${e.amount}`, e.big), hpBarChange(env, e.uid, before, e.hpAfter, max, 'damage')]);
}

// ---------------------------------------------------------------- 回復（技・くすり・スポドリ）

function risingPluses(env: FxEnv, at: Point, n: number): Promise<void> {
  const els = Array.from({ length: n }, () => spawn(env, 'fx-plus', { x: at.x + rand(-55, 55), y: at.y + rand(0, 50) }, '+'));
  return play(
    gsap
      .timeline({ onComplete: () => els.forEach((e) => e.remove()) })
      .fromTo(els, { y: 0, opacity: 0, scale: 0.4 }, { y: -90, opacity: 1, scale: () => rand(0.8, 1.3), duration: 0.6, stagger: 0.08, ease: 'power1.out' })
      .to(els, { opacity: 0, duration: 0.25 }, '-=0.15'),
  );
}

async function healBefore(env: FxEnv, e: Extract<GameEvent, { type: 'Healed' }>, ctx: StepContext): Promise<void> {
  const card = env.cardEl(e.uid);
  const at = cardCenter(env, e.uid);
  const c = env.view().cards[e.uid];
  const before = c?.hp ?? e.hpAfter - e.amount;
  const max = c?.maxHp ?? 0;
  const item = ctx.flags.item as ItemFxKind | undefined;
  if (item === 'bigHeal') {
    // スポドリ：水色の水しぶきが弾け、HPバーが大きく伸びる
    particles(env, { kind: 'splash', x: at.x, y: at.y, count: 44, colors: ['var(--pen-sky)', 'var(--fx-splash-light)', 'var(--pen-blue)'], speed: [220, 620], size: [3, 7], life: [0.5, 0.9], gravity: 900, spread: Math.PI * 0.9 });
    const ring = spawn(env, 'fx-splash-ring', at);
    gsap.fromTo(ring, { scale: 0.2, opacity: 0.9 }, { scale: 2.2, opacity: 0, duration: 0.5, ease: 'power2.out', onComplete: () => ring.remove() });
    void onomatopoeia(env, at, 'バシャッ');
    ctx.flags.heal = { before, max, mode: 'big' };
  } else if (item === 'heal') {
    // くすり：緑の「＋」の落書きが3〜5個わき上がり、HPバーが緑ペンで塗り足される（塗り足しは after）
    void risingPluses(env, at, 3 + Math.floor(Math.random() * 3));
    ctx.flags.heal = { before, max, mode: 'heal' };
  } else {
    // 技の回復：カードがふわっと浮き、緑の「＋」と小さな葉っぱの落書きが舞う
    env.sound('se_heal');
    if (card) gsap.to(card, { y: -18, duration: 0.35, yoyo: true, repeat: 1, ease: 'sine.inOut', clearProps: 'transform' });
    particles(env, { kind: 'leaf', x: at.x, y: at.y + 40, count: 12, colors: ['var(--pen-green)', 'var(--fx-leaf)'], angle: -Math.PI / 2, spread: 0.9, speed: [90, 220], size: [5, 9], life: [0.9, 1.4], gravity: -40, drag: 0.5, area: 50 });
    particles(env, { kind: 'plus', x: at.x, y: at.y + 30, count: 8, colors: ['var(--pen-green)'], angle: -Math.PI / 2, spread: 0.7, speed: [80, 200], size: [5, 9], life: [0.8, 1.2], gravity: -60, drag: 0.5, area: 50 });
    await risingPluses(env, at, 3);
    ctx.flags.heal = { before, max, mode: 'heal' };
  }
}

async function healAfter(env: FxEnv, e: Extract<GameEvent, { type: 'Healed' }>, ctx: StepContext): Promise<void> {
  const at = cardCenter(env, e.uid);
  const h = ctx.flags.heal as { before: number; max: number; mode: 'heal' | 'big' } | undefined;
  const bar = h ? hpBarChange(env, e.uid, h.before, e.hpAfter, h.max, h.mode) : Promise.resolve();
  const text = await penWrite(env, { x: at.x + 60, y: at.y - 40 }, `+${e.amount}`, 'fx-write--green', 0.3);
  await bar;
  await wait(450);
  await play(gsap.to(text, { opacity: 0, y: '-=20', duration: 0.25 }));
  text.remove();
}

// ---------------------------------------------------------------- アイテム（§9-2）

async function itemBefore(env: FxEnv, e: Extract<GameEvent, { type: 'ItemUsed' }>, ctx: StepContext): Promise<void> {
  const v = env.view();
  const def = v.cardDefs[v.cards[e.itemUid]?.no];
  const kind = itemFxKind(def);
  ctx.flags.item = kind;
  const to = cardCenter(env, e.targetUid);
  const handEl = env.cardEl(e.itemUid);
  let from: Point;
  if (handEl && isMe(env, e.player)) {
    from = centerOf(env, handEl) ?? { x: 640, y: 640 };
    hide(handEl, true);
  } else {
    // 相手のアイテム：裏面で出てきて、表に返る（§8-3）
    const start = zoneCenter(env, `${e.player}-hand`, { x: 640, y: -60 });
    from = { x: start.x, y: start.y + 60 };
    const back = spawnBack(env, start, 90, 126);
    await play(gsap.to(back, { left: from.x, top: from.y + 40, duration: 0.3, ease: 'power2.out' }));
    await play(gsap.to(back, { scaleX: 0, duration: 0.12 }));
    back.remove();
  }
  const note = spawn(env, `fx-note fx-note--${noteColorOf(def)}`, from, `<b>${def?.name ?? ''}</b>`);
  // ふせんが手札からペリッとはがれて飛び、対象に貼り付く
  const peel = spawn(env, 'fx-sfx-text', { x: from.x + 50, y: from.y - 70 }, 'ペリッ');
  gsap.fromTo(peel, { opacity: 0, scale: 0.5 }, { opacity: 1, scale: 1, duration: 0.12 });
  await play(gsap.fromTo(note, { rotate: 0 }, { rotate: -22, y: -30, scale: 1.15, duration: 0.18, ease: 'power2.out' }));
  gsap.to(peel, { opacity: 0, duration: 0.2, onComplete: () => peel.remove() });
  await play(gsap.to(note, { left: to.x, top: to.y, y: 0, rotate: 8, scale: 1, duration: 0.36, ease: 'power2.inOut' }));
  env.sound('se_tape');
  env.sound(ITEM_SOUND[kind]);
  await play(gsap.fromTo(note, { scaleY: 0.8, scaleX: 1.12 }, { scaleY: 1, scaleX: 1, duration: 0.14, ease: 'back.out(3)' }));
  await wait(160);
  gsap.to(note, { opacity: 0, scale: 0.9, duration: 0.22, onComplete: () => note.remove() });
}

async function itemAfter(env: FxEnv, e: Extract<GameEvent, { type: 'ItemUsed' }>): Promise<void> {
  hide(env.cardEl(e.itemUid), false);
}

/** きみょうなドリンク：紫のぐるぐる渦 → カードが震える（HPが10まで一気に削れるのは after） */
async function hpSetBefore(env: FxEnv, e: Extract<GameEvent, { type: 'HpSet' }>, ctx: StepContext): Promise<void> {
  ctx.flags.hpBefore = env.view().cards[e.uid]?.hp;
  const at = cardCenter(env, e.uid);
  const turns: string[] = [];
  for (let i = 0; i <= 60; i++) {
    const a = i * 0.42;
    const r = 4 + i * 1.25;
    turns.push(`${i === 0 ? 'M' : 'L'}${(at.x + Math.cos(a) * r).toFixed(1)} ${(at.y + Math.sin(a) * r).toFixed(1)}`);
  }
  const svg = spawnSvg(env, 'fx-swirl', `<path d="${turns.join(' ')}" fill="none" stroke="var(--pen-purple)" stroke-width="4" stroke-linecap="round"/>`);
  void onomatopoeia(env, at, 'ゴポゴポ');
  await Promise.all([drawPaths(svg.querySelectorAll('path'), 0.5), play(gsap.to(svg, { rotate: 200, transformOrigin: `${at.x}px ${at.y}px`, duration: 0.8, ease: 'power1.in' }))]);
  const card = env.cardEl(e.uid);
  particles(env, { kind: 'bubble', x: at.x, y: at.y + 40, count: 14, colors: ['var(--pen-purple)'], angle: -Math.PI / 2, spread: 0.6, speed: [60, 160], size: [4, 9], life: [0.6, 1.1], gravity: -80, area: 40 });
  if (card) await play(gsap.fromTo(card, { x: -5 }, { x: 5, duration: 0.05, yoyo: true, repeat: 7, ease: 'none', clearProps: 'transform' }));
  gsap.to(svg, { opacity: 0, duration: 0.2, onComplete: () => svg.remove() });
}

async function hpSetAfter(env: FxEnv, e: Extract<GameEvent, { type: 'HpSet' }>, ctx: StepContext): Promise<void> {
  const before = (ctx.flags.hpBefore as number | undefined) ?? e.hpAfter;
  const max = env.view().cards[e.uid]?.maxHp ?? 0;
  const at = cardCenter(env, e.uid);
  const label = spawn(env, 'fx-pop fx-pop--purple', { x: at.x + 60, y: at.y - 40 }, `HP ${e.hpAfter}`);
  gsap.fromTo(label, { scale: 0.4, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.18, ease: 'back.out(2)' });
  await hpBarChange(env, e.uid, before, e.hpAfter, max, 'damage', 'var(--pen-purple)');
  await wait(250);
  gsap.to(label, { opacity: 0, duration: 0.25, onComplete: () => label.remove() });
}

async function buffBefore(env: FxEnv, e: Extract<GameEvent, { type: 'BuffChanged' }>, ctx: StepContext): Promise<void> {
  const c = env.view().cards[e.uid];
  ctx.flags.buffBefore = c ? { add: c.attackAdd, ov: c.attackOverride } : { add: 0, ov: null };
  if (!c || e.attackAdd <= c.attackAdd) return;
  // ドリンクなど「ふしぎ」なアイテムで増えた時は、渦の演出（HpSet）だけにする（やいばの斬撃は出さない）
  if (ctx.flags.item === 'weird') return;
  // ひみつのやいば：赤ペンで斬る線が2本交差（シャキーン）
  const b = boxOf(env, env.cardEl(e.uid));
  if (!b) return;
  const svg = spawnSvg(
    env,
    'fx-slash',
    `<path d="M${b.x - 20} ${b.y + 20} L${b.x + b.w + 20} ${b.y + b.h - 30}" stroke="var(--pen-red)" stroke-width="7" stroke-linecap="round"/>
     <path d="M${b.x + b.w + 20} ${b.y + 30} L${b.x - 20} ${b.y + b.h - 20}" stroke="var(--pen-red)" stroke-width="7" stroke-linecap="round"/>`,
  );
  void onomatopoeia(env, { x: b.x + b.w / 2, y: b.y + 20 }, 'シャキーン');
  await drawPaths(svg.querySelectorAll('path'), 0.12, 0.1);
  particles(env, { kind: 'spark', x: b.x + b.w / 2, y: b.y + b.h / 2, count: 18, colors: ['var(--super-gold)', 'var(--pen-red)'], speed: [120, 380], size: [5, 10], life: [0.4, 0.8], gravity: 0 });
  await wait(200);
  gsap.to(svg, { opacity: 0, duration: 0.25, onComplete: () => svg.remove() });
}

async function buffAfter(env: FxEnv, e: Extract<GameEvent, { type: 'BuffChanged' }>, ctx: StepContext): Promise<void> {
  const before = ctx.flags.buffBefore as { add: number; ov: number | null } | undefined;
  const card = env.cardEl(e.uid);
  if (!card || !before) return;
  // 新しく付いた・増えたバッジがポンと出る（そのあとゆっくり脈打つ）
  const badges: Element[] = [];
  if (e.attackAdd > before.add || (e.attackOverride !== null && before.ov === null)) badges.push(...card.querySelectorAll('.buff-badge'));
  if (badges.length === 0) return;
  await play(gsap.fromTo(badges, { scale: 0, rotate: -40 }, { scale: 1, rotate: 0, duration: 0.3, ease: 'back.out(3)', clearProps: 'transform' }));
}

// ---------------------------------------------------------------- きぜつ・くりだし（§9-2）

async function faintBefore(env: FxEnv, e: Extract<GameEvent, { type: 'Fainted' }>, ctx: StepContext): Promise<void> {
  const card = env.cardEl(e.uid);
  const owner = env.view().cards[e.uid]?.owner ?? other(e.by);
  const at = cardCenter(env, e.uid);
  ctx.flags.faintAt = at;
  env.duckBgm();
  if (!card) return;
  // 紙のようにくしゃっと丸まる（縮小＋ゆがみ＋回転）。しわの線が走る
  env.sound('se_ko');
  const wrinkle = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  wrinkle.setAttribute('class', 'fx-wrinkle');
  wrinkle.setAttribute('viewBox', '0 0 100 140');
  wrinkle.setAttribute('preserveAspectRatio', 'none');
  wrinkle.innerHTML = Array.from({ length: 7 }, () => {
    let d = `M${rand(0, 100)} ${rand(0, 140)}`;
    for (let i = 0; i < 4; i++) d += ` L${rand(0, 100)} ${rand(0, 140)}`;
    return `<path d="${d}" fill="none" stroke="var(--pencil)" stroke-width="1.6"/>`;
  }).join('');
  card.appendChild(wrinkle);
  void drawPaths(wrinkle.querySelectorAll('path'), 0.3, 0.02);
  particles(env, { kind: 'paper', x: at.x, y: at.y, count: 16, colors: ['var(--pencil)'], speed: [80, 260], size: [3, 6], life: [0.5, 0.9], gravity: 600 });
  await play(
    gsap
      .timeline()
      .to(card, { scaleX: 0.85, scaleY: 1.05, skewX: 12, duration: 0.1 })
      .to(card, { scale: 0.42, skewX: -18, skewY: 14, rotate: 120, borderRadius: '50%', duration: 0.28, ease: 'power2.in' })
      .to(card, { scale: 0.36, skewX: 10, rotate: 170, duration: 0.1 }),
  );
  // すてふだへ放物線で飛ぶ
  const to = zoneCenter(env, `${owner}-discard`, { x: 1180, y: at.y });
  const b = boxOf(env, card)!;
  const dx = to.x - (b.x + b.w / 2);
  const dy = to.y - (b.y + b.h / 2);
  await play(gsap.to(card, { keyframes: { x: [0, dx * 0.5, dx], y: [0, dy * 0.5 - 170, dy], easeEach: 'sine.inOut' }, rotate: 560, duration: 0.55, ease: 'none' }));
  hide(card, true);
}

async function faintAfter(env: FxEnv, e: Extract<GameEvent, { type: 'Fainted' }>, ctx: StepContext): Promise<void> {
  const at = (ctx.flags.faintAt as Point | undefined) ?? STAGE_CENTER;
  await stamp(env, at, 'きぜつ！', '', 450);
  // 攻撃側の☆がペンで描かれて、蛍光ペンで塗られる
  const stars = env.zoneEl(`${e.by}-stars`)?.querySelectorAll('.battle-star');
  const star = stars?.[e.koCount - 1] as HTMLElement | undefined;
  const b = boxOf(env, star ?? null);
  if (!star || !b) return;
  const paths = star.querySelectorAll('path');
  env.sound('se_pen');
  await Promise.all([drawPaths(paths, 0.35), play(gsap.fromTo(star, { scale: 2.2, rotate: -90 }, { scale: 1, rotate: 0, duration: 0.35, ease: 'back.out(2)', clearProps: 'transform' }))]);
  const m = spawn(env, 'fx-starmark', { x: b.x + b.w / 2, y: b.y + b.h / 2 });
  await play(gsap.fromTo(m, { scale: 0, opacity: 0.9 }, { scale: 1, duration: 0.2, ease: 'power2.out' }));
  gsap.to(m, { opacity: 0, duration: 0.6, delay: 0.3, onComplete: () => m.remove() });
  paths.forEach((p) => {
    p.style.strokeDasharray = '';
    p.style.strokeDashoffset = '';
  });
}

async function promoteBefore(env: FxEnv, e: Extract<GameEvent, { type: 'Promoted' }>, ctx: StepContext): Promise<void> {
  ctx.flags.promoteFrom = boxOf(env, env.cardEl(e.uid));
}

async function promoteAfter(env: FxEnv, e: Extract<GameEvent, { type: 'Promoted' }>, ctx: StepContext): Promise<void> {
  const card = env.cardEl(e.uid);
  const from = ctx.flags.promoteFrom as Box | null | undefined;
  const to = boxOf(env, card);
  if (!card || !to) return;
  const dx = from ? from.x + from.w / 2 - (to.x + to.w / 2) : 0;
  const dy = from ? from.y + from.h / 2 - (to.y + to.h / 2) : 0;
  // ベンチのカードが持ち上がり、バトル場へ「ドン」と着地＋土ぼこり
  await play(gsap.fromTo(card, { x: dx, y: dy, scale: from ? from.w / to.w : 1 }, { x: dx * 0.4, y: Math.min(dy, 0) - 110, scale: 1.12, rotate: -6, duration: 0.3, ease: 'power2.out' }));
  await play(gsap.to(card, { x: 0, y: 0, scale: 1, rotate: 0, duration: 0.16, ease: 'power4.in', clearProps: 'transform' }));
  env.sound('se_stamp');
  void shake(env, false);
  void onomatopoeia(env, { x: to.x + to.w / 2, y: to.y + to.h - 10 }, 'ドン');
  dust(env, { x: to.x + to.w / 2, y: to.y + to.h - 6 }, 170);
  await wait(250);
}

// ---------------------------------------------------------------- 表

export const PRESETS: PresetMap = {
  DiceRolled: {
    async before(env, e, ctx) {
      if (e.purpose === 'order') {
        if (ctx.flags.orderDone) return;
        ctx.flags.orderDone = true;
        await orderDice(env, ctx);
        return;
      }
      await attackDie(env, e.value, ctx);
    },
  },
  Mulligan: {
    async before(env, e) {
      await mulligan(env, e.player);
    },
  },
  ActiveChosen: {
    async after(env, e) {
      // 裏向きで置いた（どれを選んだかは見せない）
      const slot = env.zoneEl(`${e.player}-active`);
      env.sound('se_card_place');
      if (slot) await play(gsap.fromTo(slot, { scale: 1.12 }, { scale: 1, duration: 0.25, ease: 'back.out(3)', clearProps: 'transform' }));
    },
  },
  ActivesRevealed: { before: (env, _e, ctx) => revealBefore(env, ctx), after: revealAfter },
  TurnStarted: {
    async after(env, e) {
      env.markMove(null, null);
      // 「あなたの ターン」がペンで書かれ、定規で引いたような二重下線（0.7秒）
      const label = env.turnLabel(e.player);
      env.sound('se_turn_start');
      const text = await penWrite(env, { x: 640, y: 290 }, label.text, `fx-write--big ${label.mine ? 'fx-write--me' : 'fx-write--opp'}`, 0.4);
      const b = boxOf(env, text);
      const line = b ? await rulerUnderline(env, { x: b.x + 10, y: b.y + b.h - 18, w: b.w - 20, h: 10 }, label.mine ? 'var(--pen-blue)' : 'var(--pen-red)', 0.3) : null;
      await wait(250);
      await play(gsap.to([text, line].filter(Boolean), { opacity: 0, duration: 0.2 }));
      text.remove();
      line?.remove();
    },
  },
  Drew: {
    async before(env, e) {
      // ドローするターンは山札が一度ぴょんと跳ねる
      const deck = env.zoneEl(`${e.player}-deck`);
      if (deck) await play(gsap.timeline().to(deck, { y: -26, duration: 0.14, ease: 'power2.out' }).to(deck, { y: 0, duration: 0.3, ease: 'bounce.out', clearProps: 'transform' }));
    },
    async after(env, e) {
      // 山札の上のカードがスライドして手札へ
      const from = zoneCenter(env, `${e.player}-deck`);
      env.sound('se_card_draw');
      const card = isMe(env, e.player) ? env.cardEl(e.uid) : null;
      const to = card ? (centerOf(env, card) ?? STAGE_CENTER) : zoneCenter(env, `${e.player}-hand`, { x: 640, y: 20 });
      hide(card, true);
      const back = spawnBack(env, from, 84, 118);
      await play(gsap.to(back, { left: to.x, top: to.y, rotate: rand(-12, 12), duration: 0.38, ease: 'power2.inOut' }));
      if (card) {
        await play(gsap.to(back, { scaleX: 0, duration: 0.1 }));
        back.remove();
        hide(card, false);
        await play(gsap.fromTo(card, { scaleX: 0 }, { scaleX: 1, duration: 0.12, clearProps: 'transform,scale' }));
      } else {
        await play(gsap.to(back, { opacity: 0, scale: 0.5, duration: 0.2 }));
        back.remove();
      }
    },
  },
  BenchPlaced: {
    async after(env, e) {
      const card = env.cardEl(e.uid);
      if (!card) return;
      if (!isMe(env, e.player)) {
        await flipIn(env, card, `${e.player}-hand`);
      } else {
        // 軽く回転しながら着地
        env.sound('se_card_draw');
        await play(gsap.fromTo(card, { y: -70, x: 30, rotate: 28, scale: 1.15, opacity: 0.4 }, { y: 0, x: 0, rotate: 0, scale: 1, opacity: 1, duration: 0.36, ease: 'power2.in', clearProps: 'transform,opacity' }));
      }
      env.sound('se_card_place');
      const b = boxOf(env, card);
      if (!b) return;
      // マスキングテープ「ペタッ」→ 小さな土ぼこり
      await tape(env, b);
      dust(env, { x: b.x + b.w / 2, y: b.y + b.h - 4 });
    },
  },
  Swapped: {
    async before(env, e, ctx) {
      ctx.flags.swapFrom = { a: boxOf(env, env.cardEl(e.toActive)), b: boxOf(env, env.cardEl(e.toBench)) };
    },
    async after(env, e, ctx) {
      const from = ctx.flags.swapFrom as { a: Box | null; b: Box | null };
      const ea = env.cardEl(e.toActive);
      const eb = env.cardEl(e.toBench);
      const ta = boxOf(env, ea);
      const tb = boxOf(env, eb);
      env.sound('se_swap');
      // 2枚が弧を描いて入れ替わる
      const arc = (el: HTMLElement | null, f: Box | null, t: Box | null, bend: number) => {
        if (!el || !f || !t) return Promise.resolve();
        const dx = f.x + f.w / 2 - (t.x + t.w / 2);
        const dy = f.y + f.h / 2 - (t.y + t.h / 2);
        return play(gsap.fromTo(el, { x: dx, y: dy, scale: f.w / t.w }, { keyframes: { x: [dx, dx / 2 + bend, 0], y: [dy, dy / 2 - Math.abs(bend) * 0.5, 0], easeEach: 'sine.inOut' }, scale: 1, rotate: 0, duration: 0.5, ease: 'none', clearProps: 'transform' }));
      };
      const ca = ta ? { x: ta.x + ta.w / 2, y: ta.y + ta.h / 2 } : STAGE_CENTER;
      const cb = tb ? { x: tb.x + tb.w / 2, y: tb.y + tb.h / 2 } : STAGE_CENTER;
      await Promise.all([arc(ea, from.a, ta, -90), arc(eb, from.b, tb, 90), swapArrow(env, ca, cb)]);
    },
  },
  ItemUsed: { before: itemBefore, after: itemAfter },
  BuffChanged: { before: buffBefore, after: buffAfter },
  HpSet: { before: hpSetBefore, after: hpSetAfter },
  Healed: { before: healBefore, after: healAfter },
  MoveSelected: {
    async after(env, e) {
      // 技表の該当行に蛍光ペン
      env.markMove(e.uid, e.moveIndex);
      env.sound('se_pen');
      await wait(420);
    },
  },
  Damaged: { before: damageBefore, after: damageAfter },
  Fainted: { before: faintBefore, after: faintAfter },
  Promoted: { before: promoteBefore, after: promoteAfter },
  TurnEnded: {
    async after(env, _e, ctx) {
      env.markMove(null, null);
      clearDie(ctx);
    },
  },
  GameOver: {
    async after(env, _e, ctx) {
      clearDie(ctx);
      // 決着：画面が白くフラッシュ → リザルトへ
      env.slowMo(1);
      if (env.reduce()) await wait(500);
      else await flash(env, 0.8, 1);
    },
  },
};
