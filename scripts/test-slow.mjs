// 重いテスト（tests/**/*.slow.test.ts）を動かす（npm run test:slow）。
// 引き継ぎコードの数字を1か所ずつ変えるテスト V02・CPU 同士の大量対戦（C01・C05）・さいきょうの試算（C02・C03）・
// 2つの端末で決着まで対戦する通信のテストなど。各回の最後のコミット前に動かす（CLAUDE.md）。
// Windows でも動くよう、環境変数 TEST_SLOW はここで付ける。
import { spawnSync } from 'node:child_process';

const r = spawnSync('npx', ['vitest', 'run', ...process.argv.slice(2)], { stdio: 'inherit', shell: true, env: { ...process.env, TEST_SLOW: '1' } });
process.exit(r.status ?? 1);
