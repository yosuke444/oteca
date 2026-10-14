// カードのバランスのデータ集め（v2.7。企画者の指示）。カードの数値は変えない。
//   npm run balance          … シミュレーション（tests-balance/。BALANCE=1）を動かしてから、まとめる（16コアの PC で 約10分）
//   npm run balance -- --summary … シミュレーションは動かさず、docs/balance/raw/ の結果から まとめ直す
// 結果：docs/balance/ の CSV（1_calc.csv・2_duel_matrix.csv・2_duel_rank.csv・3_deck.csv・summary.csv）と README.md（見やすい表）
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';

const DIR = 'docs/balance';
const RAW = `${DIR}/raw`;
const NL = String.fromCharCode(10);

if (!process.argv.includes('--summary')) {
  rmSync(RAW, { recursive: true, force: true });
  const r = spawnSync('npx', ['vitest', 'run', 'tests-balance'], { stdio: 'inherit', shell: true, env: { ...process.env, BALANCE: '1' } });
  if (r.status) process.exit(r.status);
}

const cards = JSON.parse(readFileSync('src/data/cards.json', 'utf8')).cards;
const byNo = new Map(cards.map((c) => [c.no, c]));
const limited = JSON.parse(readFileSync('src/data/packs.json', 'utf8')).limited;
const read = (n) => JSON.parse(readFileSync(`${RAW}/${n}.json`, 'utf8'));
const pct = (x, d = 1) => `${(x * 100).toFixed(d)}%`;
const sign = (x, d = 1) => `${x >= 0 ? '+' : ''}${(x * 100).toFixed(d)}`;
const f = (x, d = 1) => Number(x).toFixed(d);
// Excel で文字化けしないように、先頭に BOM を付ける
const csv = (rows) => String.fromCharCode(0xfeff) + rows.map((r) => r.map((v) => (typeof v === 'string' && /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)).join(',')).join(NL) + NL;
const kindOf = (c) => (c.kind === 'item' ? 'アイテム' : c.rarity === 'super' ? (limited.includes(c.id) ? 'スーパー（限定）' : 'スーパー') : '通常');
const group = (c) => (c.kind === 'item' ? 'item' : c.rarity === 'super' ? 'super' : 'normal');

// ---------------------------------------------------------------- 1
const p1 = read('part1');
const calcBy = new Map(p1.map((x) => [x.no, x]));
const order1 = [...p1].sort((a, b) => (a.rarity === b.rarity ? b.hpTimesDmgCap - a.hpTimesDmgCap : a.rarity === 'normal' ? -1 : 1));
writeFileSync(
  `${DIR}/1_calc.csv`,
  csv([
    ['No', '名前', '種類', 'HP', '平均ダメージ（今すぐ）', '平均ダメージ（あとから）', '平均ダメージ（合計）', '平均回復', '平均の自分へのダメージ', '平均ドロー', 'ばくだんの確率', 'HP×平均ダメージ', 'HP×平均ダメージ（1回100まで）', 'HP100を倒す平均ターン'],
    ...order1.map((x) => [x.no, x.name, kindOf(byNo.get(x.no)), x.hp, f(x.dmgNow, 2), f(x.dmgLater, 2), f(x.dmgTotal, 2), f(x.heal, 2), f(x.self, 2), f(x.draw, 2), f(x.bomb, 3), Math.round(x.hpTimesDmg), Math.round(x.hpTimesDmgCap), f(x.turnsToKo100, 2)]),
  ]),
);

// ---------------------------------------------------------------- 2
const p2 = read('part2');
const nos2 = p2.nos;
const avgRate = new Map(nos2.map((a) => [a, nos2.filter((b) => b !== a).reduce((t, b) => t + p2.rate[a][b], 0) / (nos2.length - 1)]));
writeFileSync(`${DIR}/2_duel_matrix.csv`, csv([['行が勝つ率（列が相手）', ...nos2.map((b) => byNo.get(b).name)], ...nos2.map((a) => [byNo.get(a).name, ...nos2.map((b) => f(p2.rate[a][b], 3))])]));
const rank2 = [...nos2].sort((a, b) => avgRate.get(b) - avgRate.get(a));
writeFileSync(`${DIR}/2_duel_rank.csv`, csv([['順位', 'No', '名前', '種類', '平均勝率（ほかの全おてあげと）', '同じおてあげどうしの先攻の勝率'], ...rank2.map((a, i) => [i + 1, a, byNo.get(a).name, kindOf(byNo.get(a)), f(avgRate.get(a), 3), f(p2.rate[a][a], 3)])]));

