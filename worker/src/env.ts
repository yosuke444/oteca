/** Worker の束縛（wrangler.toml） */
export type Env = {
  DB: D1Database;
  MATCHMAKER: DurableObjectNamespace;
  /** 管理キー（wrangler secret put ADMIN_KEY） */
  ADMIN_KEY?: string;
  /** 1 の時だけ、読み書きした行数をレスポンスのヘッダーに付ける（負荷の見積もり用。ローカルだけ） */
  METRICS?: string;
  /** 公開しているゲームの version.json（v2.7。受付係が今の版を知るため。wrangler.toml の vars） */
  GAME_VERSION_URL?: string;
};
