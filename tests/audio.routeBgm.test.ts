import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ROUTE_BGM } from '../src/audio/routeBgm';
import { BGM } from '../src/audio/soundMap';

/** howler の代わり：作った曲・鳴らした回数・小さくした回数を覚える（本物の音は出さない） */
const made: FakeHowl[] = [];
class FakeHowl {
  plays = 0;
  fades: [number, number][] = [];
  unloaded = false;
  constructor(readonly opts: { src: string[] }) {
    made.push(this);
  }
  state() {
    return 'loaded';
  }
  play() {
    this.plays++;
    return this.plays;
  }
  fade(from: number, to: number) {
    this.fades.push([from, to]);
  }
  volume() {
    return 0.3;
  }
  playing() {
    return !this.unloaded;
  }
  unload() {
    this.unloaded = true;
  }
  once() {}
  duration() {
    return 60;
  }
  seek() {
    return 0;
  }
}
vi.mock('howler', () => ({ Howl: FakeHowl, Howler: { volume: () => 1, ctx: undefined, masterGain: undefined } }));

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('画面ごとの BGM（v2.3）', () => {
  it('ストーリーのステージ選択は bgm_lobby、パックガチャ・カードトレードは bgm_deck', () => {
    expect(ROUTE_BGM.story).toBe('bgm_lobby');
    expect(ROUTE_BGM.lobby).toBe('bgm_lobby');
    expect(ROUTE_BGM.gacha).toBe('bgm_deck');
    expect(ROUTE_BGM.trade).toBe('bgm_deck');
    expect(ROUTE_BGM.settings).toBe('bgm_deck');
    expect(ROUTE_BGM.deck).toBe('bgm_deck');
  });

  it('使わなくなった曲（bgm_story・bgm_gacha・bgm_trade）は表に無い。ボス戦の曲は残っている', () => {
    for (const k of ['bgm_story', 'bgm_gacha', 'bgm_trade']) expect(Object.keys(BGM)).not.toContain(k);
    for (const k of ['bgm_boss', 'bgm_boss_ningen', 'bgm_boss_usagi', 'bgm_boss_zamurai', 'bgm_boss_dragon']) expect(Object.keys(BGM)).toContain(k);
    for (const v of Object.values(ROUTE_BGM)) if (v && v !== 'battle') expect(Object.keys(BGM)).toContain(v);
  });
});

describe('同じ曲の画面どうしは続けて流す', () => {
  beforeEach(() => {
    made.length = 0;
    (globalThis as { window?: unknown }).window ??= globalThis;
  });

  it('設定 → ガチャ → トレード：最初から流し直さない。ガチャ → ストーリー：0.8秒のクロスフェード', async () => {
    const { audio } = await import('../src/audio/audioManager');
    audio.playBgm(ROUTE_BGM.settings!);
    await flush();
    expect(made).toHaveLength(1);
    const deck = made[0];
    expect(deck.opts.src[0]).toMatch(/bgm_deck\.mp3$/);
    expect(deck.plays).toBe(1);

    audio.playBgm(ROUTE_BGM.gacha!);
    audio.playBgm(ROUTE_BGM.trade!);
    await flush();
    // 新しい曲を作らず、鳴らし直しもしない・小さくもしない
    expect(made).toHaveLength(1);
    expect(deck.plays).toBe(1);
    expect(deck.fades).toEqual([[0, expect.any(Number)]]);
    expect(deck.unloaded).toBe(false);

    audio.playBgm(ROUTE_BGM.story!);
    await flush();
    expect(made).toHaveLength(2);
    expect(made[1].opts.src[0]).toMatch(/bgm_lobby\.mp3$/);
    // 前の曲は小さくしてから止め、次の曲は 0 から大きくする（クロスフェード）
    expect(deck.fades.at(-1)).toEqual([0.3, 0]);
    expect(made[1].fades[0][0]).toBe(0);
    audio.playBgm(null);
  });
});
