/**
 * パックガチャの演出の粒（キラキラ・紙吹雪・星くず）の数（SPEC §7 S09）。画面に関係しない数だけ。
 */

/** 粒は 3つを1つにまとめる（v2.3。1つを大きく・明るくして、華やかさは保つ） */
export const MERGE = 3;
/** まとめた粒の大きさの倍率 */
export const BIG = 1.5;
/** スーパーレアの星くずの量（v2.3：今の6割） */
export const STAR_DUST = 0.6;
/**
 * 光らない袋の星くずの量（v2.4：通常のカードが出た時を1.5倍。まとめた後の粒で 袋の口 13 → 20 個、めくる時 8 → 12 個）。
 * 光らない袋は、めくるまで中身が分からないように、サプライズ（光らない袋のスーパー）も同じ数
 */
export const NORMAL_DUST = 1.5;
/** 袋を破った時に口から噴き出す星くずの元の数（まとめる前）。光った袋と光らない袋 */
export const FOUNTAIN_DUST = { glowing: 120, plain: 40 * NORMAL_DUST };
/** めくる時の星くずの元の数（まとめる前）。光った袋（スーパーと、光ったのにノーマル）と光らない袋 */
export const FLIP_DUST = { glowing: 72, plain: 24 * NORMAL_DUST };

/** 粒をまとめた数（3つを1つ。lavish：サプライズは3倍。演出をへらす時は さらに 1/4。少なくとも1つ） */
export function mergedCount(x: number, reduce: boolean, lavish = 1): number {
  return Math.max(1, Math.round((x * lavish * (reduce ? 0.25 : 1)) / MERGE));
}
