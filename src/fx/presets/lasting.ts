import { gsap } from 'gsap';
import type { GameEvent, Lasting } from '../../engine/types';
import type { FxEnv, StepContext } from '../env';
import { type Box, type Point, boxOf, centerOf, rand, spawn, spawnSvg } from '../overlay';
import { cardCenter, confetti, flash, focusLines, hatchFlash, inkBurst, onomatopoeia, particles, shake } from '../parts';
import { play, wait } from '../timing';
import { t } from '../../i18n';

/**
 * 持続効果の演出（v2.5）。攻撃の動き（相手が突進してくる動き）は使わず、持続効果だけの動きにする。
 * - 持続ダメージ：赤い札が光ってふくらむ → 赤いインクのしずくになってカードへ飛ぶ →（Damaged）カードが小さく震えて数字
 * - 持続回復：緑の札が光る → 緑の光の粒がカードの下から上へ立ちのぼる →（Healed）回復の数字
 * - ばくだん：黒い札が赤く点滅 → 爆発の煙と紙吹雪 →（Fainted）気絶
 * - 遅延ドロー：山札の青い札が光る →（Drew）山札からカードが1枚ずつ手札へ
 * - ターンが進む：1行目が消えたあと、2行目以下が1つずつ上がる。遅延ドローの「あと」が1減る
 * - ベンチに戻って消える：赤と緑の札が、しゅわっと泡になって消える
 * 「演出をへらす」の時は、札が光って数字が出るだけ。
 */

type Ev<K extends GameEvent['type']> = Extract<GameEvent, { type: K }>;

/** 札の要素（表・ベンチ・山札）。入りきらずに隠れている時は「+2」の札 */
function tagEl(env: FxEnv, l: Lasting): HTMLElement | null {
  const own = env.root.querySelector(`.lasting-table [data-seq="${l.seq}"], .lasting-bench [data-seq="${l.seq}"], .lasting-draws [data-seq="${l.seq}"]`);
  if (own instanceof HTMLElement) return own;
  if (l.targetUid === null) return null;
  const more = env.root.querySelector(`[data-lasting-uid="${l.targetUid}"] [data-more-row="${Math.max(1, l.turns)}"]`);
  return more instanceof HTMLElement ? more : null;
}

/** 札が光ってふくらむ（発動の合図。「演出をへらす」でもこれは出す） */
async function glow(el: HTMLElement | null, ms: number, still = false): Promise<void> {
  if (!el || still) {
    el?.classList.add('is-fire');
    await wait(ms);
    return;
  }
  el.classList.add('is-fire');
  await play(gsap.fromTo(el, { y: 0 }, { y: -3, duration: ms / 2000, yoyo: true, repeat: 1, ease: 'sine.inOut', clearProps: 'y' }));
}

function unglow(el: HTMLElement | null): void {
  el?.classList.remove('is-fire', 'is-blink');
}

/** 札そのもの（消えてよい）か。「+N」の札は、隠れた札の代わりに光るだけで、消さない */
const isTag = (el: HTMLElement | null): el is HTMLElement => !!el && !el.classList.contains('lasting-more');

// ---------------------------------------------------------------- 付く

/** 札がぽんと付く（3ターンより先のものは、まだ出ていないので何もしない） */
export async function lastingAddedAfter(env: FxEnv, e: Ev<'LastingAdded'>): Promise<void> {
  const el = env.root.querySelector(`.lasting-table [data-seq="${e.lasting.seq}"], .lasting-bench [data-seq="${e.lasting.seq}"], .lasting-draws [data-seq="${e.lasting.seq}"]`);
  if (!(el instanceof HTMLElement)) return;
  env.sound('se_pen');
  if (env.reduce()) return;
  await play(gsap.fromTo(el, { scale: 2, opacity: 0, y: -14 }, { scale: 1, opacity: 1, y: 0, duration: 0.26, ease: 'back.out(3)', clearProps: 'scale,opacity,y' }));
}

// ---------------------------------------------------------------- 発動

