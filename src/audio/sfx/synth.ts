import type { Mixer } from './mixer';

/**
 * 合成エンジン（SPEC §10-3 synth.ts）
 * レシピ（数値データ）を受け取って、Web Audio のノードを組み立てて鳴らす。音源ファイルは使わない。
 * 音の調整は recipes.ts の数値だけで行う。
 */

export type Source = 'sine' | 'triangle' | 'square' | 'sawtooth' | 'white' | 'pink' | 'brown';

/** 音量エンベロープ（秒）。a 立ち上がり → d 減衰 → s 持続の大きさ（0〜1）で hold 秒 → r 余韻 */
export type Envelope = { a: number; d: number; s: number; r: number; hold?: number };

export type Layer = {
  src: Source;
  /** 大きさ（0〜1くらい） */
  gain: number;
  env: Envelope;
  /** ピッチ：開始 → 終了（Hz）。ノイズでは使わない */
  freq?: [number, number];
  /** ピッチが変わるのにかける時間（秒。省略時はエンベロープ全体） */
  freqTime?: number;
  /** 変化のカーブ（exp＝耳で聞いて自然、lin＝まっすぐ） */
  curve?: 'exp' | 'lin';
  /** 同じ音を少しずつ高さを変えて重ねる（倍率）。金属音やきらきらに使う */
  partials?: number[];
  /** フィルター：種類と周波数（開始 → 終了） */
  filter?: { type: 'lowpass' | 'highpass' | 'bandpass'; freq: [number, number]; q?: number; time?: number };
  /** 開始時刻のずれ（秒） */
  delay?: number;
  /** 左右の位置（-1 左 〜 1 右）。[開始, 終了] で動かせる */
  pan?: number | [number, number];
  /** ひずみ量（0〜1） */
  drive?: number;
  /** 残響の量（0〜1）と長さ */
  reverb?: number;
  reverbLong?: boolean;
  /** 「粒」モード：短い音を count 個、spread 秒の間に不規則にばらまく */
  grains?: {
    count: number;
    spread: number;
    /** 間隔のばらつき（0〜1） */
    jitter?: number;
    /** 1より大きいと、だんだん間隔が広がる（サイコロが止まっていく） */
    slowDown?: number;
    /** 粒ごとの高さのばらつき（倍率の幅） */
    pitchJitter?: number;
    /** 粒ごとの大きさのばらつき（0〜1） */
    gainJitter?: number;
    /** だんだん小さくする（0〜1） */
    fade?: number;
  };
  /** メロディ：t 秒後に f Hz を d 秒（g は大きさの倍率） */
  notes?: { t: number; f: number; d: number; g?: number }[];
};

export type Recipe = {
  layers: Layer[];
  /** 全体の大きさ */
  gain?: number;
};

/** 鳴らすたびの揺らぎ（SPEC §10-3：ピッチ ±3%、音量 ±10%） */
export const VARIATION = { pitch: 0.03, gain: 0.1 };

const rand = (a: number, b: number) => a + Math.random() * (b - a);

/** ひずみのカーブ */
function driveCurve(amount: number): Float32Array<ArrayBuffer> {
  const n = 1024;
  const k = amount * 60;
  const c = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    c[i] = ((1 + k) * x) / (1 + k * Math.abs(x));
  }
  return c;
}

function envLength(e: Envelope): number {
  return e.a + e.d + (e.hold ?? 0) + e.r;
}

function ramp(param: AudioParam, from: number, to: number, t0: number, t1: number, curve: 'exp' | 'lin'): void {
  param.setValueAtTime(from, t0);
  if (curve === 'exp' && from > 0 && to > 0) param.exponentialRampToValueAtTime(to, t1);
  else param.linearRampToValueAtTime(to, t1);
}

type Voice = {
  at: number;
  freqMul: number;
  gainMul: number;
  /** 長さを変える（メロディの音符） */
  length?: number;
  freqOverride?: number;
  /** 左右の位置を固定（粒モードで、粒ごとに位置を変える時） */
  pan?: number;
};

