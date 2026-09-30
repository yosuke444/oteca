// BGM の音の大きさ（ラウドネス。LUFS の近似）を測り、soundMap.ts の音量でそろえる時の目安を出す。
// 効果音（設定の初期値で鳴らした時の、いちばん大きい 0.4 秒）とも比べて、効果音が BGM に埋もれないかを確かめる。
// 使い方：npm run dev を動かしたまま node scripts/measure-bgm.mjs
import { BASE, launch } from './pw.mjs';

const browser = await launch();
try {
  const page = await browser.newPage();
  page.setDefaultTimeout(600000);
  await page.goto(BASE + '?debug=1');
  const result = await page.evaluate(async () => {
    const { BGM, BATTLE_VOLUME, BGM_LEVEL, battleTracks } = await import('/src/audio/soundMap.ts');
    const { Mixer } = await import('/src/audio/sfx/mixer.ts');
    const { RECIPES } = await import('/src/audio/sfx/recipes.ts');
    const { playRecipe, recipeLength } = await import('/src/audio/sfx/synth.ts');
    const { SE_KEYS } = await import('/src/audio/soundMap.ts');
    const rate = 44100;

    /** ITU-R BS.1770 の K 特性をかけて、400ms ごとの平均の大きさ（二乗）を出す */
    async function blocks(buf) {
      const off = new OfflineAudioContext(buf.numberOfChannels, buf.length, buf.sampleRate);
      const src = off.createBufferSource();
      src.buffer = buf;
      const shelf = off.createBiquadFilter();
      shelf.type = 'highshelf';
      shelf.frequency.value = 1681;
      shelf.gain.value = 4;
      const hp = off.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 38;
      hp.Q.value = 0.5;
      src.connect(shelf).connect(hp).connect(off.destination);
      src.start();
      const out = await off.startRendering();
      const win = Math.round(out.sampleRate * 0.4);
      const step = Math.round(out.sampleRate * 0.1);
      const chans = [...Array(out.numberOfChannels)].map((_, c) => out.getChannelData(c));
      const res = [];
      for (let s = 0; s + win <= out.length; s += step) {
        let z = 0;
        for (const d of chans) {
          let sum = 0;
          for (let i = s; i < s + win; i++) sum += d[i] * d[i];
          z += sum / win;
        }
        res.push(z);
      }
      return res;
    }
    const L = (z) => -0.691 + 10 * Math.log10(z);
    /** 曲全体の大きさ（無音に近い所を除いて平均。LUFS の近似） */
    function integrated(zs) {
      const abs = zs.filter((z) => L(z) > -70);
      const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
      const rel = L(mean(abs)) - 10;
      return L(mean(abs.filter((z) => L(z) > rel)));
    }
    async function decode(url) {
      const res = await fetch(url);
      const ctx = new OfflineAudioContext(2, 1, rate);
      return ctx.decodeAudioData(await res.arrayBuffer());
    }

    const base = '/audio/bgm/';
    const songs = [
      ...Object.keys(BGM).map((k) => ({ key: k, url: `${base}${k}.mp3`, vol: BGM[k].volume ?? 1 })),
      ...battleTracks.map((t) => ({ key: t.id, url: `${base}battle/${t.files[0]}`, vol: BATTLE_VOLUME[t.id] ?? 1 })),
    ];
    const bgm = [];
    for (const s of songs) {
      const buf = await decode(s.url);
      const lufs = integrated(await blocks(buf));
      bgm.push({ key: s.key, seconds: +buf.duration.toFixed(1), lufs: +lufs.toFixed(1), volume: s.vol, withVolume: +(lufs + 20 * Math.log10(s.vol)).toFixed(1) });
    }

    // 効果音：設定の初期値（7）で、ミキサーを通して鳴らした時のいちばん大きい 0.4 秒
    const se = [];
    for (const key of SE_KEYS) {
      const recipe = RECIPES[key];
      const ctx = new OfflineAudioContext(2, Math.ceil(rate * (recipeLength(recipe) + 1.5)), rate);
      const mx = new Mixer(ctx);
      mx.setSeVolume(0.7);
      playRecipe(mx, recipe, 0.05);
      const buf = await ctx.startRendering();
      se.push({ key, max: +L(Math.max(...(await blocks(buf)))).toFixed(1) });
    }
    return { bgm, se, level: BGM_LEVEL };
  });

  // BGM は BGM_LEVEL と、設定の初期値（7）→ BGM バス 0.7、マスター 0.9
  const busDb = 20 * Math.log10(result.level * 0.7 * 0.9);
  console.log('■ BGM（曲の大きさ LUFS、音量設定をかけた後、設定の初期値で鳴らした時）');
  for (const b of result.bgm) console.log(`${b.key.padEnd(12)} ${String(b.seconds).padStart(6)}秒  ${b.lufs}  → volume ${b.volume}  ${b.withVolume}  → 実際 ${(b.withVolume + busDb).toFixed(1)}`);
  const vals = result.bgm.map((b) => b.withVolume);
  console.log(`音量をかけた後の差：${(Math.max(...vals) - Math.min(...vals)).toFixed(1)} dB`);
  console.log('■ 効果音（いちばん大きい 0.4 秒、設定の初期値）');
  for (const s of result.se) console.log(`${s.key.padEnd(16)} ${s.max}`);
} finally {
  await browser.close();
}
