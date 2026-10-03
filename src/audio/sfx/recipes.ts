import type { Layer, Recipe } from './synth';

/** まぜ方（音の通り道）の数値。これもここで調整する */
export const MIX = {
  /** 効果音のコンプレッサー（重ねても音割れしないように。設定の音量は この後でかける） */
  compressor: { threshold: -16, knee: 12, ratio: 6, attack: 0.003, release: 0.18 },
  /** 全体の大きさ */
  master: 0.9,
  /** 最後の音割れ止め（この大きさ dB を超えた所だけ抑える） */
  limiter: { threshold: -1 },
  /** 残響：短い（はんこ・ダメージ）と長い（大ダメージ・ジングル） */
  reverbShort: { seconds: 0.9, decay: 3.2, preDelay: 0.008, damp: 0.5 },
  reverbLong: { seconds: 2.6, decay: 2.4, preDelay: 0.02, damp: 0.35 },
  /** 大ダメージ・きぜつの瞬間に BGM を下げる：秒数と、下げた時の大きさ（0.6 ＝ 40% 下げる。SPEC §10-3） */
  duck: { seconds: 0.4, level: 0.6 },
};

/**
 * 効果音のレシピ（SPEC §10-3）。音の調整は、このファイルの数値だけを触ればよい。
 *
 * 読み方：
 * - src：音のもと（sine サイン波／triangle 三角波／square 矩形波／sawtooth ノコギリ波／white・pink・brown ノイズ）
 * - gain：大きさ　env：a 立ち上がり・d 減衰・s 持続の大きさ・r 余韻（秒）
 * - freq：高さ [はじめ, おわり]（Hz）　filter：音色のしぼり [はじめ, おわり]（Hz）
 * - delay：鳴り始めのずれ（秒）　pan：左右（-1〜1）　drive：ひずみ　reverb：残響の量
 * - grains：短い音をばらまく（count 個を spread 秒に）　notes：メロディ（t 秒後に f Hz を d 秒）
 * 「もっと低く」→ freq を小さく、「もっと長く」→ env の d・r を大きく、「もっと響く」→ reverb を大きく。
 */

// 音の高さ（Hz）
const N = {
  B2: 123.47, C3: 130.81, Eb3: 155.56, G3: 196.0, Ab3: 207.65, A3: 220.0, Bb3: 233.08, Eb4: 311.13,
  C4: 261.63, D4: 293.66, E4: 329.63, F4: 349.23, G4: 392.0, A4: 440.0, B4: 493.88,
  C5: 523.25, D5: 587.33, E5: 659.25, F5: 698.46, G5: 783.99, A5: 880.0, B5: 987.77,
  C6: 1046.5, D6: 1174.66, E6: 1318.51, G6: 1567.98, C7: 2093.0,
};

/** 合成ドラム：キック（低音の急降下） */
const kick = (t: number, g = 0.9): Layer => ({ src: 'sine', gain: g, freq: [150, 42], freqTime: 0.12, env: { a: 0.001, d: 0.22, s: 0, r: 0.04 }, delay: t });
/** 合成ドラム：スネア（ノイズのたたき） */
const snare = (t: number, g = 0.45): Layer => ({ src: 'white', gain: g, filter: { type: 'bandpass', freq: [2200, 1400], q: 0.9 }, env: { a: 0.001, d: 0.12, s: 0, r: 0.03 }, delay: t, reverb: 0.2 });
/** きらきら（高いサイン波の粒） */
const sparkle = (t: number, spread: number, count: number, g = 0.08): Layer => ({
  src: 'sine',
  gain: g,
  freq: [3600, 4200],
  partials: [1, 1.5],
  env: { a: 0.002, d: 0.08, s: 0, r: 0.06 },
  delay: t,
  grains: { count, spread, jitter: 0.8, pitchJitter: 0.35, gainJitter: 0.5 },
  reverb: 0.35,
  pan: [-0.4, 0.4],
});