export async function lastingFiredBefore(env: FxEnv, e: Ev<'LastingFired'>, ctx: StepContext): Promise<void> {
  const l = e.lasting;
  ctx.flags.lasting = l;
  const el = tagEl(env, l);
  if (env.reduce()) {
    // 札が光るだけ（このあと数字が出る）
    env.sound(l.kind === 'faint' ? 'se_lasting_bomb' : l.kind === 'draw' ? 'se_lasting_draw' : l.kind === 'heal' ? 'se_lasting_heal' : 'se_lasting_damage');
    // 動かさず、光るだけ
    await glow(el, 420, true);
    unglow(el);
    return;
  }
  if (l.kind === 'damage' || l.kind === 'selfDamage') await inkDrop(env, l, el);
  else if (l.kind === 'heal') await healRise(env, l, el);
  else if (l.kind === 'faint') await bombBlast(env, l, el);
  else await drawShine(env, el);
  // 「+N」の札は残るので、元の見た目に戻す（札そのものは、このあと表示から消える）
  if (el && !isTag(el)) {
    unglow(el);
    gsap.set(el, { clearProps: 'scale,opacity,y' });
  }
}

/** 持続ダメージ：札がふくらんで赤いインクのしずくになり、弧を描いてカードへ飛ぶ */
async function inkDrop(env: FxEnv, l: Lasting, el: HTMLElement | null): Promise<void> {
  await glow(el, 380);
  const from = centerOf(env, el) ?? { x: 470, y: 300 };
  const to = cardCenter(env, l.targetUid as string);
  // 札がしずくに変わる（札は消え、同じ場所に赤いしずく）
  if (isTag(el)) gsap.to(el, { scale: 0.2, opacity: 0, duration: 0.14, ease: 'power2.in' });
  const drop = spawn(
    env,
    'fx-lasting-drop',
    from,
    `<svg viewBox="0 0 40 52" width="40" height="52"><path d="M20 3 Q6 26 7 35 Q8 49 20 49 Q32 49 33 35 Q34 26 20 3 Z" fill="var(--pen-red)" stroke="var(--ink)" stroke-width="2"/><path d="M13 33 Q13 41 19 43" fill="none" stroke="var(--paper)" stroke-width="2.5" stroke-linecap="round" opacity="0.7"/></svg>`,
  );
  await play(gsap.fromTo(drop, { scale: 0.3 }, { scale: 1.15, duration: 0.14, ease: 'back.out(3)' }));
  // 弧を描いて飛ぶ。通り道にインクの点を落とす
  const mid = { x: (from.x + to.x) / 2, y: Math.min(from.y, to.y) - 70 };
  const proxy = { p: 0 };
  let lastDot = 0;
  await play(
    gsap.to(proxy, {
      p: 1,
      duration: 0.42,
      ease: 'power1.in',
      onUpdate: () => {
        const q = proxy.p;
        const x = (1 - q) * (1 - q) * from.x + 2 * (1 - q) * q * mid.x + q * q * to.x;
        const y = (1 - q) * (1 - q) * from.y + 2 * (1 - q) * q * mid.y + q * q * to.y;
        const dx = 2 * (1 - q) * (mid.x - from.x) + 2 * q * (to.x - mid.x);
        const dy = 2 * (1 - q) * (mid.y - from.y) + 2 * q * (to.y - mid.y);
        drop.style.left = `${x}px`;
        drop.style.top = `${y}px`;
        // しずくの丸い方を、飛ぶ向きに向ける
        gsap.set(drop, { rotate: (Math.atan2(dy, dx) * 180) / Math.PI - 90, scale: 1.15 - q * 0.25 });
        if (q - lastDot > 0.12) {
          lastDot = q;
          particles(env, { kind: 'drop', x, y, count: 2, colors: ['var(--pen-red)'], speed: [20, 60], size: [2, 4], life: [0.3, 0.5], gravity: 500 });
        }
      },
    }),
  );
  drop.remove();
  // ぶつかった所に赤いインクがしみる
  env.sound('se_lasting_damage');
  inkBurst(env, to, ['var(--pen-red)', 'var(--ink)'], 30, 0.9);
  const splat = spawnSvg(env, 'fx-lasting-splat', splatPath(to, 34));
  void onomatopoeia(env, { x: to.x - 120, y: to.y + 40 }, t().fx.lastingDrip);
  gsap.fromTo(splat, { scale: 0.2, opacity: 1, transformOrigin: `${to.x}px ${to.y}px` }, { scale: 1, duration: 0.18, ease: 'back.out(2)' });
  gsap.to(splat, { opacity: 0, duration: 0.5, delay: 0.5, onComplete: () => splat.remove() });
}

