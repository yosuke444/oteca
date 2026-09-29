import { getRelaySockets, joinRoom, selfId, type Room } from 'trystero';
import { APP_ID, isMsg, type Msg } from './protocol';
import type { NetTransport } from './transport';

/** 接続を助ける無料の公開STUN（SPEC §11-1） */
const ICE_SERVERS: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }];

/**
 * 前の部屋を出る処理（Trystero の leave は非同期）。終わる前に同じ部屋名で入ると、
 * 閉じかけの古い部屋が返ってきてしまうので、次に入る時はこれを待つ。
 */
let leaving: Promise<unknown> = Promise.resolve();

/** 中継網（Nostr のリレー）に1つもつながらないまま、この時間がたったら「つながらなかった」 */
const RELAY_CHECK_MS = 12000;

/**
 * Trystero（WebRTC）を使った通信（SPEC §11-1）
 * 相手を見つける手続きは Trystero が公開の中継網（Nostr のリレー）で行う。自前のサーバーは要らない。
 */
export class TrysteroTransport implements NetTransport {
  readonly selfId = selfId;
  private room: Room | null = null;
  private sendMsg: ((msg: Msg, to?: string) => void) | null = null;
  private relayTimer: ReturnType<typeof setTimeout> | null = null;
  private action: { onMessage: unknown } | null = null;
  /** leave した（入る前に leave されたら入らない） */
  private closed = false;
  onMessage: NetTransport['onMessage'] = () => {};
  onPeerJoin: NetTransport['onPeerJoin'] = () => {};
  onPeerLeave: NetTransport['onPeerLeave'] = () => {};
  onError: NetTransport['onError'] = () => {};

  join(roomId: string): void {
    this.closed = false;
    void leaving.then(() => {
      if (!this.closed) this.open(roomId);
    });
  }

  private open(roomId: string): void {
    const room = joinRoom({ appId: APP_ID, rtcConfig: { iceServers: ICE_SERVERS } }, roomId, {
      // WebRTC でつながらなかった時など（TURN が無いと、一部の回線ではつながらない）
      onJoinError: (d) => this.onError(String(d.error)),
    });
    this.room = room;
    const action = room.makeAction<Msg>('oteca');
    this.action = action;
    action.onMessage = (data, ctx) => {
      if (isMsg(data)) this.onMessage(data, ctx.peerId);
    };
    this.sendMsg = (msg, to) => {
      void action.send(msg, to ? { target: to } : undefined).catch(() => {});
    };
    room.onPeerJoin = (id) => this.onPeerJoin(id);
    room.onPeerLeave = (id) => this.onPeerLeave(id);
    this.relayTimer = setTimeout(() => {
      this.relayTimer = null;
      const open = Object.values(getRelaySockets() as Record<string, WebSocket>).some((ws) => ws.readyState === WebSocket.OPEN);
      if (!open) this.onError('relay');
    }, RELAY_CHECK_MS);
  }

  leave(): void {
    this.closed = true;
    if (this.relayTimer) clearTimeout(this.relayTimer);
    this.relayTimer = null;
    const room = this.room;
    if (room) {
      // 受け取り口を外してから出る（出終わるまでの間に知らせが届かないように）
      room.onPeerJoin = null;
      room.onPeerLeave = null;
      if (this.action) this.action.onMessage = null;
      leaving = Promise.resolve(room.leave()).catch(() => {});
    }
    this.room = null;
    this.action = null;
    this.sendMsg = null;
  }

  send(msg: Msg, to?: string): void {
    this.sendMsg?.(msg, to);
  }
}
