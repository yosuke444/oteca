import { DurableObject } from 'cloudflare:workers';
import type { Env } from './env';

/**
 * 届け係（v2.7。Durable Object・WebSocket の休止機能。SPEC §7 S20「ギフトトロフィあげ」）。
 * ゲームを開いている人と1本つないだままにし、管理画面でトロフィあげを渡した瞬間に「とどいたよ」とだけ知らせる。
 * つないで待っている間は何も送らない（休止して眠る。無料枠の時間・回数を使わない）。
 * 中身（どのトロフィーか）は送らない：知らせを受けた端末が郵便受け（/mailbox）を確かめる。1つだけ作る（名前 'hub'）
 */

/** 1人がつないでおける数（タブ・端末。多い時は古い方を切る） */
export const GIFT_LINKS_PER_USER = 3;
/** 知らせの中身 */
export const GIFT_PING = '{"t":"gift"}';

export class GiftHub extends DurableObject<Env> {
  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === '/connect') {
      if (req.headers.get('Upgrade') !== 'websocket') return new Response('expected websocket', { status: 426 });
      // Worker が token で確かめたユーザーID を札（tag）に付ける
      const userId = req.headers.get('x-user-id') ?? '';
      if (!userId) return new Response('bad', { status: 400 });
      const old = this.ctx.getWebSockets(userId);
      for (const ws of old.slice(0, Math.max(0, old.length - (GIFT_LINKS_PER_USER - 1)))) ws.close(4000, 'replaced');
      const pair = new WebSocketPair();
      this.ctx.acceptWebSocket(pair[1], [userId]);
      return new Response(null, { status: 101, webSocket: pair[0] });
    }
    if (url.pathname === '/notify' && req.method === 'POST') {
      // userId（1人）か userIds（まとめて。v2.7）
      const b = (await req.json().catch(() => null)) as { userId?: unknown; userIds?: unknown } | null;
      const ids = (Array.isArray(b?.userIds) ? b!.userIds : [b?.userId]).filter((x): x is string => typeof x === 'string' && x !== '').slice(0, 200);
      if (!ids.length) return new Response('bad', { status: 400 });
      let sent = 0;
      for (const userId of ids)
        for (const ws of this.ctx.getWebSockets(userId)) {
          try {
            ws.send(GIFT_PING);
            sent += 1;
          } catch {
            // 切れている：次に開いた時に郵便受けで受け取る
          }
        }
      return Response.json({ sent });
    }
    return new Response('not found', { status: 404 });
  }

  /** 端末からは何も受け取らない（送ってきても無視） */
  async webSocketMessage(): Promise<void> {}

  async webSocketClose(ws: WebSocket, code: number): Promise<void> {
    try {
      ws.close(code === 1005 ? 1000 : code, 'bye');
    } catch {
      // もう閉じている
    }
  }
}
