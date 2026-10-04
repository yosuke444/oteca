// 重いテスト（npm run test:slow）：ストーリーの各ステージと50試合ずつ自動対戦して、勝率の表を作る（SPEC §16 F06・UPDATE_v2 §7）。
// 表は STORY_WINRATES.md に書き出す（数値は変えない。極端に勝てないステージは報告だけ）。
import { writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { CpuLevel } from '../src/cpu/brains';
import { seededRand } from '../src/cpu/random';
import { selfPlay } from '../src/cpu/selfPlay';
import { CARD_DB, cardById } from '../src/data/cards';
import { starterCollection, starterDeckNos } from '../src/data/starterDeck';
import { validateDeck } from '../src/engine';
import type { CardDef, Side } from '../src/engine/types';
import { drawOffer, offerById, packById } from '../src/gacha/gacha';
import { ENEMY, PLAYER, STORY, stageDeckNos, stageLevel, stageRules } from '../src/story/story';

const GAMES = 50;

/** おてあげの強さの見積もり（HP と、1回の攻撃のダメージの平均。回復は半分に数える） */
function otegeScore(def: CardDef): number {
  if (def.kind !== 'otege') return 0;
  let dmg = 0;
  for (const m of def.moves) {
    let v = 0;
    for (const e of m.effects) {
      if (e.type === 'damage') v += e.amount;
      if (e.type === 'heal') v += e.amount / 2;
    }
    dmg += (v * m.faces.length) / 6;
  }
  return def.hp / 3 + dmg;
}

/** アイテムの選ぶ順（ふつうの人がよく入れる順） */
const ITEM_ORDER = ['kusuri', 'himitsu_yaiba', 'supodori', 'kimyou_drink', 'hikikae', 'yabaitsubo'];

/**
 * 「元祖パックを15まい引いた」人のデッキ：初期カードに元祖パック15袋（種付き乱数）を足し、
 * スーパーは強いもの1枚、おてあげ11枚・アイテム4枚を、強さの見積もりの高い順に入れる
 */
function packDeck(): { deck: number[]; got: number[] } {
  const own: Record<number, number> = { ...starterCollection() };
  // 15まい（v2.2：最後の袋はスーパー確定）
  const got = drawOffer(packById('ganso')!, offerById('fifteen')!, seededRand(20261003)).map((b) => b.card.no);
  for (const n of got) own[n] = (own[n] ?? 0) + 1;
  const defs = Object.keys(own).map((n) => CARD_DB[Number(n)]);
  const otege = defs.filter((d) => d.kind === 'otege').sort((a, b) => otegeScore(b) - otegeScore(a));
  const deck: number[] = [];
  let supers = 0;
  for (const d of otege) {
    for (let i = 0; i < own[d.no] && deck.length < 11; i++) {
      if (d.kind === 'otege' && d.rarity === 'super') {
        if (supers >= 1) break;
        supers += 1;
      }
      deck.push(d.no);
    }
  }
  for (const id of ITEM_ORDER) {
    const no = cardById(id)!.no;
    for (let i = 0; i < (own[no] ?? 0) && deck.length < 15; i++) deck.push(no);
  }
  return { deck, got };
}

const names = (deck: number[]) => {
  const m = new Map<string, number>();
  for (const n of deck) m.set(CARD_DB[n].name, (m.get(CARD_DB[n].name) ?? 0) + 1);
  return [...m].map(([k, v]) => `${k}×${v}`).join('、');
};

describe('F06 ストーリーの勝率（各ステージ50試合）', () => {
  it('どの試合も止まらずに決着し、勝率の表を書き出す', () => {
    const starter = starterDeckNos();
    const pack = packDeck();
    expect(validateDeck(pack.deck, CARD_DB)).toEqual([]);
    const players: { label: string; deck: number[]; level: CpuLevel }[] = [
      { label: '初期デッキ・ふつう', deck: starter, level: 'normal' },
      { label: '初期デッキ・つよい', deck: starter, level: 'strong' },
      { label: 'パックのデッキ・ふつう', deck: pack.deck, level: 'normal' },
      { label: 'パックのデッキ・つよい', deck: pack.deck, level: 'strong' },
    ];
    const rows: string[] = [];
    const low: string[] = [];
    for (const st of STORY.stages) {
      const cells: string[] = [];
      for (const [pi, pl] of players.entries()) {
        let wins = 0;
        for (let k = 0; k < GAMES; k++) {
          const first: Side = k % 2 === 0 ? PLAYER : ENEMY;
          const r = selfPlay({
            levels: { [PLAYER]: pl.level, [ENEMY]: stageLevel(st) } as Record<Side, CpuLevel>,
            decks: { [PLAYER]: pl.deck, [ENEMY]: stageDeckNos(st) } as Record<Side, number[]>,
            cardDb: CARD_DB,
            seed: `story-${st.no}-${pl.label}-${k}`,
            first,
            rand: seededRand(st.no * 1000 + k * 7 + pi * 100003),
            rules: stageRules(st),
          });
          expect(r.state.phase, `ステージ ${st.no} ${pl.label} ${k}`).toBe('over');
          if (r.winner === PLAYER) wins += 1;
        }
        const rate = Math.round((wins / GAMES) * 100);
        if (rate <= 10) low.push(`ステージ ${st.no}（${st.name}）× ${pl.label}：${rate}%`);
        cells.push(`${rate}%`);
      }
      rows.push(`| ${st.no} | ${st.kind === 'boss' ? 'ボス' : '雑魚'} | ${st.name} | ${stageLevel(st) === 'strong' ? 'つよい' : 'ふつう'} | ${cells.join(' | ')} |`);
    }
    const md = [
      '# ストーリー各ステージの勝率（自動対戦）',
      '',
      `各ステージの敵と ${GAMES} 試合ずつ（先攻・後攻は半分ずつ）。自分の側も CPU（ふつう・つよい）が操作した。ボスルールあり。`,
      '`npm run test:slow`（tests/story.slow.test.ts）で作り直せる。カードやデッキの数値は変えていない。',
      '',
      `- 初期デッキ：${names(starter)}`,
      `- パックのデッキ（初期カード ＋ 元祖パック15袋。引いたのは ${pack.got.length}枚）：${names(pack.deck)}`,
      '',
      `| ステージ | 種類 | 敵 | 敵の強さ | ${players.map((p) => p.label).join(' | ')} |`,
      `|---|---|---|---|${players.map(() => '---').join('|')}|`,
      ...rows,
      '',
      low.length ? `**勝率10%以下（極端に勝てない）**\n\n${low.map((l) => `- ${l}`).join('\n')}` : '勝率10%以下の組み合わせは無し。',
      '',
    ].join('\n');
    writeFileSync('STORY_WINRATES.md', md);
    console.log(md);
  });
});
