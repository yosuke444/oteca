import { isMsg, type Msg } from './protocol';
import type { NetTransport } from './transport';

type Envelope =
  | { kind: 'join'; from: string }
  | { kind: 'here'; from: string; to: string }
  | { kind: 'leave'; from: string }
  | { kind: 'msg'; from: string; to?: string; msg: Msg };

/**
 * 開発用：同じブラウザのタブどうしだけでつながる通信（BroadcastChannel）
 * URL に ?net=local を付けた時だけ使う。公開の中継網につながらない環境で、
 * ロビー〜対戦〜再戦の流れを確かめるためのもの。本番のフレンド対戦は Trystero を使う。
 */
export class LocalTransport implements NetTransport {
  readonly selfId: string;
  private ch: BroadcastChannel | null = null;
  private readonly peers = new Set<string>();
  onMessage: NetTransport['onMessage'] = () => {};
  onPeerJoin: NetTransport['onPeerJoin'] = () => {};
  onPeerLeave: NetTransport['onPeerLeave'] = () => {};
  onError: NetTransport['onError'] = () => {};

  constructor() {
    const b = new Uint8Array(8);
    crypto.getRandomValues(b);
    this.selfId = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  }

  join(room: string): void {
    const ch = new BroadcastChannel(`oteca-local-${room}`);
    this.ch = ch;
    ch.onmessage = (ev: MessageEvent<Envelope>) => this.receive(ev.data);
    this.post({ kind: 'join', from: this.selfId });
    window.addEventListener('pagehide', this.onHide);
  }

  leave(): void {
    if (!this.ch) return;
    this.post({ kind: 'leave', from: this.selfId });
    this.ch.close();
    this.ch = null;
    this.peers.clear();
    window.removeEventListener('pagehide', this.onHide);
  }

  send(msg: Msg, to?: string): void {
    this.post({ kind: 'msg', from: this.selfId, to, msg });
  }

  private readonly onHide = () => this.leave();

  private post(e: Envelope): void {
    this.ch?.postMessage(e);
  }

  private addPeer(id: string): void {
    if (this.peers.has(id)) return;
    this.peers.add(id);
    this.onPeerJoin(id);
  }

  private receive(e: Envelope): void {
    if (e.from === this.selfId) return;
    switch (e.kind) {
      case 'join':
        this.addPeer(e.from);
        this.post({ kind: 'here', from: this.selfId, to: e.from });
        break;
      case 'here':
        if (e.to === this.selfId) this.addPeer(e.from);
        break;
      case 'leave':
        if (this.peers.delete(e.from)) this.onPeerLeave(e.from);
        break;
      case 'msg':
        if ((!e.to || e.to === this.selfId) && this.peers.has(e.from) && isMsg(e.msg)) this.onMessage(e.msg, e.from);
        break;
    }
  }
}
