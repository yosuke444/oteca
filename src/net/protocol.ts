import type { Action, Side } from '../engine/types';

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

/** レート対戦の待合所（v2.0-G。版数を入れて、古いページの人と混ざらないように） */
export function rateLobbyName(protocol: number): string {
  return `oteca-rate-p${protocol}`;
}

/** レート対戦で組んだ2人だけの部屋 */
export function rateRoomName(roomId: string): string {
  return `oteca-rate-${roomId}`;
}

/** カードトレードの部屋（v2.0-H。対戦の部屋とは別の名前なので、同じ番号でもぶつからない） */
export function tradeRoomName(roomNumber: string): string {
  return `oteca-trade-${roomNumber}`;
}

/** 部屋の人の状態（v2.0-G）：まちあい／たいせんちゅう */
export type MemberState = 'waiting' | 'playing';

/** 部屋番号は 4〜8桁の数字（SPEC §17-20） */
export function isValidRoomNumber(s: string): boolean {
  return /^[0-9]{4,8}$/.test(s);
}

/** 入室チケット：早い2人が対戦者（SPEC §11-2） */
export type Ticket = { time: number; rand: number };

/** 通信で送る操作（誰の操作かは送らず、受け取った側が送り主の役割を入れる） */
export type WireAction = Action extends infer A ? (A extends { player: unknown } ? Omit<A, 'player'> : never) : never;

export type MsgBody = {
  /** state 以降は v2.0-G で追加（部屋の まちあい。rate はレート対戦の時だけ） */
  hello: { protocol: number; appVersion: string; name: string; ticket: Ticket; playerId: string; state?: MemberState; deckName?: string; nextGame?: number; rate?: number };
  full: Record<string, never>;
  /** 自分の状態が変わった（部屋全体へ。v2.0-G） */
  presence: { state: MemberState; deckName: string; nextGame: number };
  /** 「あそぼう！」の申し込み（v2.0-G） */
  invite: { to: string; id: string };
  inviteReply: { to: string; id: string; accept: boolean };
  /** 申し込みの取り消し・時間切れ */
  inviteCancel: { to: string; id: string };
  /** 組み合わせが決まった（部屋全体へ。a が申し込んだ人） */
  pairStart: { a: string; b: string; pairId: string; game: number };
  /** 「ほかの ひとと あそぶ」（相手へ） */
  back: Record<string, never>;
  /** レートの待合所：待っている（2秒ごと） */
  queue: { playerId: string; ticket: Ticket; lastOpponentId: string; name: string; rate: number };
  /** レートの待合所：組み合わせの申し込みと返事 */
  pairPropose: { to: string; roomId: string };
  pairAccept: { to: string; roomId: string; accept: boolean };
  /** カードトレード（v2.0-H）：入室（pending＝とちゅうの交換ID、done＝処理済みの交換ID） */
  tradeHello: { protocol: number; appVersion: string; name: string; ticket: Ticket; playerId: string; pending: string; done: string[] };
  /** あげるカード（カードNo → 枚数） */
  tradeOffer: { offer: Record<number, number> };
  /** これで OK（hash が空なら取り消し） */
  tradeLock: { hash: string };
  /** 最終確認の「こうかんする」 */
  tradeCommit: { hash: string; tradeId: string };
  /** 交換を保存した */
  tradeAck: { tradeId: string };
  /** （予約） */
  tradeResume: { tradeId: string };
  /** game は何試合目か（再戦で +1）。古い試合のメッセージを取り違えないため */
  deck: { cards: number[]; commit: string; game: number };
  reveal: { seed: string; game: number };
  action: { seq: number; action: WireAction; game: number };
  /**
   * mismatch は追加：ずれに気づいた側が相手にも知らせる（両方で中断するため）
   * winner は追加：決着した時に「どちらの勝ちになったか」を送り合う（そろった時だけ勝敗を記録する）
   */
  hash: { turn: number; hash: string; game: number; mismatch?: boolean; winner?: Side };
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