export const RECIPES: Record<string, Recipe> = {
  // ボタンを押した：ペン先の「カチッ」
  se_click: {
    gain: 0.7,
    layers: [
      { src: 'white', gain: 0.55, filter: { type: 'highpass', freq: [3200, 2400] }, env: { a: 0.0005, d: 0.006, s: 0, r: 0.006 } },
      { src: 'sine', gain: 0.28, freq: [2600, 1700], env: { a: 0.001, d: 0.02, s: 0, r: 0.01 } },
      { src: 'triangle', gain: 0.18, freq: [900, 520], env: { a: 0.001, d: 0.03, s: 0, r: 0.01 } },
    ],
  },
  // ボタンにマウスを乗せた：紙をなでる小さな「スッ」
  se_hover: {
    gain: 0.35,
    layers: [{ src: 'white', gain: 0.22, filter: { type: 'highpass', freq: [5200, 3800] }, env: { a: 0.012, d: 0.03, s: 0, r: 0.01 }, pan: [-0.2, 0.2] }],
  },
  // 画面切り替え：ページをめくる「パラッ」
  se_page: {
    gain: 0.8,
    layers: [
      { src: 'pink', gain: 0.5, filter: { type: 'bandpass', freq: [700, 3400], q: 1.1, time: 0.14 }, env: { a: 0.02, d: 0.12, s: 0, r: 0.03 }, pan: [0.4, -0.2] },
      { src: 'white', gain: 0.35, filter: { type: 'bandpass', freq: [3400, 900], q: 1.1, time: 0.16 }, env: { a: 0.01, d: 0.16, s: 0, r: 0.04 }, delay: 0.12, pan: [-0.2, -0.5], reverb: 0.12 },
      { src: 'white', gain: 0.25, filter: { type: 'highpass', freq: [5000, 5000] }, env: { a: 0.001, d: 0.012, s: 0, r: 0.01 }, delay: 0.05, grains: { count: 3, spread: 0.2, jitter: 0.7, gainJitter: 0.4 } },
    ],
  },
  // ペンで書く：ボールペンの「シャシャッ」
  se_pen: {
    gain: 0.6,
    layers: [
      { src: 'white', gain: 0.4, filter: { type: 'bandpass', freq: [4200, 3200], q: 1.6 }, env: { a: 0.003, d: 0.035, s: 0, r: 0.012 }, grains: { count: 8, spread: 0.36, jitter: 0.8, pitchJitter: 0.25, gainJitter: 0.6 }, pan: [-0.3, 0.3] },
      { src: 'white', gain: 0.12, filter: { type: 'highpass', freq: [7000, 6000] }, env: { a: 0.01, d: 0.3, s: 0, r: 0.05 } },
    ],
  },
  // はんこ：「ドンッ」
  se_stamp: {
    gain: 0.95,
    layers: [
      { src: 'sine', gain: 0.95, freq: [190, 44], freqTime: 0.16, env: { a: 0.001, d: 0.26, s: 0, r: 0.05 }, drive: 0.15 },
      { src: 'brown', gain: 0.55, filter: { type: 'lowpass', freq: [1400, 250], time: 0.08 }, env: { a: 0.001, d: 0.07, s: 0, r: 0.03 } },
      { src: 'triangle', gain: 0.3, freq: [420, 130], env: { a: 0.001, d: 0.08, s: 0, r: 0.02 } },
      { src: 'white', gain: 0.25, filter: { type: 'bandpass', freq: [2200, 1600], q: 1.2 }, env: { a: 0.001, d: 0.03, s: 0, r: 0.02 }, reverb: 0.35 },
    ],
  },
  // サイコロが転がる：木の「コロコロ」（間隔を広げながら）
  se_dice_roll: {
    gain: 0.75,
    layers: [
      { src: 'triangle', gain: 0.35, freq: [1400, 950], env: { a: 0.001, d: 0.028, s: 0, r: 0.01 }, grains: { count: 12, spread: 0.85, slowDown: 1.2, jitter: 0.35, pitchJitter: 0.18, gainJitter: 0.3, fade: 0.45 }, pan: [0.6, -0.1] },
      { src: 'white', gain: 0.25, filter: { type: 'bandpass', freq: [2600, 2200], q: 3 }, env: { a: 0.001, d: 0.02, s: 0, r: 0.01 }, grains: { count: 12, spread: 0.85, slowDown: 1.2, jitter: 0.35, gainJitter: 0.4, fade: 0.45 }, pan: [0.6, -0.1] },
      { src: 'sine', gain: 0.12, freq: [240, 200], env: { a: 0.001, d: 0.05, s: 0, r: 0.02 }, grains: { count: 6, spread: 0.8, slowDown: 1.3, jitter: 0.4 } },
    ],
  },
  // サイコロが止まる：「コトッ、コッ」（2回目を小さく）
  se_dice_land: {
    gain: 0.9,
    layers: [
      { src: 'triangle', gain: 0.5, freq: [980, 520], env: { a: 0.001, d: 0.05, s: 0, r: 0.02 } },
      { src: 'white', gain: 0.3, filter: { type: 'bandpass', freq: [1900, 1500], q: 2.5 }, env: { a: 0.001, d: 0.03, s: 0, r: 0.02 } },
      { src: 'sine', gain: 0.35, freq: [230, 120], env: { a: 0.001, d: 0.08, s: 0, r: 0.02 } },
      { src: 'triangle', gain: 0.22, freq: [1050, 600], env: { a: 0.001, d: 0.04, s: 0, r: 0.02 }, delay: 0.1 },
      { src: 'white', gain: 0.12, filter: { type: 'bandpass', freq: [2100, 1700], q: 2.5 }, env: { a: 0.001, d: 0.02, s: 0, r: 0.01 }, delay: 0.1, reverb: 0.2 },
    ],
  },
  // カードを引く：紙がすべる「シュッ」
  se_card_draw: {
    gain: 0.7,
    layers: [
      { src: 'pink', gain: 0.55, filter: { type: 'lowpass', freq: [7000, 900], time: 0.16 }, env: { a: 0.012, d: 0.15, s: 0, r: 0.04 }, pan: [0.5, -0.3] },
      { src: 'white', gain: 0.15, filter: { type: 'highpass', freq: [6000, 3000] }, env: { a: 0.02, d: 0.1, s: 0, r: 0.03 }, pan: [0.5, -0.3] },
    ],
  },
  // カードを置く：「パサッ」＋軽い低音
  se_card_place: {
    gain: 0.8,
    layers: [
      { src: 'white', gain: 0.45, filter: { type: 'bandpass', freq: [2600, 900], q: 0.9, time: 0.08 }, env: { a: 0.002, d: 0.08, s: 0, r: 0.03 } },
      { src: 'sine', gain: 0.4, freq: [150, 75], env: { a: 0.001, d: 0.11, s: 0, r: 0.03 } },
      { src: 'pink', gain: 0.15, filter: { type: 'lowpass', freq: [800, 300] }, env: { a: 0.001, d: 0.05, s: 0, r: 0.02 }, reverb: 0.15 },
    ],
  },
  // テープを貼る：「ペタッ」＋「ピッ」
  se_tape: {
    gain: 0.75,
    layers: [
      { src: 'pink', gain: 0.5, filter: { type: 'lowpass', freq: [1800, 600], time: 0.05 }, env: { a: 0.001, d: 0.05, s: 0, r: 0.02 } },
      { src: 'sine', gain: 0.25, freq: [720, 480], env: { a: 0.001, d: 0.04, s: 0, r: 0.02 } },
      { src: 'triangle', gain: 0.22, freq: [1800, 2700], env: { a: 0.002, d: 0.05, s: 0, r: 0.02 }, delay: 0.08 },
      { src: 'white', gain: 0.12, filter: { type: 'highpass', freq: [6000, 6000] }, env: { a: 0.001, d: 0.02, s: 0, r: 0.01 }, delay: 0.08 },
    ],
  },
  // 交代：「シュッ」を左右に2回
  se_swap: {
    gain: 0.75,
    layers: [
      { src: 'pink', gain: 0.5, filter: { type: 'bandpass', freq: [1500, 4200], q: 1, time: 0.14 }, env: { a: 0.02, d: 0.12, s: 0, r: 0.03 }, pan: [-0.9, -0.3] },
      { src: 'pink', gain: 0.5, filter: { type: 'bandpass', freq: [4200, 1500], q: 1, time: 0.14 }, env: { a: 0.02, d: 0.12, s: 0, r: 0.03 }, delay: 0.17, pan: [0.3, 0.9] },
      { src: 'sine', gain: 0.15, freq: [300, 500], env: { a: 0.01, d: 0.28, s: 0, r: 0.05 }, reverb: 0.2 },
    ],
  },
  // 50以下のダメージ：「ドカッ」
  se_hit_small: {
    gain: 1,
    layers: [
      { src: 'sine', gain: 1, freq: [170, 46], freqTime: 0.12, env: { a: 0.001, d: 0.2, s: 0, r: 0.04 }, drive: 0.25 },
      { src: 'white', gain: 0.6, filter: { type: 'lowpass', freq: [3600, 500], time: 0.08 }, env: { a: 0.001, d: 0.08, s: 0, r: 0.03 } },
      { src: 'pink', gain: 0.45, filter: { type: 'bandpass', freq: [950, 700], q: 1.3 }, env: { a: 0.001, d: 0.06, s: 0, r: 0.03 }, reverb: 0.18 },
      { src: 'square', gain: 0.08, freq: [90, 50], env: { a: 0.001, d: 0.1, s: 0, r: 0.02 }, filter: { type: 'lowpass', freq: [600, 200] } },
    ],
  },
  // 60以上のダメージ：「ズドーン」
  se_hit_big: {
    gain: 1,
    layers: [
      { src: 'sine', gain: 1, freq: [130, 28], freqTime: 0.55, env: { a: 0.001, d: 0.7, s: 0, r: 0.1 }, drive: 0.55 },
      { src: 'square', gain: 0.18, freq: [70, 30], freqTime: 0.5, env: { a: 0.001, d: 0.5, s: 0, r: 0.1 }, filter: { type: 'lowpass', freq: [500, 120] } },
      { src: 'brown', gain: 0.8, filter: { type: 'lowpass', freq: [5000, 180], time: 0.6 }, env: { a: 0.001, d: 0.55, s: 0, r: 0.15 }, drive: 0.3, reverb: 0.45, reverbLong: true },
      { src: 'white', gain: 0.45, filter: { type: 'bandpass', freq: [1600, 600], q: 0.8, time: 0.3 }, env: { a: 0.001, d: 0.25, s: 0, r: 0.08 }, pan: [-0.3, 0.3] },
      sparkle(0.06, 0.5, 12, 0.07),
      { src: 'sawtooth', gain: 0.1, freq: [880, 220], freqTime: 0.4, env: { a: 0.005, d: 0.4, s: 0, r: 0.1 }, filter: { type: 'lowpass', freq: [3000, 500] }, reverb: 0.4, reverbLong: true },
    ],
  },
  // 回復：上がっていく5音のアルペジオ＋きらきら
  se_heal: {
    gain: 0.75,
    layers: [
      {
        src: 'triangle',
        gain: 0.4,
        env: { a: 0.005, d: 0.08, s: 0.5, r: 0.18 },
        notes: [
          { t: 0, f: N.C5, d: 0.14 },
          { t: 0.07, f: N.E5, d: 0.14 },
          { t: 0.14, f: N.G5, d: 0.14 },
          { t: 0.21, f: N.C6, d: 0.14 },
          { t: 0.28, f: N.E6, d: 0.3, g: 1.1 },
        ],
        reverb: 0.35,
      },
      { src: 'sine', gain: 0.12, partials: [1, 2], env: { a: 0.005, d: 0.08, s: 0.4, r: 0.2 }, notes: [{ t: 0.28, f: N.C6, d: 0.3 }], reverb: 0.3 },
      sparkle(0.1, 0.6, 14, 0.07),
    ],
  },
  // きぜつ：紙をくしゃくしゃに丸める → 最後に「ポスッ」
  se_ko: {
    gain: 0.9,
    layers: [
      { src: 'white', gain: 0.35, filter: { type: 'bandpass', freq: [900, 900], q: 1.8 }, env: { a: 0.001, d: 0.018, s: 0, r: 0.008 }, grains: { count: 16, spread: 0.58, jitter: 0.9, pitchJitter: 0.4, gainJitter: 0.6 } },
      { src: 'white', gain: 0.35, filter: { type: 'bandpass', freq: [2300, 2300], q: 1.8 }, env: { a: 0.001, d: 0.015, s: 0, r: 0.006 }, grains: { count: 20, spread: 0.6, jitter: 0.9, pitchJitter: 0.4, gainJitter: 0.6 } },
      { src: 'white', gain: 0.28, filter: { type: 'bandpass', freq: [5200, 5200], q: 1.5 }, env: { a: 0.001, d: 0.01, s: 0, r: 0.005 }, grains: { count: 18, spread: 0.6, jitter: 0.9, pitchJitter: 0.3, gainJitter: 0.6 } },
      { src: 'pink', gain: 0.5, filter: { type: 'lowpass', freq: [900, 300] }, env: { a: 0.002, d: 0.08, s: 0, r: 0.03 }, delay: 0.66 },
      { src: 'sine', gain: 0.45, freq: [160, 85], env: { a: 0.001, d: 0.12, s: 0, r: 0.03 }, delay: 0.66, reverb: 0.25 },
    ],
  },
  // くすり：泡の「ポコポコ」＋回復音を短くしたもの
  se_item_kusuri: {
    gain: 0.75,
    layers: [
      { src: 'sine', gain: 0.35, freq: [380, 950], freqTime: 0.05, env: { a: 0.002, d: 0.05, s: 0, r: 0.02 }, grains: { count: 7, spread: 0.36, jitter: 0.6, pitchJitter: 0.35, gainJitter: 0.4 } },
      { src: 'triangle', gain: 0.32, env: { a: 0.005, d: 0.07, s: 0.5, r: 0.15 }, delay: 0.3, notes: [{ t: 0, f: N.G5, d: 0.1 }, { t: 0.07, f: N.C6, d: 0.1 }, { t: 0.14, f: N.E6, d: 0.24 }], reverb: 0.3 },
      sparkle(0.35, 0.35, 8, 0.06),
    ],
  },
  // ひみつのやいば：刃の「シャキーン」
  se_item_yaiba: {
    gain: 0.8,
    layers: [
      { src: 'white', gain: 0.45, filter: { type: 'highpass', freq: [2500, 6000], time: 0.1 }, env: { a: 0.004, d: 0.09, s: 0, r: 0.03 }, pan: [-0.6, 0.6] },
      { src: 'sine', gain: 0.4, freq: [2350, 2330], partials: [1, 1.41, 2.13, 2.76, 3.54], env: { a: 0.002, d: 1.2, s: 0, r: 0.3 }, delay: 0.06, reverb: 0.45, reverbLong: true },
      { src: 'triangle', gain: 0.12, freq: [4700, 4650], env: { a: 0.002, d: 0.6, s: 0, r: 0.2 }, delay: 0.06, pan: 0.3 },
      sparkle(0.08, 0.4, 8, 0.05),
    ],
  },
  // きみょうなドリンク：「ゴポゴポ」と低い泡＋不気味に下がる音
  se_item_drink: {
    gain: 0.8,
    layers: [
      { src: 'sine', gain: 0.45, freq: [160, 360], freqTime: 0.06, env: { a: 0.003, d: 0.07, s: 0, r: 0.03 }, grains: { count: 8, spread: 0.55, jitter: 0.7, pitchJitter: 0.3, gainJitter: 0.4 } },
      { src: 'sawtooth', gain: 0.18, freq: [520, 170], freqTime: 1.0, partials: [1, 1.012], env: { a: 0.1, d: 0.9, s: 0.2, r: 0.3 }, filter: { type: 'lowpass', freq: [1400, 500] }, delay: 0.2, reverb: 0.35, reverbLong: true },
      { src: 'brown', gain: 0.2, filter: { type: 'lowpass', freq: [500, 200] }, env: { a: 0.05, d: 0.6, s: 0, r: 0.1 } },
    ],
  },
  // スポドリ：炭酸を開ける「プシュッ」＋水しぶき
  se_item_spodori: {
    gain: 0.8,
    layers: [
      { src: 'white', gain: 0.55, filter: { type: 'highpass', freq: [1800, 6500], time: 0.2 }, env: { a: 0.004, d: 0.25, s: 0, r: 0.05 } },
      { src: 'white', gain: 0.35, filter: { type: 'bandpass', freq: [1700, 600], q: 1, time: 0.15 }, env: { a: 0.002, d: 0.05, s: 0, r: 0.02 }, delay: 0.18, grains: { count: 9, spread: 0.28, jitter: 0.8, pitchJitter: 0.3, gainJitter: 0.5 }, pan: [-0.5, 0.5] },
      { src: 'sine', gain: 0.2, freq: [600, 1400], freqTime: 0.04, env: { a: 0.002, d: 0.04, s: 0, r: 0.02 }, delay: 0.2, grains: { count: 5, spread: 0.3, jitter: 0.6, pitchJitter: 0.4 } },
      sparkle(0.3, 0.3, 6, 0.05),
    ],
  },
  // ターン開始：上がる2音のチャイム
  se_turn_start: {
    gain: 0.7,
    layers: [
      { src: 'sine', gain: 0.4, partials: [1, 2, 3], env: { a: 0.003, d: 0.2, s: 0.25, r: 0.45 }, notes: [{ t: 0, f: N.G5, d: 0.2 }, { t: 0.15, f: N.C6, d: 0.35 }], reverb: 0.35 },
      { src: 'triangle', gain: 0.12, env: { a: 0.003, d: 0.2, s: 0.2, r: 0.3 }, notes: [{ t: 0, f: N.G4, d: 0.2 }, { t: 0.15, f: N.C5, d: 0.35 }] },
    ],
  },
  // 出来ない操作：低めの「ブブッ」（小さめ）
  se_error: {
    gain: 0.5,
    layers: [
      { src: 'square', gain: 0.3, filter: { type: 'lowpass', freq: [900, 900] }, env: { a: 0.003, d: 0.03, s: 0.7, r: 0.02 }, notes: [{ t: 0, f: 150, d: 0.07 }, { t: 0.1, f: 140, d: 0.08 }] },
      { src: 'sawtooth', gain: 0.1, filter: { type: 'lowpass', freq: [500, 500] }, env: { a: 0.003, d: 0.03, s: 0.6, r: 0.02 }, notes: [{ t: 0, f: 75, d: 0.07 }, { t: 0.1, f: 70, d: 0.08 }] },
    ],
  },
  // 相手が見つかった：明るい上昇3音＋きらきら
  se_match_found: {
    gain: 0.75,
    layers: [
      { src: 'triangle', gain: 0.4, env: { a: 0.004, d: 0.1, s: 0.5, r: 0.25 }, notes: [{ t: 0, f: N.E5, d: 0.12 }, { t: 0.1, f: N.G5, d: 0.12 }, { t: 0.2, f: N.C6, d: 0.4, g: 1.1 }], reverb: 0.3 },
      { src: 'square', gain: 0.06, filter: { type: 'lowpass', freq: [2500, 2500] }, env: { a: 0.004, d: 0.1, s: 0.4, r: 0.2 }, notes: [{ t: 0, f: N.E5 * 2, d: 0.1 }, { t: 0.1, f: N.G5 * 2, d: 0.1 }, { t: 0.2, f: N.C6 * 2, d: 0.35 }] },
      sparkle(0.22, 0.5, 12, 0.07),
    ],
  },
  // スタンプ：「ポンッ」
  se_stamp_chat: {
    gain: 0.7,
    layers: [
      { src: 'sine', gain: 0.55, freq: [420, 950], freqTime: 0.04, env: { a: 0.002, d: 0.08, s: 0, r: 0.04 } },
      { src: 'triangle', gain: 0.15, freq: [840, 1900], freqTime: 0.04, env: { a: 0.002, d: 0.05, s: 0, r: 0.03 }, reverb: 0.2 },
      { src: 'white', gain: 0.15, filter: { type: 'highpass', freq: [4000, 4000] }, env: { a: 0.001, d: 0.01, s: 0, r: 0.01 } },
    ],
  },
  // コインが1枚入る（v2.0-D）：高い金属の「チャリン」（2つの金属音を少しずらして重ねる）
  se_coin: {
    gain: 0.6,
    layers: [
      { src: 'sine', gain: 0.32, freq: [2637, 2600], partials: [1, 2.41, 3.98], env: { a: 0.001, d: 0.05, s: 0.25, r: 0.32 }, reverb: 0.25 },
      { src: 'sine', gain: 0.26, freq: [3520, 3480], partials: [1, 2.2], env: { a: 0.001, d: 0.04, s: 0.2, r: 0.28 }, delay: 0.055, reverb: 0.3 },
      { src: 'white', gain: 0.18, filter: { type: 'highpass', freq: [7000, 7000] }, env: { a: 0.0005, d: 0.01, s: 0, r: 0.01 } },
    ],
  },
  // コインがたくさん噴き出す（v2.0-D）：チャリンの粒をたくさん＋低い「ドン」＋きらきら
  se_coin_burst: {
    gain: 0.7,
    layers: [
      kick(0, 0.5),
      { src: 'sine', gain: 0.16, freq: [2800, 2600], partials: [1, 2.4, 4], env: { a: 0.001, d: 0.04, s: 0.2, r: 0.18 }, grains: { count: 22, spread: 0.9, jitter: 0.9, pitchJitter: 0.25, gainJitter: 0.5, fade: 0.4 }, reverb: 0.3, pan: [-0.5, 0.5] },
      { src: 'white', gain: 0.2, filter: { type: 'bandpass', freq: [5000, 2500], q: 0.8, time: 0.3 }, env: { a: 0.005, d: 0.25, s: 0, r: 0.08 } },
      sparkle(0.25, 0.8, 18, 0.08),
    ],
  },
  // プレゼントボックスが開く（v2.0-D）：リボンの「シュルッ」→ ふたの「ポンッ」→ 上がる3音
  se_present: {
    gain: 0.75,
    layers: [
      { src: 'pink', gain: 0.35, filter: { type: 'bandpass', freq: [900, 4200], q: 1.2, time: 0.3 }, env: { a: 0.04, d: 0.25, s: 0, r: 0.05 }, pan: [-0.5, 0.5] },
      { src: 'sine', gain: 0.55, freq: [300, 900], freqTime: 0.05, env: { a: 0.002, d: 0.1, s: 0, r: 0.05 }, delay: 0.34 },
      { src: 'white', gain: 0.2, filter: { type: 'highpass', freq: [3500, 3500] }, env: { a: 0.001, d: 0.015, s: 0, r: 0.01 }, delay: 0.34 },
      { src: 'triangle', gain: 0.32, env: { a: 0.004, d: 0.08, s: 0.5, r: 0.25 }, notes: [{ t: 0.42, f: N.C5, d: 0.1 }, { t: 0.52, f: N.E5, d: 0.1 }, { t: 0.62, f: N.G5, d: 0.1 }, { t: 0.72, f: N.C6, d: 0.45, g: 1.1 }], reverb: 0.3 },
      sparkle(0.72, 0.6, 16, 0.08),
    ],
  },
  // 袋を破る（v2.0-E）：紙を裂く「ビリッ」（ノイズの粒を速く並べ、高さを下げていく）
  se_bag_tear: {
    gain: 0.8,
    layers: [
      { src: 'white', gain: 0.5, filter: { type: 'bandpass', freq: [4200, 1600], q: 1.4, time: 0.22 }, env: { a: 0.002, d: 0.018, s: 0, r: 0.01 }, grains: { count: 14, spread: 0.22, jitter: 0.6, gainJitter: 0.5 }, pan: [-0.5, 0.5] },
      { src: 'pink', gain: 0.3, filter: { type: 'bandpass', freq: [1800, 700], q: 0.9, time: 0.25 }, env: { a: 0.005, d: 0.2, s: 0, r: 0.05 } },
      { src: 'white', gain: 0.25, filter: { type: 'highpass', freq: [6000, 6000] }, env: { a: 0.001, d: 0.01, s: 0, r: 0.01 }, delay: 0.24 },
    ],
  },
  // カードがめくれる（v2.0-E）：軽い「ぺらっ」
  se_card_flip: {
    gain: 0.7,
    layers: [
      { src: 'pink', gain: 0.42, filter: { type: 'bandpass', freq: [1200, 3600], q: 1.2, time: 0.08 }, env: { a: 0.006, d: 0.07, s: 0, r: 0.03 } },
      { src: 'sine', gain: 0.18, freq: [700, 1300], freqTime: 0.06, env: { a: 0.002, d: 0.06, s: 0, r: 0.03 }, delay: 0.03 },
    ],
  },
  // スーパーレアの袋が光る・震える（v2.0-E）：高い「キラキラ」のうなり
  se_super_shine: {
    gain: 0.6,
    layers: [
      { src: 'sine', gain: 0.14, freq: [1568, 2093], partials: [1, 1.5, 2.01], env: { a: 0.25, d: 0.4, s: 0.4, r: 0.4 }, reverb: 0.4, reverbLong: true },
      sparkle(0, 1.1, 26, 0.07),
      { src: 'triangle', gain: 0.08, freq: [90, 110], env: { a: 0.1, d: 0.6, s: 0.3, r: 0.3 }, drive: 0.3 },
    ],
  },
  // キラキラが飛ぶ（v2.1-K。約1秒）：高い鈴の粒が上から下へ流れる「しゃらしゃら」＋ ひらひらした高いノイズ
  se_sparkle: {
    gain: 0.55,
    layers: [
      { src: 'sine', gain: 0.12, freq: [5200, 2600], freqTime: 0.9, partials: [1, 2.76], env: { a: 0.002, d: 0.06, s: 0, r: 0.08 }, grains: { count: 30, spread: 0.85, jitter: 0.6, pitchJitter: 0.2, gainJitter: 0.5, fade: 0.6 }, reverb: 0.45, pan: [-0.6, 0.6] },
      sparkle(0.02, 0.7, 20, 0.07),
      { src: 'white', gain: 0.07, filter: { type: 'highpass', freq: [9000, 6000], time: 0.8 }, env: { a: 0.05, d: 0.6, s: 0, r: 0.2 }, pan: [0.5, -0.5] },
    ],
  },
  // スーパーレア（v2.0-E。約2.5秒）：上がるアルペジオ → 和音のファンファーレ＋ドラム＋きらきら
  jingle_super: {
    gain: 0.85,
    layers: [
      { src: 'triangle', gain: 0.3, env: { a: 0.003, d: 0.06, s: 0.5, r: 0.1 }, notes: [N.C5, N.E5, N.G5, N.C6, N.E6, N.G6].map((f, i) => ({ t: i * 0.07, f, d: 0.09 })), reverb: 0.25 },
      {
        src: 'square',
        gain: 0.14,
        filter: { type: 'lowpass', freq: [3600, 3600] },
        env: { a: 0.005, d: 0.08, s: 0.65, r: 0.2 },
        notes: [
          { t: 0.5, f: N.G5, d: 0.16 },
          { t: 0.68, f: N.G5, d: 0.1 },
          { t: 0.8, f: N.C6, d: 0.6 },
          { t: 1.45, f: N.D6, d: 0.14 },
          { t: 1.6, f: N.E6, d: 0.85, g: 1.15 },
        ],
        reverb: 0.3,
      },
      {
        src: 'sawtooth',
        gain: 0.08,
        filter: { type: 'lowpass', freq: [2200, 2200] },
        env: { a: 0.02, d: 0.2, s: 0.65, r: 0.35 },
        notes: [
          ...[N.C4, N.E4, N.G4, N.C5].map((f) => ({ t: 0.8, f, d: 0.6 })),
          ...[N.D4, N.G4, N.B4, N.D5].map((f) => ({ t: 1.45, f, d: 0.14 })),
          ...[N.C4, N.E4, N.G4, N.C5, N.E5].map((f) => ({ t: 1.6, f, d: 0.85 })),
        ],
        reverb: 0.35,
        reverbLong: true,
      },
      { src: 'sine', gain: 0.4, env: { a: 0.01, d: 0.2, s: 0.5, r: 0.3 }, notes: [{ t: 0.8, f: N.C3, d: 0.6 }, { t: 1.45, f: N.G3, d: 0.14 }, { t: 1.6, f: N.C3, d: 0.85 }] },
      kick(0.5),
      kick(0.8, 1),
      kick(1.45),
      kick(1.6, 1),
      snare(0.68),
      snare(1.6, 0.5),
      { src: 'white', gain: 0.3, filter: { type: 'highpass', freq: [7000, 3000], time: 1 }, env: { a: 0.002, d: 1, s: 0, r: 0.1 }, delay: 1.6, reverb: 0.4, reverbLong: true },
      sparkle(0.8, 1.6, 40, 0.09),
    ],
  },
  // そう！（v2.0-T。チュートリアルで正しく操作した）：赤ペンで花丸を描く「シュッ」＋上がる2音「ピンポン」＋きらきら
  se_sou: {
    gain: 0.7,
    layers: [
      { src: 'pink', gain: 0.22, filter: { type: 'bandpass', freq: [1800, 4200], q: 1.4, time: 0.18 }, env: { a: 0.01, d: 0.16, s: 0, r: 0.04 }, pan: [-0.4, 0.4] },
      { src: 'triangle', gain: 0.38, partials: [1, 2], env: { a: 0.003, d: 0.06, s: 0.5, r: 0.22 }, notes: [{ t: 0.12, f: N.G5, d: 0.1 }, { t: 0.24, f: N.C6, d: 0.3, g: 1.15 }], reverb: 0.3 },
      sparkle(0.24, 0.4, 10, 0.07),
    ],
  },
  // ダブル（v2.0-E。約1.8秒）：2回はねる「ドンドン」→ 花火の「ヒュー・パン」→ 明るい和音
  jingle_double: {
    gain: 0.85,
    layers: [
      kick(0, 0.9),
      kick(0.22, 0.9),
      { src: 'sine', gain: 0.22, freq: [600, 2400], freqTime: 0.45, env: { a: 0.02, d: 0.45, s: 0, r: 0.02 }, delay: 0.42 },
      { src: 'white', gain: 0.45, filter: { type: 'lowpass', freq: [5000, 600], time: 0.5 }, env: { a: 0.001, d: 0.5, s: 0, r: 0.1 }, delay: 0.9, reverb: 0.4, reverbLong: true },
      kick(0.9, 1),
      {
        src: 'triangle',
        gain: 0.32,
        env: { a: 0.004, d: 0.08, s: 0.55, r: 0.2 },
        notes: [
          { t: 0.9, f: N.E5, d: 0.12 },
          { t: 1.02, f: N.G5, d: 0.12 },
          { t: 1.14, f: N.C6, d: 0.12 },
          { t: 1.26, f: N.E6, d: 0.5, g: 1.1 },
        ],
        reverb: 0.3,
      },
      { src: 'sawtooth', gain: 0.07, filter: { type: 'lowpass', freq: [2400, 2400] }, env: { a: 0.02, d: 0.2, s: 0.6, r: 0.3 }, notes: [N.C4, N.E4, N.G4, N.C5].map((f) => ({ t: 1.26, f, d: 0.5 })), reverb: 0.3 },
      sparkle(0.95, 0.9, 30, 0.09),
    ],
  },
  // ボス戦の前のカットイン（v2.0-F。約2秒）：低い太鼓の連打 → 不気味な金管の和音 → シンバル
  jingle_boss: {
    gain: 0.9,
    layers: [
      kick(0, 1),
      kick(0.16, 0.8),
      kick(0.32, 0.9),
      kick(0.42, 0.7),
      kick(0.52, 1),
      { src: 'white', gain: 0.25, filter: { type: 'lowpass', freq: [900, 300], time: 0.5 }, env: { a: 0.3, d: 0.3, s: 0, r: 0.05 }, reverb: 0.3 },
      { src: 'sawtooth', gain: 0.12, filter: { type: 'lowpass', freq: [600, 2200], time: 0.6 }, env: { a: 0.06, d: 0.3, s: 0.7, r: 0.6 }, notes: [N.C3, N.Eb3, N.G3, N.B2].map((f) => ({ t: 0.62, f, d: 1.1 })), reverb: 0.45, reverbLong: true, drive: 0.3 },
      { src: 'square', gain: 0.07, filter: { type: 'lowpass', freq: [1400, 1400] }, env: { a: 0.04, d: 0.2, s: 0.6, r: 0.5 }, notes: [{ t: 0.62, f: N.C4, d: 0.5 }, { t: 1.1, f: N.Eb4, d: 0.7 }], reverb: 0.4 },
      { src: 'white', gain: 0.38, filter: { type: 'highpass', freq: [5200, 3000], time: 1.2 }, env: { a: 0.002, d: 1.2, s: 0, r: 0.2 }, delay: 0.62, reverb: 0.5, reverbLong: true },
      kick(0.62, 1.1),
    ],
  },
  // 限定カードを手に入れた（v2.0-F。約3秒）：きらきらの上昇 → ファンファーレ → 鐘
  jingle_limited: {
    gain: 0.85,
    layers: [
      { src: 'sine', gain: 0.18, freq: [500, 3200], freqTime: 0.9, env: { a: 0.3, d: 0.6, s: 0, r: 0.05 }, reverb: 0.4 },
      sparkle(0, 1.0, 40, 0.07),
      {
        src: 'square',
        gain: 0.14,
        filter: { type: 'lowpass', freq: [3400, 3400] },
        env: { a: 0.005, d: 0.08, s: 0.6, r: 0.15 },
        notes: [
          { t: 0.95, f: N.G4, d: 0.12 },
          { t: 1.08, f: N.C5, d: 0.12 },
          { t: 1.21, f: N.E5, d: 0.12 },
          { t: 1.34, f: N.G5, d: 0.3 },
          { t: 1.7, f: N.E5, d: 0.12 },
          { t: 1.83, f: N.G5, d: 0.12 },
          { t: 1.96, f: N.C6, d: 0.8, g: 1.15 },
        ],
        reverb: 0.3,
      },
      { src: 'sawtooth', gain: 0.07, filter: { type: 'lowpass', freq: [2600, 2600] }, env: { a: 0.02, d: 0.2, s: 0.6, r: 0.5 }, notes: [N.C4, N.E4, N.G4, N.C5].map((f) => ({ t: 1.96, f, d: 0.8 })), reverb: 0.35 },
      { src: 'sine', gain: 0.28, freq: [N.C6, N.C6], partials: [1, 2.76, 5.4], env: { a: 0.001, d: 0.3, s: 0.2, r: 1.2 }, delay: 1.96, reverb: 0.5, reverbLong: true },
      kick(1.96, 0.8),
      sparkle(1.96, 1.0, 36, 0.08),
    ],
  },
  // ストーリーの次のステージが開く（v2.0-F）：ペンで線を引く「シュー」→ ぽんっ → 明るい2音
  se_stage_open: {
    gain: 0.75,
    layers: [
      { src: 'pink', gain: 0.25, filter: { type: 'bandpass', freq: [1200, 4800], q: 1.2, time: 0.5 }, env: { a: 0.05, d: 0.5, s: 0, r: 0.05 }, pan: [-0.3, 0.3] },
      { src: 'sine', gain: 0.5, freq: [320, 880], freqTime: 0.05, env: { a: 0.002, d: 0.1, s: 0, r: 0.05 }, delay: 0.55 },
      { src: 'triangle', gain: 0.3, env: { a: 0.004, d: 0.08, s: 0.5, r: 0.25 }, notes: [{ t: 0.62, f: N.E5, d: 0.1 }, { t: 0.74, f: N.A5, d: 0.35, g: 1.1 }], reverb: 0.3 },
      sparkle(0.6, 0.4, 10, 0.07),
    ],
  },
  // トレードの交換が成立した（v2.0-H。約2秒）：2枚が入れ替わる「シュッシュッ」→ 明るい和音 → きらきら
  jingle_trade: {
    gain: 0.8,
    layers: [
      { src: 'pink', gain: 0.3, filter: { type: 'bandpass', freq: [800, 4000], q: 1.2, time: 0.25 }, env: { a: 0.02, d: 0.25, s: 0, r: 0.04 }, pan: [-0.7, 0.7] },
      { src: 'pink', gain: 0.3, filter: { type: 'bandpass', freq: [4000, 800], q: 1.2, time: 0.25 }, env: { a: 0.02, d: 0.25, s: 0, r: 0.04 }, delay: 0.28, pan: [0.7, -0.7] },
      { src: 'triangle', gain: 0.32, env: { a: 0.004, d: 0.08, s: 0.55, r: 0.25 }, notes: [{ t: 0.6, f: N.C5, d: 0.12 }, { t: 0.72, f: N.E5, d: 0.12 }, { t: 0.84, f: N.G5, d: 0.12 }, { t: 0.96, f: N.C6, d: 0.6, g: 1.1 }], reverb: 0.3 },
      { src: 'sawtooth', gain: 0.06, filter: { type: 'lowpass', freq: [2400, 2400] }, env: { a: 0.02, d: 0.2, s: 0.6, r: 0.4 }, notes: [N.C4, N.E4, N.G4].map((f) => ({ t: 0.96, f, d: 0.6 })), reverb: 0.3 },
      kick(0.96, 0.7),
      sparkle(0.96, 0.8, 24, 0.08),
    ],
  },
  // 勝利（約3秒）：メロディ＋和音＋合成ドラム＋最後にきらきら
  jingle_win: {
    gain: 0.8,
    layers: [
      {
        src: 'square',
        gain: 0.16,
        filter: { type: 'lowpass', freq: [3200, 3200] },
        env: { a: 0.005, d: 0.08, s: 0.6, r: 0.12 },
        notes: [
          { t: 0, f: N.C5, d: 0.13 },
          { t: 0.15, f: N.E5, d: 0.13 },
          { t: 0.3, f: N.G5, d: 0.13 },
          { t: 0.45, f: N.C6, d: 0.3 },
          { t: 0.8, f: N.G5, d: 0.13 },
          { t: 0.95, f: N.C6, d: 0.13 },
          { t: 1.1, f: N.E6, d: 0.6 },
          { t: 1.8, f: N.D6, d: 0.13 },
          { t: 1.95, f: N.E6, d: 0.13 },
          { t: 2.1, f: N.G6, d: 0.75, g: 1.1 },
        ],
        reverb: 0.25,
      },
      {
        src: 'triangle',
        gain: 0.3,
        env: { a: 0.005, d: 0.08, s: 0.6, r: 0.12 },
        notes: [
          { t: 0, f: N.C5, d: 0.13 },
          { t: 0.15, f: N.E5, d: 0.13 },
          { t: 0.3, f: N.G5, d: 0.13 },
          { t: 0.45, f: N.C6, d: 0.3 },
          { t: 0.8, f: N.G5, d: 0.13 },
          { t: 0.95, f: N.C6, d: 0.13 },
          { t: 1.1, f: N.E6, d: 0.6 },
          { t: 1.8, f: N.D6, d: 0.13 },
          { t: 1.95, f: N.E6, d: 0.13 },
          { t: 2.1, f: N.G6, d: 0.75, g: 1.1 },
        ],
      },
      // 和音（C → F → C → G → C）
      {
        src: 'sawtooth',
        gain: 0.07,
        filter: { type: 'lowpass', freq: [1800, 1800] },
        env: { a: 0.02, d: 0.2, s: 0.6, r: 0.25 },
        notes: [
          ...[N.C4, N.E4, N.G4].map((f) => ({ t: 0, f, d: 0.7 })),
          ...[N.C4, N.F4, N.A4].map((f) => ({ t: 0.8, f, d: 0.28 })),
          ...[N.C4, N.E4, N.G4].map((f) => ({ t: 1.1, f, d: 0.65 })),
          ...[N.D4, N.G4, N.B4].map((f) => ({ t: 1.8, f, d: 0.28 })),
          ...[N.C4, N.E4, N.G4, N.C5].map((f) => ({ t: 2.1, f, d: 0.8 })),
        ],
        reverb: 0.3,
        reverbLong: true,
      },
      { src: 'sine', gain: 0.35, env: { a: 0.01, d: 0.2, s: 0.5, r: 0.2 }, notes: [{ t: 0, f: N.C3, d: 0.7 }, { t: 0.8, f: 174.61, d: 0.28 }, { t: 1.1, f: N.C3, d: 0.65 }, { t: 1.8, f: N.G3, d: 0.28 }, { t: 2.1, f: N.C3, d: 0.8 }] },
      kick(0),
      kick(0.45),
      kick(0.8),
      kick(1.1),
      kick(1.8),
      kick(2.1, 1),
      snare(0.3),
      snare(0.95),
      snare(1.45, 0.3),
      snare(1.95),
      { src: 'white', gain: 0.25, filter: { type: 'highpass', freq: [6000, 3000], time: 0.8 }, env: { a: 0.002, d: 0.8, s: 0, r: 0.1 }, delay: 2.1, reverb: 0.4, reverbLong: true },
      sparkle(2.15, 0.7, 20, 0.08),
    ],
  },
  // 敗北（約2.5秒）：ゆっくり下がる3音＋小さな「チーン」
  jingle_lose: {
    gain: 0.75,
    layers: [
      { src: 'triangle', gain: 0.4, env: { a: 0.02, d: 0.15, s: 0.6, r: 0.3 }, notes: [{ t: 0, f: N.G4, d: 0.48 }, { t: 0.52, f: N.E4, d: 0.48 }, { t: 1.04, f: N.C4, d: 0.62 }], reverb: 0.3, reverbLong: true },
      { src: 'sine', gain: 0.2, partials: [1, 2], env: { a: 0.05, d: 0.3, s: 0.5, r: 0.4 }, notes: [{ t: 0, f: N.G3, d: 0.48 }, { t: 0.52, f: 164.81, d: 0.48 }, { t: 1.04, f: N.C3, d: 0.62 }] },
      { src: 'sawtooth', gain: 0.05, filter: { type: 'lowpass', freq: [900, 400] }, env: { a: 0.2, d: 0.6, s: 0.5, r: 0.5 }, notes: [{ t: 0, f: N.A3, d: 1.5 }] },
      { src: 'sine', gain: 0.18, partials: [1, 2.76, 5.4], env: { a: 0.001, d: 0.02, s: 0.4, r: 0.45 }, notes: [{ t: 1.8, f: N.E6, d: 0.05 }], reverb: 0.3 },
    ],
  },
};
