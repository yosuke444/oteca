import type { RouteId } from '../router';
import type { BgmKey } from './soundMap';

/**
 * 画面ごとの BGM（SPEC §10-2）。undefined の画面は、その画面が自分で決める。
 * 対戦は戦闘曲（battle フォルダの曲をシャッフル）。リザルトは止める（ジングルを聞かせるため）。
 * 同じ曲の画面どうし（例：設定 → パックガチャ）を移る時は、曲を最初から流し直さず続ける（audioManager.playBgm）
 */
export const ROUTE_BGM: Record<RouteId, BgmKey | null | undefined> = {
  title: 'bgm_title',
  menu: 'bgm_title',
  story: 'bgm_lobby', // ストーリーのステージ選択は 対戦待機と同じ曲（v2.3）
  gacha: 'bgm_deck', // パックガチャは 設定・デッキ編集と同じ曲（v2.3）
  tutorial: 'battle',
  name: 'bgm_title',
  lang: 'bgm_title',
  online: 'bgm_lobby',
  trade: 'bgm_deck', // カードトレードも 設定・デッキ編集と同じ曲（v2.3）
  ranking: 'bgm_title',
  rate: 'bgm_lobby',
  admin: 'bgm_deck',
  spectate: 'bgm_lobby',
  debug: 'bgm_title',
  deck: 'bgm_deck',
  settings: 'bgm_deck',
  rules: 'bgm_deck',
  lobby: 'bgm_lobby',
  cpu: 'bgm_lobby',
  battle: 'battle',
  fxtest: undefined,
  result: null,
  soundtest: null,
  cardlab: 'bgm_deck',
};