/** インクのしみ（ぎざぎざの丸） */
function splatPath(at: Point, r: number): string {
  const pts: string[] = [];
  const n = 14;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const rr = r * (i % 2 === 0 ? rand(0.9, 1.35) : rand(0.55, 0.75));
    pts.push(`${i === 0 ? 'M' : 'L'}${(at.x + Math.cos(a) * rr).toFixed(1)} ${(at.y + Math.sin(a) * rr).toFixed(1)}`);
  }
  return `<path d="${pts.join(' ')} Z" fill="var(--pen-red)" opacity="0.75"/>`;
}

/** 持続回復：札が緑の光の粒にほどけ、カードの下から上へ光が立ちのぼる */
async function healRise(env: FxEnv, l: Lasting, el: HTMLElement | null): Promise<void> {
  await glow(el, 380);
  const from = centerOf(env, el) ?? { x: 470, y: 300 };
  const card = boxOf(env, env.cardEl(l.targetUid as string)) ?? ({ x: 565, y: 336, w: 150, h: 210 } as Box);
  if (isTag(el)) gsap.to(el, { scale: 1.6, opacity: 0, duration: 0.25, ease: 'power1.out' });
  // 札が粒にほどけて、カードの足もとへ
  particles(env, { kind: 'spark', x: from.x, y: from.y, count: 16, colors: ['var(--pen-green)', 'var(--fx-leaf)'], speed: [60, 180], size: [3, 6], life: [0.3, 0.6], gravity: 0, area: 10 });
  const motes = Array.from({ length: 9 }, () => spawn(env, 'fx-lasting-mote', from));
  await play(
    gsap.to(motes, {
      left: () => card.x + rand(12, card.w - 12),
      top: card.y + card.h - 8,
      duration: 0.32,
      stagger: 0.02,
      ease: 'power2.in',
    }),
  );
  motes.forEach((m) => m.remove());
  // 光の柱が下から上へ。光の粒が立ちのぼる
  env.sound('se_lasting_heal');
  const pillar = spawn(env, 'fx-lasting-pillar', { x: card.x + card.w / 2, y: card.y + card.h });
  pillar.style.width = `${card.w + 30}px`;
  gsap.fromTo(pillar, { height: 0, opacity: 0.95 }, { height: card.h + 60, duration: 0.55, ease: 'power2.out' });
  gsap.to(pillar, { opacity: 0, duration: 0.4, delay: 0.55, onComplete: () => pillar.remove() });
  for (let i = 0; i < 3; i++) {
    particles(env, {
      kind: i === 1 ? 'plus' : 'spark',
      x: card.x + card.w / 2,
      y: card.y + card.h - 6,
      count: i === 1 ? 8 : 16,
      colors: ['var(--pen-green)', 'var(--fx-leaf)', 'var(--marker-yellow)'],
      angle: -Math.PI / 2,
      spread: 0.35,
      speed: [120, 300],
      size: [3, 7],
      life: [0.7, 1.2],
      gravity: -120,
      drag: 0.4,
      area: card.w / 2,
    });
  }
  void onomatopoeia(env, { x: card.x - 70, y: card.y + card.h * 0.6 }, t().fx.lastingRise);
  await wait(420);
}

