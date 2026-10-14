import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { STATUS_CACHE_MS, forgetStatus, opponentAllowed, suspendedUntilOf } from '../src/online/status';
import { adminCodeList, findAdminCode } from '../src/admin/codes';
import { TROPHY } from '../src/data/cards';
import { DICTS } from '../src/i18n';
import {
  ADMIN_FAIL_LIMIT,
  ADMIN_LOCK_MS,
  SEARCH_PAGE,
  TROPHY_NUMBER_MAX,
  afterFail,
  ipGroup,
  isLocked,
  isSuspended,
  isTrophyNumber,
  jstDayStart,
  searchSql,
  suspendUntil,
} from '../worker/src/logic/admin';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 9, 4, 3, 0);

/** 管理者メニュー（v2.0-J。SPEC §7 S20・テスト J04・J06・J07） */
describe('J04 管理者のパスワード（5回まちがえたら1時間入れない）', () => {
  it('4回までは入れる。5回目で1時間入れなくなり、1時間たったら また5回まで', () => {
    expect(ADMIN_FAIL_LIMIT).toBe(5);
    expect(ADMIN_LOCK_MS).toBe(60 * 60 * 1000);
    let st = null as ReturnType<typeof afterFail>['next'] | null;
    for (let i = 1; i <= 4; i++) {
      const r = afterFail(st, NOW + i);
      expect(r.locked).toBe(false);
      expect(r.left).toBe(5 - i);
      st = r.next;
      expect(isLocked(st, NOW + i)).toBe(false);
    }
    const fifth = afterFail(st, NOW + 5);
    expect(fifth.locked).toBe(true);
    expect(fifth.left).toBe(0);
    st = fifth.next;
    expect(isLocked(st, NOW + 5)).toBe(true);
    expect(isLocked(st, NOW + 5 + ADMIN_LOCK_MS - 1)).toBe(true);
    expect(isLocked(st, NOW + 5 + ADMIN_LOCK_MS)).toBe(false);
    // 1時間たった後：数え直し（1回まちがえても入れなくならない）
    const after = afterFail(st, NOW + 5 + ADMIN_LOCK_MS + 1);
    expect(after.locked).toBe(false);
    expect(after.left).toBe(4);
  });

  it('管理キーは、ゲームのプログラム・git に書かれていない（worker/.admin-key.txt は git に入れない）', () => {
    const files = execFileSync('git', ['ls-files'], { encoding: 'utf8' }).split('\n').filter(Boolean);
    expect(files).not.toContain('worker/.admin-key.txt');
    expect(readFileSync('.gitignore', 'utf8')).toContain('worker/.admin-key.txt');
    // 手元に管理キーがある時：git に入っているファイルと、作ったゲーム（dist）のどこにも無い
    if (!existsSync('worker/.admin-key.txt')) return;
    // 管理キーそのものは、コマンドにもテストの結果の文にも出さない（ファイルから読ませる。見つからない時 git grep は 1 で終わる）
    const raw = readFileSync('worker/.admin-key.txt', 'utf8');
    const key = raw.trim();
    expect(key.length).toBeGreaterThanOrEqual(32);
    // 1行だけ（空の行や CR があると、git grep -f の調べ方がおかしくなる）
    expect(/[^0-9a-zA-Z_-]/.test(key), '管理キーのファイルは1行（英数字だけ）').toBe(false);
    expect(raw.split('\n').filter((l) => l.trim()).length, '管理キーのファイルは1行').toBe(1);
    expect(raw.includes('\r'), '管理キーのファイルに CR が無い').toBe(false);
    // 作ったゲーム（dist）と public の中（値は比べるだけで、出さない）
    const leaked: string[] = [];
    const walk = (dir: string) => {
      if (!existsSync(dir)) return;
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const f = `${dir}/${e.name}`;
        if (e.isDirectory()) walk(f);
        else if (/[.](js|mjs|html|css|json|map|txt|ts|tsx)$/.test(e.name) && readFileSync(f, 'utf8').includes(key)) leaked.push(f);
      }
    };
    walk('dist');
    walk('public');
    walk('src');
    expect(leaked.length, '管理キーが dist・public・src に入っている（何個のファイルか）').toBe(0);
    const r = spawnSync('git', ['grep', '-l', '-F', '-f', 'worker/.admin-key.txt'], { encoding: 'utf8' });
    const found = r.status === 0 ? r.stdout.trim().split(/\r?\n/).length : 0;
    expect(found, '管理キーが git のファイルに入っている（何個のファイルか）').toBe(0);
    expect(r.status === 0 || r.status === 1, 'git grep が動かなかった').toBe(true);
  });
});

