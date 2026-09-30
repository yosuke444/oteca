import { Howl, Howler } from 'howler';
import audioFiles from 'virtual:audio-files';
import { BattlePlaylist } from './battlePlaylist';
import {
  BATTLE_DIR,
  BATTLE_PRELOAD_SECONDS,
  BATTLE_VOLUME,
  BGM,
  BGM_CROSSFADE,
  BGM_LEVEL,
  BGM_DIR,
  type BgmKey,
  LAST_BATTLE_KEY,
  type LoopBgmKey,
  SE_DIR,
  SE_KEYS,
  battleTracks,
} from './soundMap';
import { Mixer } from './sfx/mixer';
import { RECIPES } from './sfx/recipes';
import { playRecipe } from './sfx/synth';

/**
 * 音の窓口（SPEC §10）
 * - BGM：howler.js。ファイルが無い間は無音で動く。0.8秒のクロスフェード、ループ位置の指定
 * - 戦闘曲：battle フォルダの曲をシャッフルで1曲ずつ最後まで流し、次の曲へ（ループしない）。
 *   流す曲だけ読み込み、次の曲は残り BATTLE_PRELOAD_SECONDS 秒で先読みする（同時に持つのは2曲まで）
 * - 効果音：Web Audio API でその場で合成（recipes.ts）。public/audio/se/<キー>.mp3 があればそちらを優先
 * - howler と同じ AudioContext を使い、BGM も効果音も mixer（バス → コンプレッサー）を通す
 * - 音量は設定（0〜10）の値。スマホの自動再生制限があるので、画面を触った時に音を有効にする
 */

type BgmTrack = {
  key: BgmKey;
  howl: Howl;
  /** 鳴らしている音の番号（howler の sound id） */
  id?: number;
  /** 戦闘曲：曲の番号（battleTracks の何番目か） */
  song?: number;
  /** 戦闘曲：先読みした次の曲 */
  next?: BattleSong | null;
  /** 戦闘曲：先読みの見張り（setInterval） */
  timer?: number;
};

/** 戦闘曲1曲ぶん（読み込みに失敗したら failed） */
type BattleSong = { song: number; howl: Howl; failed: boolean; onFail?: () => void };

const base = import.meta.env.BASE_URL ?? '/';

type HowlInternals = {
  _sprite: Record<string, [number, number, boolean?]>;
  _soundById(id: number): { _node?: { bufferSource?: AudioBufferSourceNode } } | null;
};

class AudioManager {
  private mixer: Mixer | null = null;
  private bgmVolume = 0.6;
  private seVolume = 0.8;
  private current: BgmTrack | null = null;
  private wanted: BgmKey | null = null;
  private readonly bgmFiles = new Map<LoopBgmKey, Promise<string[] | null>>();
  /** 戦闘曲の順番（ページを開いている間は続きから。再戦でも同じ曲が続かない） */
  private playlist: BattlePlaylist | null = null;
  /** 効果音の差し替えファイル（確認が済んだものだけ。null ＝ 無い） */
  private readonly seFiles = new Map<string, AudioBuffer | null>();
  private seChecked = false;

