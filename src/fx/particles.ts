/**
 * Canvas の軽い粒子（SPEC §2「自作の軽量パーティクル」、§9-1 インク飛び・紙くず・紙吹雪）
 * 舞台（1280×720）と同じ大きさの canvas に描く。演出スピードで速くなり、「演出をへらす」の時は出さない。
 */

export type ParticleKind = 'ink' | 'drop' | 'paper' | 'leaf' | 'plus' | 'splash' | 'bubble' | 'spark' | 'crumb' | 'dust';

type P = {
  kind: ParticleKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** 重力（下向き、px/s²） */
  g: number;
  /** 空気抵抗（1秒あたりに残る割合） */
  drag: number;
  rot: number;
  vr: number;
  size: number;
  color: string;
  life: number;
  age: number;
  /** 紙吹雪の回転（裏返り）の位相 */
  flip: number;
  vflip: number;
};

export type BurstOptions = {
  kind: ParticleKind;
  x: number;
  y: number;
  count: number;
  colors: string[];
  /** 飛ぶ速さ（px/s）の範囲 */
  speed?: [number, number];
  /** 飛ぶ向き（ラジアン）の中心と広がり */
  angle?: number;
  spread?: number;
  size?: [number, number];
  life?: [number, number];
  gravity?: number;
  drag?: number;
  /** 出る場所のばらつき（px） */
  area?: number;
};

const r = (a: number, b: number) => a + Math.random() * (b - a);

/** CSS 変数の色を実際の色にする（canvas は var() を読めないため） */
export function cssColor(v: string): string {
  const m = /^var\((--[\w-]+)\)$/.exec(v.trim());
  if (!m) return v;
  return getComputedStyle(document.documentElement).getPropertyValue(m[1]).trim() || 'black';
}

export class Particles {
  private readonly ctx: CanvasRenderingContext2D;
  private list: P[] = [];
  private raf = 0;
  private last = 0;
  private paused = false;
  /** 紙・方眼・光の色（CSS 変数から読む） */
  private readonly colors = { paper: cssColor('var(--paper)'), grid: cssColor('var(--grid-major)'), shine: cssColor('var(--fx-shine)') };

  constructor(
    canvas: HTMLCanvasElement,
    /** 演出スピードの倍率 */
    private readonly speed: () => number,
  ) {
    canvas.width = 1280;
    canvas.height = 720;
    this.ctx = canvas.getContext('2d')!;
  }

  burst(o: BurstOptions): void {
    const colors = o.colors.map(cssColor);
    const [s0, s1] = o.speed ?? [200, 600];
    const [z0, z1] = o.size ?? [3, 8];
    const [l0, l1] = o.life ?? [0.6, 1.2];
    const area = o.area ?? 6;
    for (let i = 0; i < o.count; i++) {
      const a = (o.angle ?? -Math.PI / 2) + r(-1, 1) * (o.spread ?? Math.PI);
      const sp = r(s0, s1);
      this.list.push({
        kind: o.kind,
        x: o.x + r(-area, area),
        y: o.y + r(-area, area),
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        g: o.gravity ?? 900,
        drag: o.drag ?? 0.35,
        rot: r(0, Math.PI * 2),
        vr: r(-8, 8),
        size: r(z0, z1),
        color: colors[i % colors.length],
        life: r(l0, l1),
        age: 0,
        flip: r(0, Math.PI * 2),
        vflip: r(4, 12),
      });
    }
    if (!this.raf) {
      this.last = performance.now();
      this.raf = requestAnimationFrame(this.frame);
    }
  }

  /** ヒットストップの間は止める */
  pause(v: boolean): void {
    this.paused = v;
  }

  clear(): void {
    this.list = [];
  }

  dispose(): void {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.list = [];
  }

  private readonly frame = (now: number) => {
    const dt = this.paused ? 0 : Math.min(0.05, (now - this.last) / 1000) * this.speed();
    this.last = now;
    const c = this.ctx;
    c.clearRect(0, 0, 1280, 720);
    const keep: P[] = [];
    for (const p of this.list) {
      p.age += dt;
      if (p.age >= p.life) continue;
      const k = Math.pow(p.drag, dt);
      p.vx *= k;
      p.vy = p.vy * k + p.g * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.vr * dt;
      p.flip += p.vflip * dt;
      this.draw(p);
      keep.push(p);
    }
    this.list = keep;
    this.raf = keep.length > 0 ? requestAnimationFrame(this.frame) : 0;
    if (!this.raf) c.clearRect(0, 0, 1280, 720);
  };

