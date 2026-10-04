import raw from './cards.json';
import type { CardDb, CardDef, Effect, Move, NoteColor, Rarity, Timing, Zone } from '../engine/types';

/**
 * カードデータの読み込みと形のチェック（SPEC §5-2）
 * カードの数値は cards.json にだけ書く。ここでは形が正しいかだけを調べる。
 */

/**
 * トロフィーのカード（v2.0-J。SPEC §7 S20）：管理者が送る1枚だけのカード。性能は copyOf のカードと同じ。
 * カードNo は noBase＋番号（1〜numberMax）。名前・id の {n} に番号が入る
 */
export type TrophySpec = { copyOf: string; noBase: number; numberMax: number; name: string; id: string; image: string };

export type CardData = { version: number; cards: CardDef[]; trophy: TrophySpec };

const EFFECT_TYPES = [
  'damage',
  'heal',
  'selfDamage',
  'draw',
  'discard',
  'switchWithBench',
  'faintLater',
  'search',
  'addAttack',
  'overrideAttack',
  'setHp',
  'scheduled',
];
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
      // target を書かないアイテムは、おてあげに使わない（v2.0）
      if (c.target !== undefined) {
        const t = c.target as { side?: unknown; zones?: unknown; rarity?: unknown };
        check(t?.side === 'self', `${where}: target.side が不正です`);
        check(Array.isArray(t.zones) && t.zones.every((z) => ZONES.includes(z)), `${where}: target.zones が不正です`);
        check(Array.isArray(t.rarity) && t.rarity.every((r) => RARITIES.includes(r)), `${where}: target.rarity が不正です`);
      }
      check(c.color === undefined || NOTE_COLORS.includes(c.color as NoteColor), `${where}: color が不正です`);
      check(c.useCondition === undefined || c.useCondition === 'notFullHp' || c.useCondition === 'deckNotEmpty', `${where}: useCondition が不正です`);
      check(c.useCondition !== 'notFullHp' || c.target !== undefined, `${where}: notFullHp は target のあるアイテムだけ`);
      check(c.minHand === undefined || (Number.isInteger(c.minHand) && (c.minHand as number) >= 1), `${where}: minHand が不正です`);
      const blocked = c.blockedIfUsedThisTurn;
      check(blocked === undefined || (Array.isArray(blocked) && blocked.every((b) => typeof b === 'string')), `${where}: blockedIfUsedThisTurn が不正です`);
      check(c.afterUseNote === undefined || isLocalText(c.afterUseNote), `${where}: afterUseNote が不正です（hira と kanji の2つが必要）`);
      check(isLocalText(c.text), `${where}: text が不正です（hira と kanji の2つが必要）`);
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
  const tr = (d as { trophy?: Record<string, unknown> }).trophy;
  check(!!tr && typeof tr === 'object', 'trophy がありません');
  check(all.some((c) => c.id === tr!.copyOf && c.kind === 'otege'), 'trophy.copyOf は おてあげ の id にしてください');
  check(Number.isInteger(tr!.noBase) && Number.isInteger(tr!.numberMax), 'trophy の noBase・numberMax が不正です');
  check((tr!.noBase as number) + (tr!.numberMax as number) <= 65535, 'trophy のカードNo がセーブに入る範囲（65535 まで）を超えます');
  check(all.every((c) => (c.no as number) <= (tr!.noBase as number)), 'trophy の noBase より大きい No のカードがあります');
  check(typeof tr!.name === 'string' && (tr!.name as string).includes('{n}') && typeof tr!.id === 'string' && typeof tr!.image === 'string', 'trophy の name・id・image が不正です');
  return d as CardData;
}

/** にほんご・日本語の2つの文があるか */
function isLocalText(v: unknown): boolean {
  const t = v as { hira?: unknown; kanji?: unknown };
  return typeof t === 'object' && t !== null && typeof t.hira === 'string' && t.hira !== '' && typeof t.kanji === 'string' && t.kanji !== '';
}