// ---------------------------------------------------------------- 3
const p3 = {};
for (const file of readdirSync(RAW).filter((n) => n.startsWith('part3-'))) Object.assign(p3, read(file.replace('.json', '')));
const decks = Object.keys(p3.null);
const baseRate = Object.fromEntries(decks.map((d) => [d, p3.null[d].score / p3.null[d].games]));
const baseAll = decks.reduce((t, d) => t + p3.null[d].score, 0) / decks.reduce((t, d) => t + p3.null[d].games, 0);
const deckRows = [];
const delta = new Map();
for (const [key, per] of Object.entries(p3)) {
  if (key === 'null') continue;
  const no = Number(key);
  const tot = Object.values(per).reduce((t, s) => ({ games: t.games + s.games, score: t.score + s.score, inHand: t.inHand + s.inHand, used: t.used + s.used, inDeck: t.inDeck + s.inDeck, onField: t.onField + s.onField, items: t.items + s.items, swaps: t.swaps + s.swaps, steps: t.steps + s.steps }), { games: 0, score: 0, inHand: 0, used: 0, inDeck: 0, onField: 0, items: 0, swaps: 0, steps: 0 });
  // 入れかえた時の勝率 − 入れかえない時の勝率（デッキごとに引いて、平均）
  const perDelta = decks.map((d) => per[d].score / per[d].games - baseRate[d]);
  const dAll = perDelta.reduce((t, x) => t + x, 0) / decks.length;
  delta.set(no, dAll);
  const c = byNo.get(no);
  const heldOrUsed = tot.inHand + tot.used;
  deckRows.push({ no, c, dAll, perDelta, tot, unused: c.kind === 'item' && heldOrUsed > 0 ? tot.inHand / heldOrUsed : null });
}
deckRows.sort((a, b) => b.dAll - a.dAll);
writeFileSync(
  `${DIR}/3_deck.csv`,
  csv([
    ['No', '名前', '種類', '勝率の差（3デッキの平均。ポイント）', ...decks.map((d) => `デッキ${d}`), '試合', 'アイテム：手札に残したまま終わった割合', '1試合あたりの交代（入れかえた側）', '1試合あたりのアイテム（入れかえた側）'],
    ...deckRows.map((r) => [r.no, r.c.name, kindOf(r.c), sign(r.dAll, 2), ...r.perDelta.map((x) => sign(x, 2)), r.tot.games, r.unused === null ? '' : f(r.unused, 3), f(r.tot.swaps / r.tot.games, 2), f(r.tot.items / r.tot.games, 2)]),
  ]),
);

// ---------------------------------------------------------------- まとめ（3つの調べ方の順位）
const all = [...byNo.values()].filter((c) => (c.kind === 'otege' && calcBy.has(c.no)) || c.kind === 'item');
/** グループの中での順位の割合（0＝いちばん強い、1＝いちばん弱い） */
function percentile(list, value) {
  const sorted = [...list].sort((a, b) => value(b) - value(a));
  return new Map(sorted.map((c, i) => [c.no, sorted.length > 1 ? i / (sorted.length - 1) : 0]));
}
const sum = {};
for (const g of ['normal', 'super', 'item']) {
  const list = all.filter((c) => group(c) === g);
  const q1 = g === 'item' ? null : percentile(list, (c) => calcBy.get(c.no).hpTimesDmgCap);
  const q2 = g === 'item' ? null : percentile(list, (c) => avgRate.get(c.no));
  const q3 = percentile(list, (c) => delta.get(c.no) ?? 0);
  const rows = list.map((c) => {
    const qs = [q1?.get(c.no), q2?.get(c.no), q3.get(c.no)].filter((x) => x !== undefined);
    const spread = qs.length > 1 ? Math.max(...qs) - Math.min(...qs) : 0;
    return { c, q1: q1?.get(c.no), q2: q2?.get(c.no), q3: q3.get(c.no), score: qs.reduce((t, x) => t + x, 0) / qs.length, spread };
  });
  rows.sort((a, b) => a.score - b.score);
  sum[g] = rows;
}
const summaryCsv = [['グループ', '総合の順位', 'No', '名前', '種類', '1 HP×平均ダメージ（1回100まで）', '1 HP100を倒す平均ターン', '2 1対1の平均勝率', '3 デッキの勝率の差（ポイント）', '1の順位の割合', '2の順位の割合', '3の順位の割合', '食い違いの大きさ']];
for (const [g, rows] of Object.entries(sum)) rows.forEach((r, i) => summaryCsv.push([g, i + 1, r.c.no, r.c.name, kindOf(r.c), r.c.kind === 'otege' ? Math.round(calcBy.get(r.c.no).hpTimesDmgCap) : '', r.c.kind === 'otege' ? f(calcBy.get(r.c.no).turnsToKo100, 2) : '', r.c.kind === 'otege' ? f(avgRate.get(r.c.no), 3) : '', sign(delta.get(r.c.no) ?? 0, 2), r.q1 === undefined ? '' : f(r.q1, 2), r.q2 === undefined ? '' : f(r.q2, 2), f(r.q3, 2), f(r.spread, 2)]));
writeFileSync(`${DIR}/summary.csv`, csv(summaryCsv));

