import { defineConfig } from 'vitest/config';
import type { Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { execSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, resolve } from 'node:path';

/**
 * 音のファイルの一覧（SPEC §10）。public/audio/ の中を数えて渡す。
 * - `virtual:battle-bgm`：戦闘曲（public/audio/bgm/battle/ の .mp3）。曲を足す時はファイルを置くだけでよい
 * - `virtual:audio-files`：public/audio/ の中の全部の音のファイル（例 bgm/bgm_title.mp3、se/se_click.mp3）。
 *   置いていないファイル（.ogg・効果音の差し替え）をネット越しに確かめない（公開サイトで 404 を出さない）ため
 * - `virtual:image-files`：public/images・public/packs・public/story・public/cards の中の絵（v2.0。コイン・パック・ボスの絵。無ければ仮表示。
 *   cards は v2.3：アイテムのふせんに絵を入れるか決めるため）
 * 開発サーバー：フォルダを見張り、ファイルを足す・消すとページを読み込み直す。公開用ビルド：ビルドした時のファイルが入る
 */
function battleBgm(): Plugin {
  const id = 'virtual:battle-bgm';
  const resolved = '\0' + id;
  const filesId = 'virtual:audio-files';
  const filesResolved = '\0' + filesId;
  const audioDir = resolve(import.meta.dirname, 'public/audio');
  const dir = resolve(audioDir, 'bgm/battle');
  const imagesId = 'virtual:image-files';
  const imagesResolved = '\0' + imagesId;
  const imageDirs = ['images', 'packs', 'story', 'cards'].map((d) => resolve(import.meta.dirname, 'public', d));
  const imageFiles = () =>
    imageDirs
      .filter((d) => existsSync(d))
      .flatMap((d) => readdirSync(d).filter((f) => /\.(png|jpe?g|webp)$/i.test(f)).map((f) => `${basename(d)}/${f}`))
      .sort();
  const audioFiles = () =>
    existsSync(audioDir)
      ? readdirSync(audioDir, { recursive: true, encoding: 'utf8' })
          .map((f) => f.replace(/\\/g, '/'))
          .filter((f) => /\.(mp3|ogg)$/i.test(f))
          .sort()
      : [];
  const list = () => {
    if (!existsSync(dir)) return [];
    const files = readdirSync(dir);
    return files
      .filter((f) => /\.mp3$/i.test(f))
      .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }))
      .map((mp3) => {
        const stem = mp3.replace(/\.mp3$/i, '');
        const ogg = files.find((f) => f.toLowerCase() === `${stem.toLowerCase()}.ogg`);
        return { id: stem, files: ogg ? [mp3, ogg] : [mp3] };
      });
  };
  return {
    name: 'oteca-battle-bgm',
    resolveId: (source) => (source === id ? resolved : source === filesId ? filesResolved : source === imagesId ? imagesResolved : undefined),
    load: (source) => {
      if (source === resolved) return `export default ${JSON.stringify(list())};`;
      if (source === filesResolved) return `export default ${JSON.stringify(audioFiles())};`;
      if (source === imagesResolved) return `export default ${JSON.stringify(imageFiles())};`;
      return undefined;
    },
    configureServer(server) {
      server.watcher.add(audioDir);
      for (const d of imageDirs) server.watcher.add(d);
      const onChange = (file: string) => {
        const f = resolve(file);
        if (!f.startsWith(audioDir) && !imageDirs.some((d) => f.startsWith(d))) return;
        for (const r of [resolved, filesResolved, imagesResolved]) {
          const mod = server.moduleGraph.getModuleById(r);
          if (mod) server.moduleGraph.invalidateModule(mod);
        }
        server.ws.send({ type: 'full-reload' });
      };
      server.watcher.on('add', onChange);
      server.watcher.on('unlink', onChange);
    },
  };
}

