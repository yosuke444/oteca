import { SE_KEYS } from './soundMap';
import { Mixer } from './sfx/mixer';
import { RECIPES } from './sfx/recipes';
import { playRecipe, recipeLength } from './sfx/synth';

export type SoundCheck = {
  key: string;
  /** 音が聞こえる長さ（秒。大きさ 1% 以上の最後の場所） */
  seconds: number;
  /** いちばん大きいところ（0〜1） */
  peak: number;
  /** 全体の平均の大きさ */
  rms: number;
};

/**
 * 全部の効果音を、スピーカーではなく OfflineAudioContext に書き出して大きさと長さを測る（試聴ページの自動チェック用）。
 * 耳で聞く代わりに「鳴っているか」「長さが目安どおりか」「音割れしていないか」を確かめる。
 */
export async function checkAllSounds(): Promise<SoundCheck[]> {
  const out: SoundCheck[] = [];
  const rate = 44100;
  for (const key of SE_KEYS) {
    const recipe = RECIPES[key];
    const len = recipeLength(recipe) + 2;
    const ctx = new OfflineAudioContext(2, Math.ceil(rate * len), rate);
    const mx = new Mixer(ctx);
    playRecipe(mx, recipe, 0.01);
    const buf = await ctx.startRendering();
    let peak = 0;
    let sum = 0;
    let lastLoud = 0;
    for (let ch = 0; ch < buf.numberOfChannels; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < d.length; i++) {
        const a = Math.abs(d[i]);
        if (a > peak) peak = a;
        sum += d[i] * d[i];
        if (a > 0.01 && i > lastLoud) lastLoud = i;
      }
    }
    out.push({ key, seconds: +(lastLoud / rate).toFixed(2), peak: +peak.toFixed(3), rms: +Math.sqrt(sum / (buf.length * buf.numberOfChannels)).toFixed(4) });
  }
  return out;
}
