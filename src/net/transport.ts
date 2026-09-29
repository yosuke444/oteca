import type { Msg } from './protocol';

/**
 * 通信の共通の窓口（SPEC §2、§11-1）
 * 通信ライブラリ（今は Trystero）は必ずこの形越しに使う。後で PeerJS などに差し替えられるように。
 */
export interface NetTransport {
  /** 自分のピアID */
  readonly selfId: string;
  /** 部屋に入る */
  join(room: string): void;
  /** 部屋を出る */
  leave(): void;
  /** 送る（to を省くと部屋の全員へ） */
  send(msg: Msg, to?: string): void;
  onMessage: (msg: Msg, from: string) => void;
  onPeerJoin: (peerId: string) => void;
  onPeerLeave: (peerId: string) => void;
  /** つながらなかった時など */
  onError: (reason: string) => void;
}

/**
 * テスト用：同じプログラムの中だけでつながる部屋（通信なし）
 */
export class MemoryHub {
  private readonly rooms = new Map<string, Set<MemoryTransport>>();
  private n = 0;

  create(id?: string): MemoryTransport {
    this.n += 1;
    return new MemoryTransport(this, id ?? `peer-${String(this.n).padStart(3, '0')}`);
  }

  /** @internal */
  enter(room: string, t: MemoryTransport): void {
    const set = this.rooms.get(room) ?? new Set();
    this.rooms.set(room, set);
    const others = [...set];
    set.add(t);
    for (const other of others) {
      other.onPeerJoin(t.selfId);
      t.onPeerJoin(other.selfId);
    }
  }

  /** @internal */
  exit(room: string, t: MemoryTransport): void {
    const set = this.rooms.get(room);
    if (!set?.delete(t)) return;
    for (const other of set) other.onPeerLeave(t.selfId);
  }

  /** @internal */
  deliver(room: string, from: MemoryTransport, msg: Msg, to?: string): void {
    for (const other of this.rooms.get(room) ?? []) {
      if (other === from || (to && other.selfId !== to)) continue;
      // 本物の通信と同じように、JSON にしてから届ける
      const copy = JSON.parse(JSON.stringify(msg)) as Msg;
      other.inbox.push(() => other.onMessage(copy, from.selfId));
    }
  }

  /** たまっているメッセージを全部届ける（届けた数を返す） */
  flush(max = 100000): number {
    let count = 0;
    let progressed = true;
    while (progressed && count < max) {
      progressed = false;
      for (const set of this.rooms.values()) {
        for (const t of set) {
          const fn = t.inbox.shift();
          if (fn) {
            fn();
            count += 1;
            progressed = true;
          }
        }
      }
    }
    return count;
  }
}

export class MemoryTransport implements NetTransport {
  /** @internal */
  inbox: (() => void)[] = [];
  private room: string | null = null;
  onMessage: NetTransport['onMessage'] = () => {};
  onPeerJoin: NetTransport['onPeerJoin'] = () => {};
  onPeerLeave: NetTransport['onPeerLeave'] = () => {};
  onError: NetTransport['onError'] = () => {};

  constructor(
    private readonly hub: MemoryHub,
    readonly selfId: string,
  ) {}

  join(room: string): void {
    this.room = room;
    this.hub.enter(room, this);
  }

  leave(): void {
    if (this.room) this.hub.exit(this.room, this);
    this.room = null;
    this.inbox = [];
  }

  send(msg: Msg, to?: string): void {
    if (this.room) this.hub.deliver(this.room, this, msg, to);
  }
}
