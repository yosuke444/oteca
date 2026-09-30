import { Howler } from 'howler';
import { describe, expect, it } from 'vitest';
import { audio } from '../src/audio/audioManager';
import { Mixer } from '../src/audio/sfx/mixer';
import { FakeAudioContext, type FakeNode, gainOf, routes } from './fakeAudio';

/**
 * 効果音が鳴らない・音量が効かない不具合の再発防止（SPEC §10）。
 * 原因：howler の自動の「音の有効化」が、48000Hz の端末で AudioContext を閉じて作り直し、
 * ミキサーが閉じた AudioContext に残っていた（効果音は無音、BGM はミキサーを通らず音量設定が効かない）。
 * 本物の出力の確認は scripts/check-audio-output.mjs（Playwright）で行う。
 */

const asNode = (n: unknown) => n as FakeNode;
type H = { ctx: unknown; masterGain: unknown; autoUnlock: boolean; autoSuspend: boolean };
const howler = Howler as unknown as H;

/** howler が AudioContext を持っている状態にする（本物の howler が作った時と同じ形） */
function howlerCtx() {
  const ctx = new FakeAudioContext();
  const master = ctx.createGain();
  master.connect(ctx.destination);
  howler.ctx = ctx;
  howler.masterGain = master;
  return { ctx, master };
}

/** howler の BGM の出口から スピーカーまでの道すじ（1本だけのはず） */
function bgmRoute(master: FakeNode, ctx: FakeAudioContext) {
  const r = routes(master);
  expect(r).toHaveLength(1);
  expect(r[0].every((n) => n.context === ctx)).toBe(true);
  return r[0];
}

describe('音のつなぎ方（効果音が鳴らない・音量が効かない不具合）', () => {
  it('A01 howler の自動の有効化（AudioContext を作り直す）と自動の停止を切ってある', () => {
    expect(howler.autoUnlock).toBe(false);
    expect(howler.autoSuspend).toBe(false);
  });

  it('A02 BGM はミキサー（BGM の音量）を通ってスピーカーへ出る。スピーカーに直結しない', () => {
    const { ctx, master } = howlerCtx();
    audio.setVolumes(7, 7);
    audio.unlock();
    const r = bgmRoute(master, ctx);
    expect(r.length).toBeGreaterThan(2); // howler の出口 → … → スピーカー（直結なら2）
    expect(gainOf(r)).toBeGreaterThan(0);
  });

  it('A03 howler が AudioContext を作り直しても、ミキサーを作り直して つなぎ直す（効果音も新しい方で鳴る）', () => {
    const a = howlerCtx();
    audio.setVolumes(7, 7);
    audio.unlock();
    // 作り直し：古い方を閉じて、新しい出口はスピーカーに直結（howler の unload と同じ）
    void a.ctx.close();
    const b = howlerCtx();
    audio.unlock();
    expect(b.ctx.state).toBe('running');
    const r = bgmRoute(b.master, b.ctx);
    expect(r.length).toBeGreaterThan(2);
    // 音量も新しいミキサーに効く
    audio.setVolumes(0, 7);
    expect(gainOf(bgmRoute(b.master, b.ctx))).toBe(0);
    audio.setVolumes(7, 7);
  });

  it('A04 BGM の音量は BGM だけに、効果音の音量は効果音だけに効く。0 なら 0', () => {
    const ctx = new FakeAudioContext();
    const mx = new Mixer(ctx as unknown as BaseAudioContext);
    const se = () => gainOf(routes(asNode(mx.se))[0]);
    const bgm = () => gainOf(routes(asNode(mx.bgm))[0]);
    mx.setBgmVolume(0.7);
    mx.setSeVolume(0.7);
    const se7 = se();
    const bgm7 = bgm();
    mx.setBgmVolume(0.2);
    expect(bgm() / bgm7).toBeCloseTo(0.2 / 0.7);
    expect(se()).toBe(se7);
    mx.setSeVolume(0.2);
    expect(se() / se7).toBeCloseTo(0.2 / 0.7);
    expect(bgm() / bgm7).toBeCloseTo(0.2 / 0.7);
    mx.setBgmVolume(0);
    mx.setSeVolume(0);
    expect(bgm()).toBe(0);
    expect(se()).toBe(0);
  });

  it('A05 設定の音量はコンプレッサーの後でかける（前だと下げた分を持ち上げられて、音量を変えても あまり変わらない）', () => {
    const ctx = new FakeAudioContext();
    const mx = new Mixer(ctx as unknown as BaseAudioContext);
    mx.setSeVolume(0.3);
    const route = routes(asNode(mx.se))[0];
    const comp = route.findIndex((n) => n.kind === 'compressor');
    const vol = route.findIndex((n) => n.kind === 'gain' && (n.gain as { value: number }).value === 0.3);
    expect(comp).toBeGreaterThan(0);
    expect(vol).toBeGreaterThan(comp);
  });
});
