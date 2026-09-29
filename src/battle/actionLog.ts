import { appVersion, protocolVersion } from '../config/version';
import type { Action } from '../engine/types';
import type { BattleSetup } from './setup';

/**
 * 行動ログ（SPEC §7 S99「行動ログをJSONで保存」、§11-6 ズレ検知時のダウンロード）
 * 種・デッキ・操作の列があれば、エンジンで試合を最初から再現できる。
 */
export type ActionLogFile = {
  format: 'oteca-action-log';
  appVersion: string;
  protocol: number;
  savedAt: string;
  mode: BattleSetup['mode'];
  seed: string;
  decks: BattleSetup['decks'];
  names: BattleSetup['names'];
  fixedDie: number | null;
  stackTop: BattleSetup['stackTop'] | null;
  actions: Action[];
  /** 最後の状態ハッシュ（再現した結果と比べる用） */
  finalHash: string;
  /** そのほかの情報（ズレ検知の時の、相手から届いたハッシュなど） */
  extra?: Record<string, unknown>;
};

export function buildActionLog(setup: BattleSetup, actions: readonly Action[], finalHash: string, extra?: Record<string, unknown>): ActionLogFile {
  return {
    format: 'oteca-action-log',
    appVersion,
    protocol: protocolVersion,
    savedAt: new Date().toISOString(),
    mode: setup.mode,
    seed: setup.seed,
    decks: setup.decks,
    names: setup.names,
    fixedDie: setup.fixedDie ?? null,
    stackTop: setup.stackTop ?? null,
    actions: [...actions],
    finalHash,
    ...(extra ? { extra } : {}),
  };
}

/** JSON ファイルとしてダウンロードさせる */
export function downloadActionLog(log: ActionLogFile): void {
  const blob = new Blob([JSON.stringify(log, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const stamp = log.savedAt.replace(/[-:]/g, '').replace(/\..*$/, '').replace('T', '-');
  a.href = url;
  a.download = `oteca-log-${stamp}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
