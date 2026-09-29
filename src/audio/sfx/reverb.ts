/**
 * 残響（SPEC §10-3 reverb.ts）
 * ノイズを少しずつ小さくしたものを「インパルス応答」にして ConvolverNode に入れる。
 * 部屋の響きを録音しなくても、それらしい残響になる。
 */

export type ReverbSpec = {
  /** 長さ（秒） */
  seconds: number;
  /** 減り方（大きいほど早く消える） */
  decay: number;
  /** 最初の反射までの遅れ（秒） */
  preDelay?: number;
  /** 高い音の消えやすさ（0〜1。大きいほど こもった響き） */
  damp?: number;
};

export function makeImpulse(ctx: BaseAudioContext, spec: ReverbSpec): AudioBuffer {
  const rate = ctx.sampleRate;
  const len = Math.max(1, Math.floor(rate * spec.seconds));
  const pre = Math.floor(rate * (spec.preDelay ?? 0.01));
  const buf = ctx.createBuffer(2, len, rate);
  const damp = spec.damp ?? 0.4;
  for (let ch = 0; ch < 2; ch++) {
    const data = buf.getChannelData(ch);
    let lp = 0;
    for (let i = pre; i < len; i++) {
      const t = (i - pre) / (len - pre);
      const white = Math.random() * 2 - 1;
      // 時間がたつほど高い音を削る（ひとつ前の値と混ぜるローパス）
      const k = 1 - damp * t;
      lp = lp + k * (white - lp);
      data[i] = lp * Math.pow(1 - t, spec.decay);
    }
  }
  return buf;
}

export function makeReverb(ctx: BaseAudioContext, spec: ReverbSpec): ConvolverNode {
  const node = ctx.createConvolver();
  node.buffer = makeImpulse(ctx, spec);
  return node;
}
