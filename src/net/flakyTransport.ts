import type { Msg } from './protocol';
import type { NetTransport } from './transport';

/**
 * 開発用：通信を「わざと切る」ための包み（?debug=1 の時だけ使う）
 * setOffline(true) の間は送るのも受け取るのも捨てる。切断・再接続（SPEC §11-7）を手元で確かめるためのもの。
 */
export class FlakyTransport implements NetTransport {
  private offline = false;
  onMessage: NetTransport['onMessage'] = () => {};
  onPeerJoin: NetTransport['onPeerJoin'] = () => {};
  onPeerLeave: NetTransport['onPeerLeave'] = () => {};
  onError: NetTransport['onError'] = () => {};

  constructor(private readonly inner: NetTransport) {
    inner.onMessage = (m, from) => {
      if (!this.offline) this.onMessage(m, from);
    };
    inner.onPeerJoin = (id) => this.onPeerJoin(id);
    inner.onPeerLeave = (id) => this.onPeerLeave(id);
    inner.onError = (r) => this.onError(r);
  }

  get selfId(): string {
    return this.inner.selfId;
  }

  setOffline(v: boolean): void {
    this.offline = v;
  }

  get isOffline(): boolean {
    return this.offline;
  }

  join(room: string): void {
    this.inner.join(room);
  }

  leave(): void {
    this.inner.leave();
  }

  send(msg: Msg, to?: string): void {
    if (!this.offline) this.inner.send(msg, to);
  }
}
