import { MIX } from './recipes';
import { makeReverb } from './reverb';

/**
 * 音の通り道（SPEC §10-3 mixer.ts）
 *
 *   効果音 ─┬─────────────→ 効果音バス ─┐
 *           └→ 残響（短・長）→ ┘            ├→ マスターのコンプレッサー → スピーカー
 *   BGM（howler.js）──────────→ BGM バス ─┘   （大ダメージ・きぜつの時は BGM バスを一瞬下げる）
 * howler と同じ AudioContext を使うので、BGM も同じ通り道を通る。数値は recipes.ts の MIX。
 *
 * コンプレッサーを通すので、たくさん重ねても音割れしにくい。
 */
export class Mixer {
  readonly ctx: BaseAudioContext;
  readonly master: GainNode;
  readonly se: GainNode;
  /** BGM バス（howler の出口をここへつなぐ） */
  readonly bgm: GainNode;
  private bgmLevel = 0.6;
  private ducks = 0;
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
    this.comp.threshold.value = MIX.compressor.threshold;
    this.comp.knee.value = MIX.compressor.knee;
    this.comp.ratio.value = MIX.compressor.ratio;
    this.comp.attack.value = MIX.compressor.attack;
    this.comp.release.value = MIX.compressor.release;
    this.master = ctx.createGain();
    this.master.gain.value = MIX.master;
    this.comp.connect(this.master).connect(ctx.destination);

    this.se = ctx.createGain();
    this.se.connect(this.comp);
    this.bgm = ctx.createGain();
    this.bgm.gain.value = this.bgmLevel;
    this.bgm.connect(this.comp);

    const short = makeReverb(ctx, MIX.reverbShort);
    const long = makeReverb(ctx, MIX.reverbLong);
    this.reverbShort = ctx.createGain();
    this.reverbLong = ctx.createGain();
    this.reverbShort.connect(short).connect(this.se);
    this.reverbLong.connect(long).connect(this.se);
  }

  /** BGM の音量（0〜1） */
  setBgmVolume(v: number): void {
    this.bgmLevel = v;
    if (this.ducks === 0) this.bgm.gain.setTargetAtTime(v, this.ctx.currentTime, 0.02);
  }

  /** BGM を一瞬下げる（SPEC §10-3：0.4秒だけ 40% 下げる） */
  duckBgm(): void {
    const t = this.ctx.currentTime;
    this.ducks += 1;
    this.bgm.gain.cancelScheduledValues(t);
    this.bgm.gain.setTargetAtTime(this.bgmLevel * MIX.duck.level, t, 0.015);
    window.setTimeout(() => {
      this.ducks -= 1;
      if (this.ducks === 0) this.bgm.gain.setTargetAtTime(this.bgmLevel, this.ctx.currentTime, 0.08);
    }, MIX.duck.seconds * 1000);
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
