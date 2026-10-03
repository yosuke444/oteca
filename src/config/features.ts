/** 後で実装する機能の切り替え（SPEC §13-1） */
export const features = {
  story: true, // ストーリーモード（v2.0-F で true）
  gacha: true, // パックガチャ（v2.0-E で true）
  trade: true, // カードトレード（v2.0-H で true）
  ranking: false, // レートランキング（UPDATE_v2 I。今回は作らない）
  coins: true, // おてあげコイン表示（v2.0-D で true）
  daily: true, // デイリーミッション（v2.1-M で true）
  collection: true, // 所持枚数の制限（v2.0-B で true。false にすると全カード無制限）
};
