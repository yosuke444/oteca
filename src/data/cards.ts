import raw from './cards.json';
import type { CardDb, CardDef, Effect, Move, NoteColor, Rarity, Timing, Zone } from '../engine/types';

/**
 * カードデータの読み込みと形のチェック（SPEC §5-2）
 * カードの数値は cards.json にだけ書く。ここでは形が正しいかだけを調べる。
 */

export type CardData = { version: number; cards: CardDef[] };

const EFFECT_TYPES = ['damage', 'heal', 'addAttack', 'overrideAttack', 'setHp', 'scheduled', 'selfDamage'];
const TIMINGS: Timing[] = ['selfTurnStart', 'selfTurnEnd', 'opponentTurnStart', 'opponentTurnEnd'];
const RARITIES: Rarity[] = ['normal', 'super'];
const ZONES: Zone[] = ['active', 'bench'];
const NOTE_COLORS: NoteColor[] = ['yellow', 'green', 'red', 'purple', 'blue'];

/** 形が正しくなければ、どのカードのどこが悪いかを書いたエラーを投げる */
export function parseCardData(data: unknown): CardData {
  const d = data as { version?: unknown; cards?: unknown };
  check(typeof d?.version === 'number', 'version がありません');
  check(Array.isArray(d.cards), 'cards が配列ではありません');
  const nos = new Set<number>();
  const ids = new Set<string>();
  for (const c of d.cards as Record<string, unknown>[]) {
    const where = `カード ${String(c?.no ?? '?')}`;
    check(Number.isInteger(c.no) && (c.no as number) > 0, `${where}: no が正の整数ではありません`);
    check(!nos.has(c.no as number), `${where}: no が重複しています`);
    nos.add(c.no as number);
    check(typeof c.id === 'string' && !ids.has(c.id), `${where}: id が無いか重複しています`);
    ids.add(c.id as string);
    check(typeof c.name === 'string', `${where}: name がありません`);
    if (c.kind === 'otege') {
      check(RARITIES.includes(c.rarity as Rarity), `${where}: rarity が不正です`);
      check(Number.isInteger(c.hp) && (c.hp as number) > 0, `${where}: hp が不正です`);
      check(Array.isArray(c.moves) && c.moves.length > 0, `${where}: moves がありません`);
      for (const m of c.moves as Move[]) {
        check(Array.isArray(m.faces) && m.faces.every((f) => Number.isInteger(f)), `${where}: faces が不正です`);
        checkEffects(m.effects, where);
      }
    } else if (c.kind === 'item') {
      const t = c.target as { side?: unknown; zones?: unknown; rarity?: unknown };
      check(t?.side === 'self', `${where}: target.side が不正です`);
      check(Array.isArray(t.zones) && t.zones.every((z) => ZONES.includes(z)), `${where}: target.zones が不正です`);
      check(Array.isArray(t.rarity) && t.rarity.every((r) => RARITIES.includes(r)), `${where}: target.rarity が不正です`);
      check(c.color === undefined || NOTE_COLORS.includes(c.color as NoteColor), `${where}: color が不正です`);
      check(c.useCondition === undefined || c.useCondition === 'notFullHp', `${where}: useCondition が不正です`);
      const blocked = c.blockedIfUsedThisTurn;
      check(blocked === undefined || (Array.isArray(blocked) && blocked.every((b) => typeof b === 'string')), `${where}: blockedIfUsedThisTurn が不正です`);
      check(c.afterUseNote === undefined || typeof c.afterUseNote === 'string', `${where}: afterUseNote が不正です`);
      checkEffects(c.effects, where);
    } else {
      check(false, `${where}: kind が不正です`);
    }
  }
  const all = d.cards as Record<string, unknown>[];
  for (const c of all) {
    for (const id of (c.blockedIfUsedThisTurn as string[] | undefined) ?? []) {
      check(all.some((x) => x.id === id && x.kind === 'item'), `カード ${String(c.no)}: blockedIfUsedThisTurn の ${id} は アイテムの id ではありません`);
    }
  }
  return d as CardData;
}

function checkEffects(effects: unknown, where: string): void {
  check(Array.isArray(effects), `${where}: effects が配列ではありません`);
  for (const e of effects as Effect[]) {
    check(EFFECT_TYPES.includes(e?.type), `${where}: 効果タイプ ${String(e?.type)} は未対応です`);
    if (e.type === 'scheduled') {
      check(TIMINGS.includes(e.timing), `${where}: timing が不正です`);
      checkEffects([e.effect], where);
    }
  }
}

function check(ok: boolean, message: string): asserts ok {
  if (!ok) throw new Error(`cards.json: ${message}`);
}

export const CARD_DATA: CardData = parseCardData(raw);

/** No 順のカード一覧 */
export const CARD_LIST: readonly CardDef[] = [...CARD_DATA.cards].sort((a, b) => a.no - b.no);

/** カードNo → 定義 */
export const CARD_DB: CardDb = Object.fromEntries(CARD_LIST.map((c) => [c.no, c]));

const BY_ID = new Map(CARD_LIST.map((c) => [c.id, c]));

export function cardByNo(no: number): CardDef | undefined {
  return CARD_DB[no];
}

export function cardById(id: string): CardDef | undefined {
  return BY_ID.get(id);
}
