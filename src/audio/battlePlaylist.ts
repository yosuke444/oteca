/**
 * 戦闘曲の順番（SPEC §10-2「戦闘曲の流し方」）
 * - シャッフル方式：全曲が一巡するまで同じ曲は流さない
 * - 一巡の切れ目でも、直前の曲を次の一巡の最初にしない
 * - 最初の曲も「前回（再戦・読み込み直しの前）に流れた曲」とは違う曲にする
 * - 1曲だけならその曲をくり返す。0曲なら null（無音）
 * 乱数は外から渡す（テストで順番を固定するため）。
 */

/** 0 以上 1 未満の乱数 */
export type Rand = () => number;

/** 0〜n-1 を並べかえた一巡。avoid（直前の曲）は最初にしない（2曲以上の時） */
export function shuffleRound(n: number, avoid: number | null, rand: Rand): number[] {
  const order = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  if (n > 1 && order[0] === avoid) {
    // 最初の曲を、2番目以降のどれかと入れかえる
    const j = 1 + Math.floor(rand() * (n - 1));
    [order[0], order[j]] = [order[j], order[0]];
  }
  return order;
}

export class BattlePlaylist {
  private queue: number[] = [];
  private last: number | null;

  /** count：曲の数。last：前回流れた曲の番号（わからなければ null） */
  constructor(
    private readonly count: number,
    private readonly rand: Rand,
    last: number | null = null,
  ) {
    this.last = last !== null && last >= 0 && last < count ? last : null;
  }

  /** 次に流す曲の番号。曲が無ければ null */
  next(): number | null {
    if (this.count <= 0) return null;
    if (this.queue.length === 0) this.queue = shuffleRound(this.count, this.last, this.rand);
    const i = this.queue.shift()!;
    this.last = i;
    return i;
  }
}
