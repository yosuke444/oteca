/**
 * 管理者メニューのコード（v2.0-J。企画者の指示「管理者メニュー（チートコード）」・SPEC §7 S20）。
 * コードの言葉は辞書（i18n の admin.codeWords。どちらの表記でも同じ言葉）にあり、ここは機能の並びだけ。
 * 入力は全角・半角・空白・カタカナとひらがなの違いを無視して比べる。
 */
export const ADMIN_FNS = ['watch', 'trophy', 'suspend', 'unsuspend', 'search', 'log', 'ranking', 'cards'] as const;

export type AdminFn = (typeof ADMIN_FNS)[number];

/** コードの言葉（辞書から渡す） */
export type AdminCodeWords = Record<AdminFn, string>;

/** そろえる：NFKC・空白なし・カタカナ → ひらがな */
function fold(s: string): string {
  return s
    .normalize('NFKC')
    .replace(/\s+/g, '')
    .replace(/[\u30A1-\u30F6]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
}

/** 入れたコード → 機能（知らないコードは null） */
export function findAdminCode(input: string, words: AdminCodeWords): AdminFn | null {
  const f = fold(input);
  if (!f) return null;
  return ADMIN_FNS.find((fn) => fold(words[fn]) === f) ?? null;
}

/** 画面に出すコードの並び（つなげ方は辞書の codes に任せる） */
export function adminCodeList(words: AdminCodeWords): string[] {
  return ADMIN_FNS.map((fn) => words[fn]);
}