describe('J06 アカウント停止の期間・期限切れ', () => {
  it('期間は 1週間・1ヶ月（30日）・3ヶ月（90日）・ずっと（0）だけ', () => {
    expect(suspendUntil(7, NOW)).toBe(NOW + 7 * DAY);
    expect(suspendUntil(30, NOW)).toBe(NOW + 30 * DAY);
    expect(suspendUntil(90, NOW)).toBe(NOW + 90 * DAY);
    expect(suspendUntil(0, NOW)).toBe(0);
    expect(suspendUntil(8, NOW)).toBeNull();
    expect(suspendUntil('7', NOW)).toBeNull();
  });

  it('期限までは停止中、過ぎたら停止中でない。ずっと は いつまでも停止中', () => {
    const until = suspendUntil(7, NOW)!;
    expect(isSuspended(until, NOW + 7 * DAY - 1)).toBe(true);
    expect(isSuspended(until, NOW + 7 * DAY)).toBe(false);
    expect(isSuspended(0, NOW + 1000 * DAY)).toBe(true);
    expect(isSuspended(null, NOW)).toBe(false);
  });

  it('トロフィーの番号は 1〜9999 の整数', () => {
    expect(isTrophyNumber(1)).toBe(true);
    expect(isTrophyNumber(9999)).toBe(true);
    expect(isTrophyNumber(0)).toBe(false);
    expect(isTrophyNumber(10000)).toBe(false);
    expect(isTrophyNumber(1.5)).toBe(false);
    expect(isTrophyNumber('5')).toBe(false);
  });
});

describe('J07 検索の条件', () => {
  it('名前・ID の部分一致、レート・最後に遊んだ日の範囲、トロフィーの有無、停止中か。50件ずつ', () => {
    const q = searchSql({ name: 'たろ%', id: '12345-6', rateMin: 100, rateMax: 200, seenFrom: 10, seenTo: 20, trophy: 'yes', suspended: 'no', page: 2 }, NOW);
    expect(q.sql).toContain('p.name LIKE ?');
    expect(q.sql).toContain('p.id LIKE ?');
    expect(q.sql).toContain('p.rate >= ?');
    expect(q.sql).toContain('p.rate <= ?');
    expect(q.sql).toContain('p.last_seen >= ?');
    expect(q.sql).toContain('p.last_seen <= ?');
    expect(q.sql).toContain('trophies > 0');
    expect(q.sql).toContain('s.user_id IS NULL');
    expect(q.sql).toContain(`LIMIT ${SEARCH_PAGE + 1} OFFSET ${2 * SEARCH_PAGE}`);
    // LIKE の特別な文字は消す。ID は数字だけ
    expect(q.binds).toEqual([NOW, '%たろ%', '%123456%', 100, 200, 10, 20]);
    expect(SEARCH_PAGE).toBe(50);
    // ユーザーID の行だけ（今までの playerId の行は出さない）
    expect(q.sql).toContain(`length(p.id) = 15`);
    const none = searchSql({ trophy: 'no', suspended: 'yes' }, NOW);
    expect(none.sql).toContain('trophies = 0');
    expect(none.sql).toContain('s.user_id IS NOT NULL');
    expect(none.binds).toEqual([NOW]);
  });

  it('最後に遊んだ日は日本時間の0時で区切る', () => {
    expect(jstDayStart(Date.UTC(2026, 9, 4, 14, 59))).toBe(Date.UTC(2026, 9, 3, 15, 0));
    expect(jstDayStart(Date.UTC(2026, 9, 4, 15, 0))).toBe(Date.UTC(2026, 9, 4, 15, 0));
  });
});