  private draw(p: P): void {
    const c = this.ctx;
    const t = p.age / p.life;
    const alpha = t < 0.7 ? 1 : 1 - (t - 0.7) / 0.3;
    c.save();
    c.globalAlpha = alpha;
    c.translate(p.x, p.y);
    c.rotate(p.rot);
    c.fillStyle = p.color;
    c.strokeStyle = p.color;
    switch (p.kind) {
      case 'ink': {
        // ペンのインクの点
        c.beginPath();
        c.arc(0, 0, p.size * (1 - t * 0.4), 0, Math.PI * 2);
        c.fill();
        break;
      }
      case 'drop': {
        // 滴（進む向きに伸びる）
        c.rotate(Math.atan2(p.vy, p.vx) - p.rot);
        c.beginPath();
        c.ellipse(0, 0, p.size * 1.8, p.size * 0.8, 0, 0, Math.PI * 2);
        c.fill();
        break;
      }
      case 'paper': {
        // 方眼紙の切れ端（くるくる裏返る）
        const w = p.size * 2.2;
        const h = p.size * 1.5 * Math.abs(Math.cos(p.flip));
        c.fillStyle = this.colors.paper;
        c.fillRect(-w / 2, -h / 2, w, h);
        c.globalAlpha = alpha * 0.9;
        c.fillStyle = p.color;
        c.fillRect(-w / 2, -h / 2, w, Math.max(1, h * 0.28));
        c.strokeStyle = this.colors.grid;
        c.lineWidth = 1;
        c.beginPath();
        c.moveTo(-w / 6, -h / 2);
        c.lineTo(-w / 6, h / 2);
        c.moveTo(w / 6, -h / 2);
        c.lineTo(w / 6, h / 2);
        c.stroke();
        break;
      }
      case 'leaf': {
        c.beginPath();
        c.moveTo(-p.size, 0);
        c.quadraticCurveTo(0, -p.size * 0.9, p.size, 0);
        c.quadraticCurveTo(0, p.size * 0.9, -p.size, 0);
        c.fill();
        c.strokeStyle = this.colors.shine;
        c.lineWidth = 1;
        c.beginPath();
        c.moveTo(-p.size * 0.8, 0);
        c.lineTo(p.size * 0.8, 0);
        c.stroke();
        break;
      }
      case 'plus': {
        c.rotate(-p.rot * 0.9);
        c.lineWidth = Math.max(2, p.size / 3.5);
        c.lineCap = 'round';
        c.beginPath();
        c.moveTo(-p.size, 0);
        c.lineTo(p.size, 0);
        c.moveTo(0, -p.size);
        c.lineTo(0, p.size);
        c.stroke();
        break;
      }
      case 'splash': {
        c.rotate(Math.atan2(p.vy, p.vx) - p.rot);
        c.beginPath();
        c.ellipse(0, 0, p.size * 1.6, p.size * 0.7, 0, 0, Math.PI * 2);
        c.fill();
        c.fillStyle = this.colors.shine;
        c.beginPath();
        c.arc(-p.size * 0.4, -p.size * 0.2, p.size * 0.25, 0, Math.PI * 2);
        c.fill();
        break;
      }
      case 'bubble': {
        c.lineWidth = 2;
        c.beginPath();
        c.arc(0, 0, p.size * (0.7 + t * 0.5), 0, Math.PI * 2);
        c.stroke();
        break;
      }
      case 'spark': {
        // きらきら（4方向の光）
        const s = p.size * (1 - Math.abs(t - 0.4));
        c.lineWidth = 2;
        c.lineCap = 'round';
        c.beginPath();
        c.moveTo(-s, 0);
        c.lineTo(s, 0);
        c.moveTo(0, -s);
        c.lineTo(0, s);
        c.stroke();
        break;
      }
      case 'crumb': {
        // 消しゴムのかす
        c.fillRect(-p.size, -p.size / 2, p.size * 2, p.size);
        break;
      }
      case 'dust': {
        // 土ぼこり（ペンのうずまき）
        c.lineWidth = 2;
        c.globalAlpha = alpha * 0.8;
        c.beginPath();
        c.arc(0, 0, p.size * (0.6 + t), 0.3, Math.PI * 1.6);
        c.stroke();
        break;
      }
    }
    c.restore();
  }
}
