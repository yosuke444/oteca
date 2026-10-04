/**
 * ユーザーID（v2.0-J。SPEC §11-9・§12-3f）：変えられない15桁の数字（先頭は0以外）。
 * セーブに1回だけ作る。表示は「12345-67890-12345」のように5桁ずつ区切る。
 */

/** ユーザーID の桁数 */
export const USER_ID_DIGITS = 15;
/** いちばん小さい・大きいユーザーID */
const MIN = 10 ** (USER_ID_DIGITS - 1);
const MAX = 10 ** USER_ID_DIGITS - 1;

export const USER_ID_PATTERN = /^[1-9]\d{14}$/;

export function isUserId(v: unknown): v is string {
  return typeof v === 'string' && USER_ID_PATTERN.test(v);
}

/** 正しいユーザーID ならそのまま、そうでなければ '' */
export function normalizeUserId(v: unknown): string {
  return isUserId(v) ? v : '';
}

/**
 * 新しいユーザーID（ランダム。先頭は0以外）
 * @param randomBytes 乱数（テストで差し替える）
 */
export function newUserId(randomBytes: (n: number) => Uint8Array = cryptoBytes): string {
  // 7バイト（56ビット）の乱数を、9×10^14 通りに割り当てる（偏りは無視できるほど小さい）
  const b = randomBytes(7);
  let n = 0;
  for (const x of b) n = n * 256 + x;
  return String(MIN + (n % (MAX - MIN + 1)));
}

function cryptoBytes(n: number): Uint8Array {
  const b = new Uint8Array(n);
  crypto.getRandomValues(b);
  return b;
}

/** 5桁ずつ区切る（12345-67890-12345）。ユーザーID でなければそのまま */
export function formatUserId(id: string): string {
  return isUserId(id) ? `${id.slice(0, 5)}-${id.slice(5, 10)}-${id.slice(10)}` : id;
}

/** 入力されたユーザーID（区切り・空白・全角の数字をふくむ）→ 15桁（形が違えば ''） */
export function parseUserIdInput(text: string): string {
  const digits = text.normalize('NFKC').replace(/[\s\-‐－ー_]/g, '');
  return normalizeUserId(digits);
}

/** バイト列の8バイトの場所に入れる形（16桁の16進数。'' は ''） */
export function userIdToHex(id: string): string {
  return isUserId(id) ? Number(id).toString(16).padStart(16, '0') : '';
}

/** 8バイトの場所から読んだ16進数 → ユーザーID（'' は ''。範囲外はエラー） */
export function hexToUserId(hex: string): string {
  if (!hex) return '';
  const n = parseInt(hex, 16);
  if (!Number.isSafeInteger(n) || n < MIN || n > MAX) throw new Error('ユーザーID の値が不正です');
  return String(n);
}

/** サーバーの合言葉（token。16バイトの16進数）。端末が作り、サーバーにはハッシュだけを覚えてもらう（v2.0-J） */
export function newToken(randomBytes: (n: number) => Uint8Array = cryptoBytes): string {
  return [...randomBytes(16)].map((x) => x.toString(16).padStart(2, '0')).join('');
}
