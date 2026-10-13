/**
 * オンライン対戦の「部屋に入ってから対戦の最初の画面が出るまで」の時刻の記録（v2.7。時間を測るためだけ）。
 * globalThis.__otecaStartLog が配列の時だけ書く（?debug=1 の画面で scripts/measure-online-start.mjs が用意する）。
 * ふだんは何もしない。通信にもゲームの結果にも関係しない
 */
type StartMark = { name: string; at: number };

export function markStart(name: string): void {
  const log = (globalThis as { __otecaStartLog?: StartMark[] }).__otecaStartLog;
  if (Array.isArray(log)) log.push({ name, at: Date.now() });
}
