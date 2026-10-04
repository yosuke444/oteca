import { apiBase } from '../config/api';
import type { SaveData } from '../save/saveData';
import { TROPHIES_MAX, normalizeTrophies } from '../save/saveData';

/**
 * トロフィーの郵便受け（v2.0-J。SPEC §7 S20）。起動した時と、メニューにいる間10分おきに確かめる。
 * 届いていたらセーブに入れ、サーバーに受け取ったと知らせる（知らせられなくても、次に確かめた時に同じ番号は足さない）。
 */

/** メニューにいる間、確かめる間隔 */
export const MAILBOX_EVERY_MS = 10 * 60 * 1000;
const TIMEOUT_MS = 8000;

type Update = (fn: (d: SaveData) => void) => void;

/** 受け取ったトロフィー（演出を出すまで待っているもの） */
const arrived: number[] = [];
const listeners = new Set<() => void>();

/** 演出を待っているトロフィーの番号 */
export function arrivedTrophies(): number[] {
  return [...arrived];
}

/** 演出を出した */
export function clearArrived(): void {
  arrived.length = 0;
  for (const fn of listeners) fn();
}

export function onArrived(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

async function call(path: string, init?: RequestInit): Promise<Response | null> {
  const base = apiBase();
  if (!base) return null;
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    return await fetch(`${base}${path}`, { ...init, signal: ctl.signal });
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

let checking = false;
/** 最後に確かめた時刻（メニューに戻るたびに確かめないように。10分おき） */
let lastChecked = 0;
/** 時計のずれで1回飛ばさないための余裕 */
const SLACK_MS = 30 * 1000;

/** テスト用：最後に確かめた時刻を忘れる */
export function forgetMailbox(): void {
  lastChecked = 0;
}

/**
 * 郵便受けを確かめる（登録できている時だけ）
 * @returns 新しく受け取った番号
 */
export async function checkMailbox(save: SaveData, update: Update, now = Date.now()): Promise<number[]> {
  if (checking || !save.userIdRegistered || !save.ranking.token) return [];
  if (lastChecked && now - lastChecked < MAILBOX_EVERY_MS - SLACK_MS) return [];
  checking = true;
  lastChecked = now;
  try {
    const res = await call(`/mailbox?userId=${save.userId}&token=${save.ranking.token}`);
    if (!res?.ok) return [];
    const body = (await res.json().catch(() => null)) as { trophies?: { number: number }[] } | null;
    const have = new Set(save.trophies.map((t) => t.number));
    const got = [...new Set((body?.trophies ?? []).map((t) => t.number))].filter((n) => Number.isInteger(n) && n >= 1);
    // セーブに入るのは TROPHIES_MAX（100）個まで。入らない分は受け取らない（郵便受けに残し、知らせない）
    const fresh = got.filter((n) => !have.has(n)).slice(0, Math.max(0, TROPHIES_MAX - have.size));
    const taken = got.filter((n) => have.has(n) || fresh.includes(n));
    if (fresh.length) {
      update((d) => {
        d.trophies = normalizeTrophies([...d.trophies, ...fresh.map((number) => ({ number, receivedAt: now }))]);
      });
      arrived.push(...fresh);
      for (const fn of listeners) fn();
    }
    // 受け取ったと知らせる（前に知らせられなかった分も）
    if (taken.length)
      await call('/mailbox/ack', {
        method: 'POST',
        body: JSON.stringify({ userId: save.userId, token: save.ranking.token, numbers: taken }),
        headers: { 'content-type': 'text/plain;charset=UTF-8' },
      });
    return fresh;
  } finally {
    checking = false;
  }
}
