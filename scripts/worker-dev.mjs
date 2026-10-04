// 手元の Worker（wrangler dev）を、まっさらな保存領域で起動する（scripts/worker-test.mjs・worker-load.mjs から使う）。
// 保存領域は worker/.wrangler/test-<番号>（git に入れない）。終わったら stop() で止めて消す。
import { spawn, spawnSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const WORKER_DIR = fileURLToPath(new URL('../worker/', import.meta.url));
/** 手元の Worker の管理キー（worker/.dev.vars の値。本物の管理キーとは別） */
export const LOCAL_ADMIN_KEY = 'local-admin-key';
/** 接続を許された所（CORS） */
export const ORIGIN = 'http://localhost:5173';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function startWorker(port = 8788) {
  const dir = join(WORKER_DIR, '.wrangler', `test-${process.pid}`);
  rmSync(dir, { recursive: true, force: true });
  const mig = spawnSync('npx', ['wrangler', 'd1', 'migrations', 'apply', 'oteca-ranking', '--local', '--persist-to', dir], {
    cwd: WORKER_DIR,
    shell: true,
    encoding: 'utf8',
    env: { ...process.env, CI: '1' },
  });
  if (mig.status !== 0) throw new Error(`D1 の表を作れませんでした\n${mig.stdout}\n${mig.stderr}`);
  const child = spawn('npx', ['wrangler', 'dev', '--port', String(port), '--persist-to', dir, '--var', 'METRICS:1', '--var', `ADMIN_KEY:${LOCAL_ADMIN_KEY}`], {
    cwd: WORKER_DIR,
    shell: true,
    env: { ...process.env, CI: '1' },
  });
  let log = '';
  child.stdout.on('data', (d) => (log += d));
  child.stderr.on('data', (d) => (log += d));
  const base = `http://localhost:${port}`;
  for (let i = 0; i < 120; i++) {
    await sleep(500);
    try {
      const r = await fetch(`${base}/ranking`, { headers: { Origin: ORIGIN } });
      if (r.ok) break;
    } catch {
      // まだ起動していない
    }
    if (i === 119) {
      stop();
      throw new Error(`wrangler dev が起動しませんでした\n${log}`);
    }
  }
  function stop() {
    if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    else child.kill('SIGTERM');
    // 消せない時（まだ使用中）は次の起動で消す
    for (let i = 0; i < 5; i++) {
      try {
        rmSync(dir, { recursive: true, force: true });
        break;
      } catch {
        spawnSync(process.execPath, ['-e', 'setTimeout(()=>{},500)']);
      }
    }
  }
  return { base, stop, log: () => log };
}

/** API を呼ぶ（Origin を付ける）。答えと、数えたもの（x-* の見出し）を返す */
export async function api(base, path, { method = 'GET', body, admin, origin = ORIGIN } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (origin) headers.Origin = origin;
  if (admin) headers['x-admin-key'] = admin;
  const r = await fetch(`${base}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    // JSON でない
  }
  const n = (k) => Number(r.headers.get(k) ?? 0);
  return {
    status: r.status,
    json,
    headers: r.headers,
    count: { d1Read: n('x-d1-rows-read'), d1Written: n('x-d1-rows-written'), doRead: n('x-do-rows-read'), doWritten: n('x-do-rows-written'), doRequests: n('x-do-requests') },
  };
}

/** 受付係に WebSocket でつなぐ（player：{ id, token }。token で本人を確かめる）。届いたものは msgs に入る */
export function connectLobby(base, player, origin = ORIGIN) {
  const q = player ? `?playerId=${player.id}&token=${player.token}` : '';
  const ws = new WebSocket(`${base.replace(/^http/, 'ws')}/lobby${q}`, { headers: { Origin: origin } });
  const c = { ws, msgs: [], closed: false, opened: false, code: 0 };
  ws.onopen = () => (c.opened = true);
  ws.onmessage = (ev) => c.msgs.push(JSON.parse(String(ev.data)));
  ws.onclose = (ev) => {
    c.closed = true;
    c.code = ev.code;
  };
  ws.onerror = () => {};
  c.join = (body) => ws.send(JSON.stringify({ t: 'join', body }));
  c.leave = () => ws.send(JSON.stringify({ t: 'leave' }));
  c.paired = () => c.msgs.find((m) => m.t === 'paired')?.body ?? null;
  c.lastCount = () => [...c.msgs].reverse().find((m) => m.t === 'waiting')?.body.count;
  c.waitOpen = async () => {
    for (let i = 0; i < 100 && !c.opened && !c.closed; i++) await sleep(50);
    return c.opened;
  };
  return c;
}

export async function until(fn, ms = 5000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (fn()) return true;
    await sleep(30);
  }
  return fn();
}

export { sleep };

/** 登録して token をもらう（{ id, token, name }） */
export async function register(base, id, name = 'p') {
  const r = await api(base, '/register', { method: 'POST', body: { playerId: id, name, optIn: true } });
  return { id, name, token: r.json?.token };
}

/** 16桁の16進数の playerId */
export function pid(n, prefix = 'a') {
  return (prefix + n.toString(16)).padStart(16, '0').slice(-16);
}
