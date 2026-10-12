import type { GameState, Lasting, Side } from '../../engine/types';

/**
 * 持続効果の表・山札の札の並べ方（v2.5。画面の部品 LastingMarks.tsx から使う。テストでも確かめる）
 */

/** 表に出すのは3ターン先まで */
export const LASTING_ROWS = 3;
/** 表の幅（舞台の px。ベンチとバトル場の間に入る） */
export const TABLE_W = 150;
/** 札の大きさ：ふつう／小さくしてもここまで（844×390 でも数字が読める） */
export const TAG_MAX = 44;
export const TAG_MIN = 31;
const GAP = 4;
const MORE_W = 38;

/** 1つの行の札の大きさと、見せる数（入りきらなければ、残りは「+2」の札） */
export function rowFit(n: number, width = TABLE_W): { size: number; shown: number } {
  if (n <= 0) return { size: TAG_MAX, shown: 0 };
  const fit = Math.floor((width - (n - 1) * GAP) / n);
  if (fit >= TAG_MIN) return { size: Math.min(TAG_MAX, fit), shown: n };
  const shown = Math.max(1, Math.floor((width - MORE_W) / (TAG_MIN + GAP)));
  return { size: TAG_MIN, shown: Math.min(shown, n - 1) };
}

/**
 * バトル場のおてあげに付いた持続効果（持続ダメージ・持続回復・ばくだん）を、行（何ターン後）ごとに分ける。
 * rows[0] が1行目（次に来る持ち主のターンの終わり）。3ターンより先は出さない。同じ行の中は古いものが左
 */
export function lastingRows(view: GameState, uid: string | null): Lasting[][] {
  const rows: Lasting[][] = Array.from({ length: LASTING_ROWS }, () => []);
  if (!uid) return rows;
  for (const l of view.lasting) {
    if (l.targetUid !== uid || l.kind === 'draw') continue;
    if (l.turns < 1 || l.turns > LASTING_ROWS) continue;
    rows[l.turns - 1].push(l);
  }
  for (const r of rows) r.sort((a, b) => a.seq - b.seq);
  return rows;
}

/** 山札の上に出す遅延ドロー（プレイヤーに付く）。古いものが左。3ターン先までの制限は無い */
export function drawTags(view: GameState, side: Side): Lasting[] {
  return view.lasting.filter((l) => l.kind === 'draw' && l.targetUid === null && l.holder === side).sort((a, b) => a.seq - b.seq);
}

/** ベンチのおてあげに付いたばくだん */
export function benchBombs(view: GameState, uid: string): Lasting[] {
  return view.lasting.filter((l) => l.targetUid === uid && l.kind === 'faint').sort((a, b) => a.turns - b.turns || a.seq - b.seq);
}