/** ばくだん：黒い札が赤く点滅 → カードが震える → 爆発の煙と紙吹雪 */
async function bombBlast(env: FxEnv, l: Lasting, el: HTMLElement | null): Promise<void> {
  const card = env.cardEl(l.targetUid as string);
  const at = cardCenter(env, l.targetUid as string);
  env.sound('se_lasting_fuse');
  el?.classList.add('is-fire');
  for (let i = 0; i < 5; i++) {
    el?.classList.toggle('is-blink', true);
    if (card) gsap.fromTo(card, { x: -3 }, { x: 3, duration: 0.04, yoyo: true, repeat: 1, clearProps: 'x' });
    await wait(90 - i * 8);
    el?.classList.toggle('is-blink', false);
    await wait(70 - i * 8);
  }
  unglow(el);
  // ばくはつ
  env.sound('se_lasting_bomb');
  env.duckBgm();
  void flash(env, 0.35, 0.9);
  void shake(env, true);
  void focusLines(env, at, 0.7, 'var(--pen-red)');
  for (let i = 0; i < 7; i++) {
    const puff = spawn(env, 'fx-lasting-smoke', { x: at.x + rand(-40, 40), y: at.y + rand(-40, 40) });
    const s = rand(0.9, 1.7);
    gsap.fromTo(puff, { scale: 0.2, opacity: 0.95 }, { scale: s, x: rand(-70, 70), y: rand(-90, 10), opacity: 0, duration: rand(0.7, 1.1), ease: 'power2.out', onComplete: () => puff.remove() });
  }
  confetti(env, 46, at, Math.PI * 2, -Math.PI / 2);
  particles(env, { kind: 'spark', x: at.x, y: at.y, count: 26, colors: ['var(--pen-red)', 'var(--marker-yellow)', 'var(--ink)'], speed: [200, 560], size: [4, 9], life: [0.4, 0.8], gravity: 200 });
  inkBurst(env, at, ['var(--ink)'], 30, 1.3);
  void onomatopoeia(env, { x: at.x, y: at.y - 30 }, t().fx.lastingBoom, true);
  await wait(520);
}

/** 遅延ドロー：山札の青い札が光り、山札のまわりにきらきら */
async function drawShine(env: FxEnv, el: HTMLElement | null): Promise<void> {
  env.sound('se_lasting_draw');
  const at = centerOf(env, el);
  if (at) {
    particles(env, { kind: 'spark', x: at.x, y: at.y, count: 22, colors: ['var(--pen-blue)', 'var(--pen-sky)', 'var(--marker-yellow)'], speed: [80, 260], size: [3, 7], life: [0.5, 0.9], gravity: -40, area: 30 });
    const ring = spawn(env, 'fx-lasting-ring', at);
    gsap.fromTo(ring, { scale: 0.3, opacity: 1 }, { scale: 2.4, opacity: 0, duration: 0.55, ease: 'power2.out', onComplete: () => ring.remove() });
    void onomatopoeia(env, { x: at.x - 80, y: at.y - 30 }, t().fx.lastingDraw);
  }
  await glow(el, 520);
  if (isTag(el)) await play(gsap.to(el, { scale: 0.3, opacity: 0, duration: 0.18, ease: 'power2.in' }));
}

/** 持続ダメージでの Damaged：攻撃の突進は使わず、カードが小さく震えるだけ */
export async function lastingDamagedBefore(env: FxEnv, e: Ev<'Damaged'>): Promise<void> {
  const card = env.cardEl(e.uid);
  if (env.reduce() || !card) return;
  env.sound('se_hit_small');
  void hatchFlash(env, card);
  await play(gsap.fromTo(card, { x: -6, rotate: -1.5 }, { x: 6, rotate: 1.5, duration: 0.05, yoyo: true, repeat: 5, ease: 'none', clearProps: 'x,rotate' }));
}

// ---------------------------------------------------------------- ターンが進む（行が1つ上がる・「あと」が減る）

type Snap = { seq: number; box: Box };

export async function lastingTickedBefore(env: FxEnv, _e: Ev<'LastingTicked'>, ctx: StepContext): Promise<void> {
  const snap: Snap[] = [];
  env.root.querySelectorAll<HTMLElement>('.lasting-table [data-seq], .lasting-bench [data-seq]').forEach((el) => {
    const b = boxOf(env, el);
    if (b) snap.push({ seq: Number(el.dataset.seq), box: b });
  });
  ctx.flags.tickSnap = snap;
}