describe('接続元のまとめ方・コードの言葉', () => {
  it('IPv4 はそのまま、IPv6 は /64 にまとめる（アドレスを変えながら試せない）', () => {
    expect(ipGroup('203.0.113.7')).toBe('203.0.113.7');
    expect(ipGroup('2001:db8:1:2:aaaa::1')).toBe('2001:db8:1:2::/64');
    expect(ipGroup('2001:DB8:1:2:bbbb:cccc:dddd:eeee')).toBe('2001:db8:1:2::/64');
    expect(ipGroup('2001:db8::5')).toBe('2001:db8:0:0::/64');
    expect(ipGroup('::1')).toBe('0:0:0:0::/64');
  });

  it('コードは辞書の言葉で見分ける（全角・半角・空白・カタカナとひらがなの違いは無視。どちらの表記でも同じ言葉）', () => {
    for (const lang of ['hira', 'kanji'] as const) {
      const w = DICTS[lang].admin.codeWords;
      expect(findAdminCode('大会閲覧', w)).toBe('watch');
      expect(findAdminCode(' ギフト トロフィあげ ', w)).toBe('trophy');
      expect(findAdminCode('ぎふととろふぃあげ', w)).toBe('trophy');
      expect(findAdminCode('アカウント停止', w)).toBe('suspend');
      expect(findAdminCode('停止解除', w)).toBe('unsuspend');
      expect(findAdminCode('検索', w)).toBe('search');
      expect(findAdminCode('カンリログ', w)).toBe('log');
      // v2.7：ランキング（いま更新する・レート対戦が始まったか）
      expect(findAdminCode('らんきんぐ', w)).toBe('ranking');
      expect(findAdminCode('ちがう', w)).toBeNull();
      expect(adminCodeList(w)).toHaveLength(7);
    }
  });

  it('トロフィーの番号の上限は cards.json の trophy.numberMax（Worker と同じ）', () => {
    expect(TROPHY_NUMBER_MAX).toBe(TROPHY.numberMax);
    expect(isTrophyNumber(TROPHY.numberMax)).toBe(true);
    expect(isTrophyNumber(TROPHY.numberMax + 1)).toBe(false);
  });
});

describe('J06 停止の確かめ（端末）', () => {
  it('相手の結果は10分覚える。自分の確かめ（fresh）は毎回聞く。つながらない時は停止していないとみなす', async () => {
    forgetStatus();
    const ID = '123456789012345';
    let until: number | null = null;
    let asked = 0;
    vi.stubGlobal('fetch', async () => {
      asked += 1;
      return new Response(JSON.stringify({ suspended: until === null ? {} : { [ID]: until } }), { status: 200 });
    });
    expect(await opponentAllowed(ID)).toBe(true);
    until = 0;
    // 覚えている間（10分）は聞かない
    expect(await opponentAllowed(ID)).toBe(true);
    expect(asked).toBe(1);
    // 自分の確かめは毎回聞く
    expect(await suspendedUntilOf(ID, true)).toBe(0);
    expect(asked).toBe(2);
    expect(STATUS_CACHE_MS).toBe(10 * 60 * 1000);
    // つながらない
    forgetStatus();
    vi.stubGlobal('fetch', async () => {
      throw new Error('offline');
    });
    expect(await suspendedUntilOf(ID, true)).toBeNull();
    vi.unstubAllGlobals();
  });
});

describe('J08 管理画面の入り口：O と T の同時押し（v2.4）', async () => {
  const { ADMIN_KEYS, createChordWatcher, isTypingTarget } = await import('../src/scenes/Admin/AdminLogin');
  it('両方が押された瞬間だけ。どちらが先でもよい。片方だけ・押しっぱなしの繰り返しでは開かない', () => {
    expect(ADMIN_KEYS).toEqual(['KeyO', 'KeyT']);
    const w = createChordWatcher(ADMIN_KEYS);
    expect(w.keydown('KeyO')).toBe(false);
    expect(w.keydown('KeyO')).toBe(false); // 繰り返し
    expect(w.keydown('KeyT')).toBe(true);
    expect(w.keydown('KeyT')).toBe(false); // 押しっぱなし
    expect(w.keydown('KeyO')).toBe(false);
    w.keyup('KeyO');
    expect(w.keydown('KeyO')).toBe(true); // 離して押し直した
    w.keyup('KeyO');
    w.keyup('KeyT');
    expect(w.keydown('KeyT')).toBe(false);
    expect(w.keydown('KeyO')).toBe(true); // T が先
    w.reset();
    expect(w.keydown('KeyT')).toBe(false);
    // ほかのキー・片方だけ
    const v = createChordWatcher(ADMIN_KEYS);
    expect(v.keydown('KeyP')).toBe(false);
    expect(v.keydown('KeyO')).toBe(false);
    v.keyup('KeyO');
    expect(v.keydown('KeyT')).toBe(false);
  });
  it('文字を打つ欄（text・password・textarea・書ける所）では反応しない。ボタンなどでは反応する', () => {
    const el = (tagName: string, extra: Record<string, unknown> = {}) => ({ tagName, isContentEditable: false, ...extra }) as unknown as EventTarget;
    expect(isTypingTarget(el('INPUT', { type: 'text' }))).toBe(true);
    expect(isTypingTarget(el('INPUT', { type: 'password' }))).toBe(true);
    expect(isTypingTarget(el('TEXTAREA'))).toBe(true);
    expect(isTypingTarget(el('DIV', { isContentEditable: true }))).toBe(true);
    expect(isTypingTarget(el('INPUT', { type: 'checkbox' }))).toBe(false);
    expect(isTypingTarget(el('BUTTON'))).toBe(false);
    expect(isTypingTarget(el('DIV'))).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });
});
