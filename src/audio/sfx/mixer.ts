import { MIX } from './recipes';
import { makeReverb } from './reverb';

/**
 * 音の通り道（SPEC §10-3 mixer.ts）
 *
 *   効果音 ─┬───────────────→ se ─→ コンプレッサー ─→ 効果音の音量 ─┐
 *           └→ 残響（短・長）→ ┘                                     ├→ master → リミッター → スピーカー
 *   BGM（howler.js）─→ bgm ─→ 一瞬下げる（duck）─→ BGM の音量 ───────┘
 * howler と同じ AudioContext を使うので、BGM もここを通る。数値は recipes.ts の MIX。
 *
 * - 設定の音量（BGM・効果音）は、コンプレッサーの「後」でかける。前でかけると、下げた分を
 *   コンプレッサーが持ち上げてしまい、音量を変えても あまり変わらなかったため。0 なら完全に無音
 * - 効果音はコンプレッサーを通すので、たくさん重ねても音割れしにくい。最後のリミッターは念のための音割れ止め
 */
export class Mixer {
  readonly ctx: BaseAudioContext;
  readonly master: GainNode;
  /** 効果音の入口 */
  readonly se: GainNode;
  /** BGM の入口（howler の出口をここへつなぐ） */
  readonly bgm: GainNode;
  /** 設定の音量（0〜1） */
  private readonly seVolume: GainNode;
  private readonly bgmVolume: GainNode;
  /** 大ダメージ・きぜつの時に BGM を一瞬下げる */
  private readonly bgmDuck: GainNode;
  private ducks = 0;
  /** 残響へ送る入口（短い／長い） */
  readonly reverbShort: GainNode;
  readonly reverbLong: GainNode;
  private readonly comp: DynamicsCompressorNode;
  private noiseCache = new Map<string, AudioBuffer>();

  /** ctx を渡すと、その中で鳴らす（試聴ページの自動チェックで OfflineAudioContext に書き出す時） */
  constructor(given?: BaseAudioContext) {
    const ctx = given ?? new (window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    this.ctx = ctx;

    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = MIX.limiter.threshold;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.001;
    limiter.release.value = 0.1;
    this.master = ctx.createGain();
    this.master.gain.value = MIX.master;
    this.master.connect(limiter).connect(ctx.destination);

    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = MIX.compressor.threshold;
    this.comp.knee.value = MIX.compressor.knee;
    this.comp.ratio.value = MIX.compressor.ratio;
    this.comp.attack.value = MIX.compressor.attack;
    this.comp.release.value = MIX.compressor.release;
    this.se = ctx.createGain();
    this.seVolume = ctx.createGain();
    this.se.connect(this.comp).connect(this.seVolume).connect(this.master);

    this.bgm = ctx.createGain();
    this.bgmDuck = ctx.createGain();
    this.bgmVolume = ctx.createGain();
    this.bgm.connect(this.bgmDuck).connect(this.bgmVolume).connect(this.master);

    const short = makeReverb(ctx, MIX.reverbShort);
    const long = makeReverb(ctx, MIX.reverbLong);
    this.reverbShort = ctx.createGain();
    this.reverbLong = ctx.createGain();
    this.reverbShort.connect(short).connect(this.se);
    this.reverbLong.connect(long).connect(this.se);
  }

  /** BGM の音量（0〜1）。0 なら完全に無音 */
  setBgmVolume(v: number): void {
    setLevel(this.bgmVolume.gain, v, this.ctx);
  }

  /** BGM を一瞬下げる（SPEC §10-3：0.4秒だけ 40% 下げる） */
  duckBgm(): void {
    const t = this.ctx.currentTime;
    const g = this.bgmDuck.gain;
    this.ducks += 1;
    g.cancelScheduledValues(t);
    g.setTargetAtTime(MIX.duck.level, t, 0.015);
    window.setTimeout(() => {
      this.ducks -= 1;
      if (this.ducks === 0) g.setTargetAtTime(1, this.ctx.currentTime, 0.08);
    }, MIX.duck.seconds * 1000);
  }

  /** 効果音の音量（0〜1）。0 なら完全に無音 */
  setSeVolume(v: number): void {
    setLevel(this.seVolume.gain, v, this.ctx);
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

/** 音量を なめらかに変える。0 の時は最後に ぴったり 0 にする（なめらかな変化だけだと 0 に近づくだけのため） */
function setLevel(p: AudioParam, v: number, ctx: BaseAudioContext): void {
  const t = ctx.currentTime;
  p.cancelScheduledValues(t);
  p.setValueAtTime(p.value, t);
  p.linearRampToValueAtTime(Math.max(0, v), t + 0.03);
}
