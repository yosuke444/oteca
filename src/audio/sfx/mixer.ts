import { makeReverb } from './reverb';

/**
 * 音の通り道（SPEC §10-3 mixer.ts）
 *
 *   効果音 ─┬─────────────→ 効果音バス ─┐
 *           └→ 残響（短・長）→ ┘            ├→ マスターのコンプレッサー → スピーカー
 *   BGM は howler.js が鳴らし、音量は BGM バスの値を使う ┘
 *
 * コンプレッサーを通すので、たくさん重ねても音割れしにくい。
 */
export class Mixer {
  readonly ctx: BaseAudioContext;
  readonly master: GainNode;
  readonly se: GainNode;
  /** 残響へ送る入口（短い／長い） */
  readonly reverbShort: GainNode;
  readonly reverbLong: GainNode;
  private readonly comp: DynamicsCompressorNode;
  private noiseCache = new Map<string, AudioBuffer>();

  /** ctx を渡すと、その中で鳴らす（試聴ページの自動チェックで OfflineAudioContext に書き出す時） */
  constructor(given?: BaseAudioContext) {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = given ?? new Ctx();
    this.ctx = ctx;
    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -16;
    this.comp.knee.value = 12;
    this.comp.ratio.value = 6;
    this.comp.attack.value = 0.003;
    this.comp.release.value = 0.18;
    this.master = ctx.createGain();
    this.master.gain.value = 0.9;
    this.comp.connect(this.master).connect(ctx.destination);

    this.se = ctx.createGain();
    this.se.connect(this.comp);

    const short = makeReverb(ctx, { seconds: 0.9, decay: 3.2, preDelay: 0.008, damp: 0.5 });
    const long = makeReverb(ctx, { seconds: 2.6, decay: 2.4, preDelay: 0.02, damp: 0.35 });
    this.reverbShort = ctx.createGain();
    this.reverbLong = ctx.createGain();
    this.reverbShort.connect(short).connect(this.se);
    this.reverbLong.connect(long).connect(this.se);
  }

  /** 効果音の音量（0〜1） */
  setSeVolume(v: number): void {
    this.se.gain.setTargetAtTime(v, this.ctx.currentTime, 0.02);
  }

  /** ノイズの音源（白・ピンク・ブラウン）。2秒ぶん作って使い回す */
  noise(kind: 'white' | 'pink' | 'brown'): AudioBuffer {
    const hit = this.noiseCache.get(kind);
    if (hit) return hit;
    const len = this.ctx.sampleRate * 2;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    let b0 = 0,
      b1 = 0,
      b2 = 0,
      b3 = 0,
      b4 = 0,
      b5 = 0,
      b6 = 0,
      last = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      if (kind === 'white') d[i] = w;
      else if (kind === 'pink') {
        // Paul Kellet の近似
        b0 = 0.99886 * b0 + w * 0.0555179;
        b1 = 0.99332 * b1 + w * 0.0750759;
        b2 = 0.969 * b2 + w * 0.153852;
        b3 = 0.8665 * b3 + w * 0.3104856;
        b4 = 0.55 * b4 + w * 0.5329522;
        b5 = -0.7616 * b5 - w * 0.016898;
        d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
        b6 = w * 0.115926;
      } else {
        last = (last + 0.02 * w) / 1.02;
        d[i] = last * 3.5;
      }
    }
    this.noiseCache.set(kind, buf);
    return buf;
  }
}