/** 1つの音（レイヤーの1回分）を鳴らす */
function voice(mx: Mixer, layer: Layer, v: Voice, out: AudioNode): void {
  const ctx = mx.ctx;
  const env = layer.env;
  const baseLen = envLength(env);
  const total = v.length !== undefined ? Math.max(v.length, env.a + 0.01) + env.r : baseLen;
  const t0 = v.at;
  const t1 = t0 + total;

  // 音源（作ったノードは鳴り終わったら全部外す）
  const sources: AudioScheduledSourceNode[] = [];
  const made: AudioNode[] = [];
  const srcOut = ctx.createGain();
  made.push(srcOut);
  if (layer.src === 'white' || layer.src === 'pink' || layer.src === 'brown') {
    const s = ctx.createBufferSource();
    s.buffer = mx.noise(layer.src);
    s.loop = true;
    s.playbackRate.value = v.freqMul;
    s.connect(srcOut);
    s.start(t0, rand(0, 1.5));
    sources.push(s);
  } else {
    const [f0, f1] = v.freqOverride !== undefined ? [v.freqOverride, v.freqOverride] : (layer.freq ?? [440, 440]);
    const partials = layer.partials ?? [1];
    for (const p of partials) {
      const o = ctx.createOscillator();
      o.type = layer.src;
      const ft = layer.freqTime ?? total;
      ramp(o.frequency, f0 * p * v.freqMul, f1 * p * v.freqMul, t0, t0 + Math.max(0.005, ft), layer.curve ?? 'exp');
      const g = ctx.createGain();
      g.gain.value = 1 / Math.sqrt(partials.length) / (partials.indexOf(p) * 0.35 + 1);
      o.connect(g).connect(srcOut);
      made.push(o, g);
      o.start(t0);
      sources.push(o);
    }
  }

  let node: AudioNode = srcOut;
  // ひずみ
  if (layer.drive && layer.drive > 0) {
    const ws = ctx.createWaveShaper();
    ws.curve = driveCurve(layer.drive);
    ws.oversample = '2x';
    made.push(ws);
    node.connect(ws);
    node = ws;
  }
  // フィルター
  if (layer.filter) {
    const f = ctx.createBiquadFilter();
    f.type = layer.filter.type;
    f.Q.value = layer.filter.q ?? 0.8;
    const [a, b] = layer.filter.freq;
    ramp(f.frequency, a, b, t0, t0 + Math.max(0.005, layer.filter.time ?? total), 'exp');
    made.push(f);
    node.connect(f);
    node = f;
  }
  // 音量エンベロープ
  const g = ctx.createGain();
  made.push(g);
  const peak = layer.gain * v.gainMul;
  const hold = v.length !== undefined ? Math.max(0, v.length - env.a - env.d) : (env.hold ?? 0);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.linearRampToValueAtTime(peak, t0 + Math.max(0.001, env.a));
  g.gain.exponentialRampToValueAtTime(Math.max(0.0001, peak * Math.max(0.0001, env.s)), t0 + env.a + Math.max(0.001, env.d));
  g.gain.setValueAtTime(Math.max(0.0001, peak * Math.max(0.0001, env.s)), t0 + env.a + env.d + hold);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + env.a + env.d + hold + Math.max(0.005, env.r));
  node.connect(g);
  node = g;
  // 左右
  if ((layer.pan !== undefined || v.pan !== undefined) && ctx.createStereoPanner) {
    const p = ctx.createStereoPanner();
    made.push(p);
    const [pa, pb] = v.pan !== undefined ? [v.pan, v.pan] : Array.isArray(layer.pan) ? layer.pan : [layer.pan ?? 0, layer.pan ?? 0];
    p.pan.setValueAtTime(pa, t0);
    p.pan.linearRampToValueAtTime(pb, t1);
    node.connect(p);
    node = p;
  }
  node.connect(out);
  // 残響
  if (layer.reverb && layer.reverb > 0) {
    const send = ctx.createGain();
    made.push(send);
    send.gain.value = layer.reverb;
    node.connect(send).connect(layer.reverbLong ? mx.reverbLong : mx.reverbShort);
  }
  for (const s of sources) s.stop(t1 + 0.05);
  // 終わったら外す（ノードがたまらないように）
  sources[0].onended = () => {
    for (const n of made) {
      try {
        n.disconnect();
      } catch {
        // すでに外れている
      }
    }
  };
}

/** レシピを鳴らす。when は AudioContext の時刻（省略で今すぐ） */
export function playRecipe(mx: Mixer, recipe: Recipe, when?: number): void {
  const ctx = mx.ctx;
  const now = when ?? ctx.currentTime + 0.005;
  const pitch = 1 + rand(-VARIATION.pitch, VARIATION.pitch);
  const vol = (1 + rand(-VARIATION.gain, VARIATION.gain)) * (recipe.gain ?? 1);
  const out = ctx.createGain();
  out.gain.value = vol;
  out.connect(mx.se);
  let end = now;
  for (const layer of recipe.layers) {
    const at = now + (layer.delay ?? 0);
    if (layer.notes) {
      for (const n of layer.notes) {
        voice(mx, layer, { at: at + n.t, freqMul: pitch, gainMul: n.g ?? 1, length: n.d, freqOverride: n.f }, out);
        end = Math.max(end, at + n.t + n.d + layer.env.r);
      }
    } else if (layer.grains) {
      const gr = layer.grains;
      const times: number[] = [];
      let t = 0;
      const slow = gr.slowDown ?? 1;
      // だんだん広がる間隔を、全体で spread 秒に収める
      const weights = Array.from({ length: gr.count }, (_, i) => Math.pow(slow, i));
      const sum = weights.reduce((s, w) => s + w, 0) || 1;
      for (let i = 0; i < gr.count; i++) {
        times.push(t);
        t += (weights[i] / sum) * gr.spread * (1 + rand(-1, 1) * (gr.jitter ?? 0.4));
      }
      const [p0, p1] = layer.pan === undefined ? [undefined, undefined] : Array.isArray(layer.pan) ? layer.pan : [layer.pan, layer.pan];
      times.forEach((tt, i) => {
        const k = i / Math.max(1, gr.count - 1);
        const fade = 1 - (gr.fade ?? 0) * k;
        const pan = p0 === undefined || p1 === undefined ? undefined : p0 + (p1 - p0) * k;
        voice(mx, layer, { at: at + tt, freqMul: pitch * (1 + rand(-1, 1) * (gr.pitchJitter ?? 0)), gainMul: fade * (1 - rand(0, gr.gainJitter ?? 0)), pan }, out);
      });
      end = Math.max(end, at + t + envLength(layer.env));
    } else {
      voice(mx, layer, { at, freqMul: pitch, gainMul: 1 }, out);
      end = Math.max(end, at + envLength(layer.env));
    }
  }
  // 全部鳴り終わったら出口も外す
  window.setTimeout(() => out.disconnect(), (end - ctx.currentTime + 3) * 1000);
}

/** レシピの長さ（秒）の目安 */
export function recipeLength(recipe: Recipe): number {
  let end = 0;
  for (const l of recipe.layers) {
    const d = l.delay ?? 0;
    if (l.notes) end = Math.max(end, d + Math.max(...l.notes.map((n) => n.t + n.d)) + l.env.r);
    else if (l.grains) end = Math.max(end, d + l.grains.spread + envLength(l.env));
    else end = Math.max(end, d + envLength(l.env));
  }
  return end;
}
