import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/** 管理者メニュー（v2.0-J。テスト J04）：管理キーが git の履歴のどこにも無い（コミットが増えるほど時間がかかるので重いテストに置く） */

describe('J04 管理キーが git の履歴に無い', () => {
  it('すべてのコミットのファイルに、今の管理キーが無い（値はファイルから読ませ、画面に出さない）', () => {
    if (!existsSync('worker/.admin-key.txt')) return;
    const revs = execFileSync('git', ['rev-list', '--all'], { encoding: 'utf8' }).split('\n').filter(Boolean);
    expect(revs.length).toBeGreaterThan(0);
    // 見つからない時 git grep は 1 で終わる。見つかった時は「コミット:ファイル」の数だけ数える
    const r = spawnSync('git', ['grep', '-l', '-F', '-f', 'worker/.admin-key.txt', ...revs], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    expect(r.status === 0 || r.status === 1, 'git grep が動かなかった').toBe(true);
    const found = r.status === 0 ? r.stdout.trim().split('\n').length : 0;
    expect(found, '管理キーが git の履歴に入っている（何か所か）').toBe(0);
  }, 120000);
});
