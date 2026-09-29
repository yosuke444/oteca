import type { Action } from '../engine/types';

/**
 * 通信メッセージ（SPEC §11-5）
 * すべて { t: 種類, v: プロトコル版数, body } の形。送るのは操作だけで、状態そのものは送らない（§11-3）。
 */

/** アプリID（SPEC §11-1） */
export const APP_ID = 'oteca-v1';

/** 部屋名 = oteca-room-<部屋番号> */
export function roomName(roomNumber: string): string {
  return `oteca-room-${roomNumber}`;
}

/** 部屋番号は 4〜8桁の数字（SPEC §17-20） */
export function isValidRoomNumber(s: string): boolean {
  return /^[0-9]{4,8}$/.test(s);
}

/** 入室チケット：早い2人が対戦者（SPEC §11-2） */
export type Ticket = { time: number; rand: number };

/** 通信で送る操作（誰の操作かは送らず、受け取った側が送り主の役割を入れる） */
export type WireAction = Action extends infer A ? (A extends { player: unknown } ? Omit<A, 'player'> : never) : never;

export type MsgBody = {
  hello: { protocol: number; appVersion: string; name: string; ticket: Ticket; playerId: string };
  full: Record<string, never>;
  /** game は何試合目か（再戦で +1）。古い試合のメッセージを取り違えないため */
  deck: { cards: number[]; commit: string; game: number };
  reveal: { seed: string; game: number };
  action: { seq: number; action: WireAction; game: number };
  hash: { turn: number; hash: string; game: number };
  stamp: { id: number };
  rematch: { game: number };
  leave: Record<string, never>;
  /** n は追加：自分が送った操作の数（相手が取りこぼしに気づけるように） */
  ping: { t: number; n?: number; game?: number };
  pong: { t: number; n?: number; game?: number };
  /** 追加：seq に飛びがあった時の再送要求（from 番以降を送り直して） */
  resend: { from: number; game: number };
};

export type MsgType = keyof MsgBody;

export type Msg = { [T in MsgType]: { t: T; v: number; body: MsgBody[T] } }[MsgType];

export function makeMsg<T extends MsgType>(t: T, v: number, body: MsgBody[T]): Extract<Msg, { t: T }> {
  return { t, v, body } as Extract<Msg, { t: T }>;
}

/** 受け取ったものが Msg の形か（壊れたデータ・古い版のデータを弾く） */
export function isMsg(x: unknown): x is Msg {
  if (!x || typeof x !== 'object') return false;
  const m = x as { t?: unknown; v?: unknown; body?: unknown };
  return typeof m.t === 'string' && typeof m.v === 'number' && !!m.body && typeof m.body === 'object';
}

export function toWire(a: Action): WireAction {
  const { player: _player, ...rest } = a;
  void _player;
  return rest as WireAction;
}

export function fromWire(w: WireAction, player: Action['player']): Action {
  return { ...w, player } as Action;
}
