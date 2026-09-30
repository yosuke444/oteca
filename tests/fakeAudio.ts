/**
 * テスト用の にせの AudioContext（Web Audio が無い Node で、音の「つながり」と「音量の値」を確かめる）。
 * 本物の音は出さない。connect の行き先と、AudioParam に最後に決めた値だけを覚える。
 */

export class FakeParam {
  constructor(public value = 1) {}
  setValueAtTime(v: number) {
    this.value = v;
    return this;
  }
  linearRampToValueAtTime(v: number) {
    this.value = v;
    return this;
  }
  setTargetAtTime(v: number) {
    this.value = v;
    return this;
  }
  exponentialRampToValueAtTime(v: number) {
    this.value = v;
    return this;
  }
  cancelScheduledValues() {
    return this;
  }
}

export class FakeNode {
  readonly outs = new Set<FakeNode>();
  [param: string]: unknown;
  constructor(
    readonly context: FakeAudioContext,
    readonly kind: string,
  ) {}
  connect(to: FakeNode) {
    this.outs.add(to);
    return to;
  }
  disconnect() {
    this.outs.clear();
  }
}

export class FakeAudioContext {
  state: 'suspended' | 'running' | 'closed' = 'suspended';
  readonly sampleRate = 48000;
  readonly currentTime = 0;
  readonly destination: FakeNode;
  constructor() {
    this.destination = new FakeNode(this, 'destination');
  }
  private node(kind: string, params: Record<string, number>) {
    const n = new FakeNode(this, kind);
    for (const [k, v] of Object.entries(params)) n[k] = new FakeParam(v);
    return n;
  }
  createGain() {
    return this.node('gain', { gain: 1 });
  }
  createDynamicsCompressor() {
    return this.node('compressor', { threshold: -24, knee: 30, ratio: 12, attack: 0.003, release: 0.25 });
  }
  createConvolver() {
    return this.node('convolver', {});
  }
  createBuffer(channels: number, length: number) {
    const data = Array.from({ length: channels }, () => new Float32Array(length));
    return { getChannelData: (c: number) => data[c] };
  }
  resume() {
    if (this.state !== 'closed') this.state = 'running';
    return Promise.resolve();
  }
  close() {
    this.state = 'closed';
    return Promise.resolve();
  }
}

/** from から destination までの道すじ（ノードの種類の並び）を全部 */
export function routes(from: FakeNode): FakeNode[][] {
  if (from.kind === 'destination') return [[from]];
  return [...from.outs].flatMap((n) => routes(n).map((r) => [from, ...r]));
}

/** 道すじの gain をかけ合わせた値（その道を通る音の大きさの倍率） */
export function gainOf(route: FakeNode[]): number {
  return route.reduce((g, n) => (n.kind === 'gain' ? g * (n.gain as FakeParam).value : g), 1);
}