// ---------------------------------------------------------------- README.md（見やすい表）
const line = (r) => {
  const c = r.c;
  const o = c.kind === 'otege';
  return `| ${c.name} | ${kindOf(c)} | ${o ? Math.round(calcBy.get(c.no).hpTimesDmgCap) : '-'} | ${o ? f(calcBy.get(c.no).turnsToKo100, 2) : '-'} | ${o ? pct(avgRate.get(c.no)) : '-'} | ${sign(delta.get(c.no) ?? 0)} |`;
};
const head = `| カード | 種類 | 1 HP×平均ダメージ（1回100まで） | 1 HP100を倒す平均ターン | 2 1対1の平均勝率 | 3 デッキの勝率の差（ポイント） |${NL}|---|---|---|---|---|---|`;
const md = [];
md.push('# カードのバランスのデータ（v2.7）', '');
md.push('調整案は書かない。数字だけ。カードの数値は変えていない。同じ結果を `npm run balance` で作り直せる（決まった種）。', '');
md.push('## 調べ方', '');
md.push('1. **計算で出す強さ**（1_calc.csv）：技の効果のデータから、サイコロ1回あたりの平均。「HP100を倒す平均ターン」は、持続ダメージ（あとから来る分）とばくだんも来るターンに数えて、決まった種で2万回くり返した平均（攻撃の回数。自分の気絶は数えない）。');
md.push(`2. **1対1の総当たり**（2_duel_matrix.csv・2_duel_rank.csv）：おてあげ全${nos2.length}種（ストーリー限定も）を1体どうし・アイテム・ベンチ・山札なしで、全部の組み合わせ（同じおてあげどうしも）を先攻・後攻を入れかえて${p2.games}試合ずつ。出来ることは攻撃だけなので CPU は使わない。先攻1ターン目は攻撃できない（ふつうのルール）。`);
md.push(`3. **デッキに入れた時の効き目**（3_deck.csv）：基本のおてあげ（元祖パックの通常おてあげ）だけの基準のデッキ3つ（下）の1枚を、調べるカード1枚に入れかえ、基準のデッキと対戦。1枚につき 3デッキ × ${p3.null[decks[0]].games}試合 ＝ ${p3.null[decks[0]].games * decks.length}試合（先攻・後攻は半分ずつ）。**CPU は両方「つよい」**（「さいきょう」は1試合 約107秒かかり、この量では200時間以上かかるため。企画者の判断）。「勝率の差」は、入れかえたデッキの勝率から、入れかえない時（基準のデッキどうし）の勝率を、デッキごとに引いた平均（ポイント）。`);
md.push('');
md.push('| 基準のデッキ | 中身（各3枚） | 入れかえる1枚 | 入れかえない時の勝率（基準どうし） |', '|---|---|---|---|');
const bd = JSON.parse(readFileSync(`${RAW}/decks.json`, 'utf8'));
for (const d of bd) md.push(`| ${d.name} | ${[...new Set(d.cards)].map((n) => byNo.get(n).name).join('・')} | ${byNo.get(d.swapOut).name} | ${pct(baseRate[d.name])} |`);
md.push('', `入れかえない時の勝率（3デッキ）は ${pct(baseAll)}。50% からのずれは、試合数による ぶれ（±1.1ポイントくらい）と先攻・後攻の差。`, '');
md.push('**総合の順位**：グループ（通常・スーパー・アイテム）の中で、1（HP×平均ダメージ。1回のダメージは HP100 の相手を倒す100までに切る。999 の技などがふくらまないように）・2（1対1の平均勝率）・3（デッキの勝率の差）それぞれの順位を 0（いちばん強い）〜1（いちばん弱い）の割合にして平均したもの。アイテムは3だけ。', '');
for (const [g, label] of [['normal', '通常おてあげ'], ['super', 'スーパーおてあげ（限定も）'], ['item', 'アイテム']]) {
  const rows = sum[g];
  md.push(`## ${label}：強すぎる候補（上位5）`, '', head, ...rows.slice(0, 5).map(line), '');
  md.push(`## ${label}：弱すぎる候補（下位5）`, '', head, ...rows.slice(-5).reverse().map(line), '');
}
md.push('## 3つの調べ方で結果が食い違ったカード', '', '1・2・3 の順位の割合の差が 0.5 以上（グループの中で、ある調べ方では上の方、別の調べ方では下の方）。', '');
md.push(`| カード | 種類 | 1の順位の割合 | 2の順位の割合 | 3の順位の割合 | 1 HP×平均ダメージ（1回100まで） | 2 1対1の平均勝率 | 3 デッキの勝率の差 |${NL}|---|---|---|---|---|---|---|---|`);
for (const g of ['normal', 'super']) for (const r of [...sum[g]].sort((a, b) => b.spread - a.spread).filter((r) => r.spread >= 0.5)) md.push(`| ${r.c.name} | ${kindOf(r.c)} | ${f(r.q1, 2)} | ${f(r.q2, 2)} | ${f(r.q3, 2)} | ${Math.round(calcBy.get(r.c.no).hpTimesDmgCap)} | ${pct(avgRate.get(r.c.no))} | ${sign(delta.get(r.c.no) ?? 0)} |`);
md.push('');
md.push('## CPU（つよい）のくせ（3の結果から）', '');
md.push('| カード | 手札に残したまま終わった割合 | 使った（捨て札） | 手札に残った | 山札に残った | 1試合あたりのアイテム（入れかえた側） |', '|---|---|---|---|---|---|');
for (const r of deckRows.filter((r) => r.c.kind === 'item')) md.push(`| ${r.c.name} | ${r.unused === null ? '-' : pct(r.unused)} | ${r.tot.used} | ${r.tot.inHand} | ${r.tot.inDeck} | ${f(r.tot.items / r.tot.games, 2)} |`);
// おてあげ：入れかえた1枚が、試合の終わりまでに場に出たか（捨て札＝場で気絶・場にいた）。基準のデッキに入っている おてあげ は、基準の分と見分けられないので外す
const inBase = new Set(bd.flatMap((d) => d.cards));
const played = deckRows.filter((r) => r.c.kind === 'otege' && !inBase.has(r.c.no)).map((r) => ({ r, rate: (r.tot.used + r.tot.onField) / r.tot.games })).sort((x, y) => x.rate - y.rate);
md.push('', '入れかえた おてあげ が、試合の終わりまでに場に出た割合（低い順。基準のデッキに入っているカードは外す）。0% に近いカードは、CPU が場に出さないので「3 デッキの勝率の差」は「使われない1枚」の値になっている。', '');
md.push('| カード | 種類 | 場に出た割合 | 手札に残った | 山札に残った | 3 デッキの勝率の差 |', '|---|---|---|---|---|---|');
for (const { r, rate } of played) md.push(`| ${r.c.name} | ${kindOf(r.c)} | ${pct(rate)} | ${r.tot.inHand} | ${r.tot.inDeck} | ${sign(delta.get(r.c.no) ?? 0)} |`);
md.push('');
const avgSwaps = deckRows.reduce((t, r) => t + r.tot.swaps, 0) / deckRows.reduce((t, r) => t + r.tot.games, 0);
md.push('', `1試合あたりの交代（入れかえた側・全カードの平均）：${f(avgSwaps, 2)}回。基準のデッキどうし：${f(decks.reduce((t, d) => t + p3.null[d].swaps, 0) / decks.reduce((t, d) => t + p3.null[d].games, 0), 2)}回。`, '');
md.push('## ファイル', '', '- 1_calc.csv・2_duel_matrix.csv・2_duel_rank.csv・3_deck.csv・summary.csv（Excel で開ける。文字は UTF-8）', '- raw/：シミュレーションの結果そのもの（JSON）', '- シミュレーション：tests-balance/（lib.ts に計算の決まり）、まとめ：scripts/balance.mjs', '');
mkdirSync(DIR, { recursive: true });
writeFileSync(`${DIR}/README.md`, md.join(NL));
console.log(`${DIR}/README.md を書いた`);