/**
 * 版の番号（v2.7。SPEC §12-7）：ビルドID（git のコミットの短いハッシュ。GitHub Actions では GITHUB_SHA）と、通信のプロトコル版数。
 * - ゲームの中には __OTECA_BUILD__ として埋め込む（src/config/version.ts の buildId）
 * - 公開用ビルドでは dist/version.json（{ build, protocol }）を一緒に出す。古いページの人は、これを見て更新に気づく
 * - 開発サーバーは /version.json に今の版を返す（ビルドID は dev）
 */
function buildInfo(command: string): Plugin {
  const protocol = () => Number(/PROTOCOL_VERSION = ([0-9]+);/.exec(readFileSync(resolve(import.meta.dirname, 'src/config/version.ts'), 'utf8'))?.[1] ?? 0);
  const buildId = (() => {
    if (command !== 'build') return 'dev';
    if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA.slice(0, 7);
    try {
      return execSync('git rev-parse --short=7 HEAD', { encoding: 'utf8' }).trim() || 'local';
    } catch {
      return 'local';
    }
  })();
  const json = () => {
    const p = protocol();
    // 読めなければ ビルドを止める（version.json の protocol が 0 だと、新しい版のお知らせが黙って効かなくなるため）
    if (!(p >= 1)) throw new Error('src/config/version.ts の PROTOCOL_VERSION = <数>; が読めません');
    return JSON.stringify({ build: buildId, protocol: p });
  };
  return {
    name: 'oteca-build-info',
    config: () => ({ define: { __OTECA_BUILD__: JSON.stringify(buildId) } }),
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'version.json', source: json() });
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = (req.url ?? '').split('?')[0];
        if (path !== '/version.json' && path !== '/oteca/version.json') return next();
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Cache-Control', 'no-store');
        res.end(json());
      });
    },
  };
}

/**
 * 開発用の中継（v2.0-G）：?net=dev のページどうしを、開発サーバーの WebSocket（HMR の通り道）でつなぐ。
 * 別々のブラウザ（Playwright の別の窓）でも、ネットにつながずに3〜4人の部屋やレートの待合所を確かめられる。
 * 公開用ビルドには入らない（開発サーバーだけ）。届いたものを、ほかの全員にそのまま配るだけ。
 */
function devRelay(): Plugin {
  return {
    name: 'oteca-dev-relay',
    apply: 'serve',
    configureServer(server) {
      server.ws.on('oteca:relay', (data) => server.ws.send('oteca:relay', data));
    },
  };
}

export default defineConfig(({ command, isPreview }) => ({
  // 公開パス：GitHub Pages（https://<ユーザー名>.github.io/oteca/）用に、公開用ビルドと npm run preview は /oteca/。開発中は /
  // （preview は command が 'serve' になるので isPreview も見る。見ないと /oteca/ の中身が 404 になる）
  base: command === 'build' || isPreview ? '/oteca/' : '/',
  plugins: [react(), battleBgm(), devRelay(), buildInfo(command)],
  test: {
    // テストは3つに分ける（CLAUDE.md・UPDATE_v2 §14）
    // - npm test：軽いテスト（tests/**/*.test.ts。1分以内）。作業中はこれ
    // - npm run test:slow：重いテスト（tests/**/*.slow.test.ts）。各回の最後のコミット前に動かす
    // - npm run ladder：CPU の強さの順番（tests-slow/。SLOW=1。とても時間がかかる）
    // - npm run balance：カードのバランスのデータ集め（tests-balance/。BALANCE=1。とても時間がかかる。docs/balance/ に書く）
    include: process.env.BALANCE ? ['tests-balance/**/*.test.ts'] : process.env.SLOW ? ['tests-slow/**/*.test.ts'] : process.env.TEST_SLOW ? ['tests/**/*.slow.test.ts'] : ['tests/**/*.test.ts'],
    exclude: process.env.BALANCE || process.env.SLOW || process.env.TEST_SLOW ? ['**/node_modules/**'] : ['**/node_modules/**', 'tests/**/*.slow.test.ts'],
    passWithNoTests: true,
    testTimeout: process.env.BALANCE || process.env.SLOW ? 6 * 60 * 60 * 1000 : process.env.TEST_SLOW ? 10 * 60 * 1000 : 30000,
  },
}));
