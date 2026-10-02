/** 後で実装する機能の切り替え（SPEC §13-1） */
export const features = {
  story: false, // ストーリーモード
  gacha: false, // カードガチャ
  coins: false, // おてあげコイン表示
  collection: true, // 所持枚数の制限（v2.0-B で true。false にすると全カード無制限）
};
