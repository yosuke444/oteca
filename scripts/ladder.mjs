// CPU の強さの順番の確認（SPEC §16 C04）。隣の強さ同士で各200試合（同じデッキ・先攻後攻を入れかえ）
// 使い方：npm run ladder（さいきょうは時間がかかる。16コアの PC で約10分）
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, rmSync } from 'node:fs';

rmSync('tests-slow/results', { recursive: true, force: true });
const r = spawnSync('npx', ['vitest', 'run', 'tests-slow/ladder'], { stdio: 'inherit', shell: true, env: { ...process.env, SLOW: '1' } });
const rows = new Map();
for (const f of readdirSync('tests-slow/results')) {
  const x = JSON.parse(readFileSync(`tests-slow/results/${f}`, 'utf8'));
  const key = `${x.upper} vs ${x.lower}`;
  const t = rows.get(key) ?? { games: 0, upperWins: 0, upperFirstWins: 0, upperSecondWins: 0 };
  for (const k of Object.keys(t)) t[k] += x[k];
  rows.set(key, t);
}
console.log('\n| 対戦（上 vs 下） | 試合 | 上の勝ち | 上の勝率 | 上が先攻の時 | 上が後攻の時 |');
console.log('|---|---|---|---|---|---|');
let ok = true;
for (const [key, t] of rows) {
  const rate = t.upperWins / t.games;
  if (rate < 0.55) ok = false;
  console.log(`| ${key} | ${t.games} | ${t.upperWins} | ${(rate * 100).toFixed(1)}% | ${t.upperFirstWins}/${t.games / 2} | ${t.upperSecondWins}/${t.games / 2} |`);
}
console.log(ok ? '\nすべて 55% 以上' : '\n55% に届かない組がある');
process.exit(r.status || (ok ? 0 : 1));
