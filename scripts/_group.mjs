import { BASE, launch } from './pw.mjs';
import { scanAll } from './layoutScan.mjs';
const b = await launch();
const found = await scanAll(b, BASE);
await b.close();
const g = new Map();
for (const f of found) { const m = /^(\S+) (\S+) (\S+)：(.*)$/.exec(f); const key = `${m[3]}：${m[4]}`; if (!g.has(key)) g.set(key, []); g.get(key).push(`${m[1]}/${m[2]}`); }
for (const [k, v] of g) console.log(`${k}  ←  ${v.length === 6 ? 'ぜんぶ' : v.join(' ')}`);
console.log('件数', found.length, '種類', g.size);