function checkEffects(effects: unknown, where: string): void {
  check(Array.isArray(effects), `${where}: effects が配列ではありません`);
  const count = (v: unknown) => Number.isInteger(v) && (v as number) >= 0;
  /** 持続効果（+ の後ろ）：0以上の整数の配列 */
  const then = (v: unknown) => v === undefined || (Array.isArray(v) && v.length > 0 && v.every(count));
  for (const e of effects as Effect[]) {
    check(EFFECT_TYPES.includes(e?.type), `${where}: 効果タイプ ${String(e?.type)} は未対応です`);
    switch (e.type) {
      case 'damage':
      case 'heal':
      case 'selfDamage':
        check(count(e.amount) && then(e.then), `${where}: ${e.type} の amount・then が不正です`);
        break;
      case 'draw':
        check(count(e.count) && then(e.then), `${where}: draw の count・then が不正です`);
        break;
      case 'discard':
      case 'search':
        check(count(e.count) && e.count >= 1, `${where}: ${e.type} の count が不正です`);
        break;
      case 'faintLater':
        check(Number.isInteger(e.after) && e.after >= 1, `${where}: faintLater の after が不正です`);
        break;
      case 'scheduled':
        check(TIMINGS.includes(e.timing), `${where}: timing が不正です`);
        checkEffects([e.effect], where);
        break;
      default:
        break;
    }
  }
}

function check(ok: boolean, message: string): asserts ok {
  if (!ok) throw new Error(`cards.json: ${message}`);
}

export const CARD_DATA: CardData = parseCardData(raw);

/** No 順のカード一覧 */
export const CARD_LIST: readonly CardDef[] = [...CARD_DATA.cards].sort((a, b) => a.no - b.no);

const BASE_DB: CardDb = Object.fromEntries(CARD_LIST.map((c) => [c.no, c]));

/** トロフィーのカードの決まり */
export const TROPHY = CARD_DATA.trophy;

/** トロフィーの番号 → カードNo */
export function trophyCardNo(n: number): number {
  return TROPHY.noBase + n;
}

/** カードNo → トロフィーの番号（トロフィーでなければ null） */
export function trophyNumberOf(no: number): number | null {
  const n = no - TROPHY.noBase;
  return Number.isInteger(no) && n >= 1 && n <= TROPHY.numberMax ? n : null;
}

export function isTrophyNo(no: number): boolean {
  return trophyNumberOf(no) !== null;
}

const trophyCache = new Map<number, CardDef>();

/** トロフィーのカードの定義（性能は copyOf と同じ。名前は「トロフィあげ（番号）」） */
export function trophyDef(n: number): CardDef {
  let d = trophyCache.get(n);
  if (!d) {
    const base = CARD_LIST.find((c) => c.id === TROPHY.copyOf)!;
    d = { ...structuredClone(base), no: trophyCardNo(n), id: TROPHY.id.replace('{n}', String(n)), name: TROPHY.name.replace('{n}', String(n)), image: TROPHY.image, trophy: n } as CardDef;
    trophyCache.set(n, d);
  }
  return d;
}

/**
 * カードNo → 定義。トロフィーのカード（noBase＋番号）は、聞かれた時に作る（エンジン・デッキの確かめでもふつうのカードと同じに使える）
 */
export const CARD_DB: CardDb = new Proxy(BASE_DB, {
  get(target, key) {
    if (typeof key === 'string' && /^[0-9]+$/.test(key)) {
      const no = Number(key);
      if (target[no]) return target[no];
      const n = trophyNumberOf(no);
      return n === null ? undefined : trophyDef(n);
    }
    return Reflect.get(target, key);
  },
  has(target, key) {
    if (typeof key === 'string' && /^[0-9]+$/.test(key) && trophyNumberOf(Number(key)) !== null) return true;
    return Reflect.has(target, key);
  },
});

const BY_ID = new Map(CARD_LIST.map((c) => [c.id, c]));

export function cardByNo(no: number): CardDef | undefined {
  return CARD_DB[no];
}

export function cardById(id: string): CardDef | undefined {
  return BY_ID.get(id);
}