export async function lastingTickedAfter(env: FxEnv, e: Ev<'LastingTicked'>, ctx: StepContext): Promise<void> {
  if (env.reduce()) return;
  const snap = (ctx.flags.tickSnap as Snap[] | undefined) ?? [];
  const moves: Promise<void>[] = [];
  // 表の札：前の場所から今の場所へ（行が1つ上がる）。新しく3行目に入ってきたものは下からふわっと出る
  env.root.querySelectorAll<HTMLElement>('.lasting-table [data-seq]').forEach((el) => {
    const seq = Number(el.dataset.seq);
    if (!e.seqs.includes(seq)) return;
    const now = boxOf(env, el);
    const was = snap.find((s) => s.seq === seq)?.box;
    if (!now) return;
    if (was) moves.push(play(gsap.fromTo(el, { x: was.x - now.x, y: was.y - now.y }, { x: 0, y: 0, duration: 0.38, ease: 'back.out(1.6)', clearProps: 'x,y' })));
    else moves.push(play(gsap.fromTo(el, { y: 26, opacity: 0, scale: 0.5 }, { y: 0, opacity: 1, scale: 1, duration: 0.36, ease: 'back.out(2)', clearProps: 'y,opacity,scale' })));
  });
  // 遅延ドローの「あと」：数字が1つ減る（前の数字が下へ落ちて、新しい数字がぽんと出る）
  env.root.querySelectorAll<HTMLElement>(`[data-lasting-draws="${e.player}"] [data-seq]`).forEach((el) => {
    if (!e.seqs.includes(Number(el.dataset.seq))) return;
    const num = el.querySelector<HTMLElement>('[data-left]');
    const b = boxOf(env, num);
    if (!num || !b) return;
    const ghost = spawn(env, 'fx-lasting-left', { x: b.x + b.w / 2, y: b.y + b.h / 2 }, String(Number(num.textContent) + 1));
    gsap.to(ghost, { y: 26, opacity: 0, rotate: 25, duration: 0.4, ease: 'power2.in', onComplete: () => ghost.remove() });
    moves.push(play(gsap.fromTo(num, { scale: 2.2, rotate: -12 }, { scale: 1, rotate: 0, duration: 0.42, ease: 'back.out(3)', clearProps: 'scale,rotate' })));
  });
  if (moves.length === 0) return;
  env.sound('se_pen');
  await Promise.all(moves);
}

// ---------------------------------------------------------------- ベンチに戻って消える

export async function lastingClearedBefore(env: FxEnv, e: Ev<'LastingCleared'>): Promise<void> {
  const els = e.seqs.map((seq) => env.root.querySelector<HTMLElement>(`.lasting-table [data-seq="${seq}"]`)).filter((x): x is HTMLElement => !!x);
  const more = env.root.querySelectorAll<HTMLElement>(`[data-lasting-uid="${e.uid}"] .lasting-more`);
  const all = [...els, ...more];
  if (all.length === 0) return;
  env.sound('se_lasting_clear');
  if (env.reduce()) {
    await play(gsap.to(all, { opacity: 0, duration: 0.2 }));
    return;
  }
  for (const el of all) {
    const c = centerOf(env, el);
    if (!c) continue;
    const red = el.classList.contains('lasting-tag--damage');
    particles(env, { kind: 'bubble', x: c.x, y: c.y, count: 9, colors: [red ? 'var(--pen-red)' : 'var(--pen-green)', 'var(--pen-sky)'], angle: -Math.PI / 2, spread: 1.2, speed: [40, 140], size: [3, 8], life: [0.5, 1.0], gravity: -160, area: 14 });
  }
  const c0 = centerOf(env, all[0]);
  if (c0) void onomatopoeia(env, { x: c0.x, y: c0.y - 20 }, t().fx.lastingFizz);
  await play(
    gsap
      .timeline()
      .to(all, { scale: 1.25, duration: 0.12, stagger: 0.04, ease: 'power1.out' })
      .to(all, { scale: 0.1, opacity: 0, y: -18, duration: 0.3, stagger: 0.04, ease: 'power2.in' }),
  );
}