  /** 音を使えるようにする（タイトルのタップ・画面に触った時に呼ぶ。何度呼んでもよい） */
  unlock(): void {
    const mx = this.ensureMixer();
    if (mx && mx.ctx.state !== 'running') void (mx.ctx as AudioContext).resume().catch(() => {});
    if (mx && !this.seChecked) {
      this.seChecked = true;
      void this.checkSeFiles(mx);
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
    this.mixer?.setBgmVolume(this.bgmVolume);
  }

  // ---------------------------------------------------------------- 効果音

  /** 効果音を鳴らす（キーは soundMap.ts の SE_KEYS） */
  play(key: string): void {
    if (this.seVolume <= 0) return;
    const mx = this.ensureMixer();
    if (!mx) return;
    const go = () => {
      const file = this.seFiles.get(key);
      if (file) {
        const src = mx.ctx.createBufferSource();
        src.buffer = file;
        src.connect(mx.se);
        src.onended = () => src.disconnect();
        src.start();
        return;
      }
      const recipe = RECIPES[key];
      if (recipe) playRecipe(mx, recipe);
    };
    if (mx.ctx.state === 'running') go();
    // まだ有効になっていない（最初のタップの直後など）：有効になってから鳴らす
    else void (mx.ctx as AudioContext).resume().then(go, () => {});
  }

  /** BGM を一瞬（0.4秒）40% 下げる（大ダメージ・きぜつ。§10-3） */
  duckBgm(): void {
    this.mixer?.duckBgm();
  }

  // ---------------------------------------------------------------- BGM

  /** BGM を切り替える（null で止める）。0.8秒のクロスフェード */
  playBgm(key: BgmKey | null): void {
    this.wanted = key;
    if (this.current?.key === key) return;
    const old = this.current;
    this.current = null;
    if (old) this.dropTrack(old, true);
    if (!key) return;
    this.ensureMixer();
    if (key === 'battle') {
      this.playBattle(null, true);
      return;
    }
    void this.bgmSources(key).then((src) => {
      // ファイルが無い間は無音（§10-1）
      if (!src || this.wanted !== key || this.current?.key === key) return;
      const info = BGM[key];
      const volume = (info.volume ?? 1) * BGM_LEVEL;
      const custom = info.loopStart !== undefined || info.loopEnd !== undefined;
      const howl = new Howl({
        src,
        html5: false,
        loop: true,
        volume: 0,
        onloaderror: () => {
          if (this.current?.howl === howl) this.current = null;
        },
      });
      const track: BgmTrack = { key, howl };
      this.current = track;
      const start = () => {
        if (this.current !== track) return;
        let id: number;
        if (custom) {
          // イントロ付き：0 から鳴らし、2周目からは loopStart〜loopEnd をくり返す（Web Audio のループで、つなぎ目に隙間が出ない）
          const dur = howl.duration();
          const le = Math.min(info.loopEnd ?? dur, dur);
          const ls = Math.max(0, Math.min(info.loopStart ?? 0, le - 0.05));
          const h = howl as unknown as HowlInternals;
          h._sprite = { ...h._sprite, bgm: [0, le * 1000, true] };
          id = howl.play('bgm');
          const bs = h._soundById(id)?._node?.bufferSource;
          if (bs) {
            bs.loopStart = ls;
            bs.loopEnd = le;
          }
        } else {
          id = howl.play();
        }
        track.id = id;
        howl.fade(0, volume, BGM_CROSSFADE * 1000, id);
      };
      if (howl.state() === 'loaded') start();
      else howl.once('load', start);
    });
  }

  // ---------------------------------------------------------------- 戦闘曲（§10-2）

  /**
   * 戦闘曲を1曲流す。prepared は先読みしておいた曲（無ければ次の曲を読み込む）。
   * 最後まで終わったら次の曲へ。読み込めない曲は飛ばす（全部だめなら無音）
   */
  private playBattle(prepared: BattleSong | null, fadeIn: boolean, failures = 0): void {
    const cur = prepared && !prepared.failed ? prepared : this.prepareBattle();
    if (prepared && prepared !== cur) prepared.howl.unload();
    if (!cur) return; // 曲が無い：無音
    const { howl, song } = cur;
    const track: BgmTrack = { key: 'battle', howl, song, next: null };
    this.current = track;
    const skip = () => {
      if (this.current !== track) return;
      this.current = null;
      this.dropTrack(track, false);
      if (failures + 1 < battleTracks.length) this.playBattle(null, fadeIn, failures + 1);
    };
    if (cur.failed) {
      skip();
      return;
    }
    cur.onFail = skip;
    const volume = (BATTLE_VOLUME[battleTracks[song].id] ?? 1) * BGM_LEVEL;
    const start = () => {
      if (this.current !== track) return;
      const id = howl.play();
      track.id = id;
      // 最初の曲はクロスフェードで入る。2曲目からは間をあけずにそのまま
      if (fadeIn) howl.fade(0, volume, BGM_CROSSFADE * 1000, id);
      else howl.volume(volume, id);
      saveLastBattle(battleTracks[song].id);
      track.timer = window.setInterval(() => {
        // 残りが少なくなったら次の曲を先読み
        if (this.current !== track || track.next) return;
        const dur = howl.duration();
        const pos = Number(howl.seek()) || 0;
        if (dur > 0 && dur - pos <= BATTLE_PRELOAD_SECONDS) track.next = this.prepareBattle();
      }, 1000);
    };
    howl.once('end', () => {
      if (this.current !== track) return;
      const next = track.next ?? null;
      track.next = null;
      this.current = null;
      this.dropTrack(track, false);
      this.playBattle(next, false);
    });
    if (howl.state() === 'loaded') start();
    else howl.once('load', start);
  }

  /** 次の戦闘曲を読み込み始める（曲が無ければ null） */
  private prepareBattle(): BattleSong | null {
    if (!this.playlist) this.playlist = new BattlePlaylist(battleTracks.length, Math.random, loadLastBattle());
    const song = this.playlist.next();
    if (song === null) return null;
    const t = battleTracks[song];
    const cur: BattleSong = {
      song,
      failed: false,
      howl: new Howl({
        src: t.files.map((f) => `${base}${BATTLE_DIR}${f}`),
        html5: false,
        loop: false,
        volume: 0,
        onloaderror: () => {
          cur.failed = true;
          cur.onFail?.();
        },
      }),
    };
    return cur;
  }

  /** 曲を止めて片付ける（fade＝0.8秒で小さくしてから） */
  private dropTrack(t: BgmTrack, fade: boolean): void {
    if (t.timer) window.clearInterval(t.timer);
    t.next?.howl.unload();
    t.next = null;
    if (fade && t.id !== undefined && t.howl.playing(t.id)) {
      // 音ごとの今の大きさから 0 へ（howl.volume() はグループの値で、fade(id) では変わらないため）
      t.howl.fade(t.howl.volume(t.id) as number, 0, BGM_CROSSFADE * 1000, t.id);
      window.setTimeout(() => t.howl.unload(), BGM_CROSSFADE * 1000 + 50);
    } else {
      t.howl.unload();
    }
  }

  get bgmKey(): BgmKey | null {
    return this.wanted;
  }

  /** いま流れている戦闘曲の名前（例 battle_03）。確認用 */
  get battleSong(): string | null {
    const t = this.current;
    return t?.key === 'battle' && t.song !== undefined ? battleTracks[t.song].id : null;
  }

  /** 確認用：いまの曲を、終わりの sec 秒前まで早送りする（曲の切りかわりを確かめる） */
  seekNearEnd(sec = 5): void {
    const t = this.current;
    if (!t || t.id === undefined) return;
    const dur = t.howl.duration();
    if (dur > sec) t.howl.seek(dur - sec, t.id);
  }

  // ---------------------------------------------------------------- 内部

  private ensureMixer(): Mixer | null {
    if (this.mixer) return this.mixer;
    try {
      // howler の AudioContext を作らせて、それを効果音にも使う
      Howler.volume(Howler.volume());
      const ctx = Howler.ctx ?? undefined;
      const mx = new Mixer(ctx);
      if (Howler.masterGain && ctx) {
        // howler の出口を BGM バスへつなぎ直す（BGM も コンプレッサーを通る）
        Howler.masterGain.disconnect();
        Howler.masterGain.connect(mx.bgm);
      }
      mx.setSeVolume(this.seVolume);
      mx.setBgmVolume(this.bgmVolume);
      this.mixer = mx;
    } catch {
      this.mixer = null;
    }
    return this.mixer;
  }

  /** BGM のファイル（.mp3 と、あれば同名の .ogg）。無ければ null */
  private bgmSources(key: LoopBgmKey): Promise<string[] | null> {
    const hit = this.bgmFiles.get(key);
    if (hit) return hit;
    // 置いてあるファイルだけ（一覧はビルドした時に作る。無いファイルを確かめに行かない）
    const found = [`${BGM_DIR}${key}.mp3`, `${BGM_DIR}${key}.ogg`].filter(hasFile).map((f) => `${base}${f}`);
    const p = Promise.resolve(found.length > 0 ? found : null);
    this.bgmFiles.set(key, p);
    return p;
  }

  /**
   * 効果音の差し替えファイル（public/audio/se/<キー>.mp3）を、音を有効にした時にまとめて確かめる。
   * 確かめ終わるまでは合成音を鳴らす（最初の音を待たせない）
   */
  private async checkSeFiles(mx: Mixer): Promise<void> {
    await Promise.all(
      SE_KEYS.map(async (key) => {
        const file = `${SE_DIR}${key}.mp3`;
        const url = `${base}${file}`;
        if (!hasFile(file)) {
          this.seFiles.set(key, null);
          return;
        }
        try {
          const res = await fetch(url);
          this.seFiles.set(key, await mx.ctx.decodeAudioData(await res.arrayBuffer()));
        } catch {
          this.seFiles.set(key, null);
        }
      }),
    );
  }
}

/** 直前に流れた戦闘曲（localStorage。使えない環境では null） */
function loadLastBattle(): number | null {
  try {
    const id = window.localStorage.getItem(LAST_BATTLE_KEY);
    const i = battleTracks.findIndex((t) => t.id === id);
    return i >= 0 ? i : null;
  } catch {
    return null;
  }
}

function saveLastBattle(id: string): void {
  try {
    window.localStorage.setItem(LAST_BATTLE_KEY, id);
  } catch {
    // 保存できない環境（プライベートモードなど）：覚えないだけ
  }
}

const files = new Set(audioFiles.map((f) => `audio/${f}`));

/** public/ の下にそのファイルがあるか（例 audio/bgm/bgm_title.mp3。一覧は vite.config.ts が作る） */
function hasFile(path: string): boolean {
  return files.has(path);
}

export const audio = new AudioManager();
