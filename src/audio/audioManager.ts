import { Howl, Howler } from 'howler';
import { BGM, BGM_CROSSFADE, BGM_DIR, type BgmKey, DUCK, SE_DIR } from './soundMap';
import { Mixer } from './sfx/mixer';
import { RECIPES } from './sfx/recipes';
import { playRecipe } from './sfx/synth';

/**
 * 音の窓口（SPEC §10）
 * - BGM：howler.js。ファイルが無い間は無音で動く。0.8秒のクロスフェード、ループ位置の指定
 * - 効果音：Web Audio API でその場で合成（recipes.ts）。public/audio/se/<キー>.mp3 があればそちらを優先
 * - 音量は設定（0〜10）の値。スマホの自動再生制限があるので、最初のタップ（タイトル）で有効にする
 */

type BgmTrack = { key: BgmKey; howl: Howl; volume: number };

const base = import.meta.env.BASE_URL ?? '/';

class AudioManager {
  private mixer: Mixer | null = null;
  private bgmVolume = 0.6;
  private seVolume = 0.8;
  private current: BgmTrack | null = null;
  private wanted: BgmKey | null = null;
  /** ファイルがあるかどうか（キー → 使えるファイルのURL。無ければ null） */
  private readonly bgmFiles = new Map<BgmKey, Promise<string[] | null>>();
  private readonly seFiles = new Map<string, Promise<AudioBuffer | null>>();
  private ducking = 0;

  /** 音を使えるようにする（タイトルのタップで呼ぶ） */
  unlock(): void {
    const mx = this.ensureMixer();
    if (mx && mx.ctx.state !== 'running') void (mx.ctx as AudioContext).resume();
    // howler 側もタップの中で有効にする
    try {
      const ctx = Howler.ctx;
      if (ctx && ctx.state !== 'running') void ctx.resume();
    } catch {
      // 使えない環境でも動く
    }
  }

  get unlocked(): boolean {
    return this.mixer?.ctx.state === 'running';
  }

  /** 設定の音量（0〜10）を反映 */
  setVolumes(bgm: number, se: number): void {
    this.bgmVolume = Math.max(0, Math.min(10, bgm)) / 10;
    this.seVolume = Math.max(0, Math.min(10, se)) / 10;
    this.mixer?.setSeVolume(this.seVolume);
    if (this.current) this.current.howl.volume(this.trackVolume(this.current.key));
  }

  // ---------------------------------------------------------------- 効果音

  /** 効果音を鳴らす（キーは soundMap.ts の SE_KEYS） */
  play(key: string): void {
    if (this.seVolume <= 0) return;
    const mx = this.ensureMixer();
    if (!mx || mx.ctx.state !== 'running') return;
    const recipe = RECIPES[key];
    if (recipe?.duck) this.duckBgm();
    void this.fileOverride(key).then((buf) => {
      if (buf) {
        const src = mx.ctx.createBufferSource();
        src.buffer = buf;
        src.connect(mx.se);
        src.start();
      } else if (recipe) {
        playRecipe(mx, recipe);
      }
    });
  }

  /** BGM を一瞬（0.4秒）40% 下げる（大ダメージ・きぜつ。§10-3） */
  duckBgm(): void {
    const cur = this.current;
    if (!cur) return;
    const full = this.trackVolume(cur.key);
    this.ducking += 1;
    cur.howl.fade(cur.howl.volume(), full * DUCK.level, 40);
    window.setTimeout(() => {
      this.ducking -= 1;
      if (this.ducking === 0 && this.current === cur) cur.howl.fade(cur.howl.volume(), full, 250);
    }, DUCK.seconds * 1000);
  }

  // ---------------------------------------------------------------- BGM

  /** BGM を切り替える（null で止める）。0.8秒のクロスフェード */
  playBgm(key: BgmKey | null): void {
    this.wanted = key;
    if (this.current?.key === key) return;
    const old = this.current;
    this.current = null;
    if (old) {
      old.howl.fade(old.howl.volume(), 0, BGM_CROSSFADE * 1000);
      window.setTimeout(() => old.howl.unload(), BGM_CROSSFADE * 1000 + 50);
    }
    if (!key) return;
    void this.bgmSources(key).then((src) => {
      // ファイルが無い間は無音（§10-1）
      if (!src || this.wanted !== key || this.current?.key === key) return;
      const info = BGM[key];
      const volume = this.trackVolume(key);
      const howl = new Howl({
        src,
        html5: false,
        loop: info.loopStart === undefined && info.loopEnd === undefined,
        volume: 0,
        onloaderror: () => {
          if (this.current?.howl === howl) this.current = null;
        },
      });
      const track: BgmTrack = { key, howl, volume };
      this.current = track;
      const start = () => {
        if (this.current !== track) return;
        const dur = howl.duration();
        const ls = info.loopStart ?? 0;
        const le = info.loopEnd ?? dur;
        if (info.loopStart !== undefined || info.loopEnd !== undefined) {
          // イントロ → ループ部分をくり返す（howler のスプライト）
          (howl as unknown as { _sprite: Record<string, [number, number, boolean?]> })._sprite = {
            intro: [0, ls * 1000],
            loop: [ls * 1000, (le - ls) * 1000, true],
          };
          const id = ls > 0 ? howl.play('intro') : howl.play('loop');
          if (ls > 0) howl.once('end', () => this.current === track && howl.play('loop'), id);
        } else {
          howl.play();
        }
        howl.fade(0, volume, BGM_CROSSFADE * 1000);
      };
      if (howl.state() === 'loaded') start();
      else howl.once('load', start);
    });
  }

  get bgmKey(): BgmKey | null {
    return this.wanted;
  }

  // ---------------------------------------------------------------- 内部

  private trackVolume(key: BgmKey): number {
    return this.bgmVolume * (BGM[key].volume ?? 1);
  }

  private ensureMixer(): Mixer | null {
    if (this.mixer) return this.mixer;
    try {
      this.mixer = new Mixer();
      this.mixer.setSeVolume(this.seVolume);
    } catch {
      this.mixer = null;
    }
    return this.mixer;
  }

  /** BGM のファイル（.mp3 と、あれば同名の .ogg）。無ければ null */
  private bgmSources(key: BgmKey): Promise<string[] | null> {
    const hit = this.bgmFiles.get(key);
    if (hit) return hit;
    const p = (async () => {
      const urls = [`${base}${BGM_DIR}${key}.mp3`, `${base}${BGM_DIR}${key}.ogg`];
      const ok = await Promise.all(urls.map(exists));
      const found = urls.filter((_, i) => ok[i]);
      return found.length > 0 ? found : null;
    })();
    this.bgmFiles.set(key, p);
    return p;
  }

  /** 効果音のファイル差し替え（public/audio/se/<キー>.mp3）。無ければ null */
  private fileOverride(key: string): Promise<AudioBuffer | null> {
    const hit = this.seFiles.get(key);
    if (hit) return hit;
    const mx = this.mixer!;
    const p = (async () => {
      const url = `${base}${SE_DIR}${key}.mp3`;
      if (!(await exists(url))) return null;
      try {
        const res = await fetch(url);
        return await mx.ctx.decodeAudioData(await res.arrayBuffer());
      } catch {
        return null;
      }
    })();
    this.seFiles.set(key, p);
    return p;
  }
}

/** ファイルがあるか（音のファイルとして返ってくるか。開発サーバーは無いファイルに HTML を返すことがある） */
async function exists(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { method: 'HEAD' });
    const type = res.headers.get('content-type') ?? '';
    return res.ok && !type.includes('text/html');
  } catch {
    return false;
  }
}

export const audio = new AudioManager();
