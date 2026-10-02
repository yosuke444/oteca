import { defineConfig } from 'vitest/config';
import type { Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { existsSync, readdirSync } from 'node:fs';
import { basename, resolve } from 'node:path';

/**
 * 音のファイルの一覧（SPEC §10）。public/audio/ の中を数えて渡す。
 * - `virtual:battle-bgm`：戦闘曲（public/audio/bgm/battle/ の .mp3）。曲を足す時はファイルを置くだけでよい
 * - `virtual:audio-files`：public/audio/ の中の全部の音のファイル（例 bgm/bgm_title.mp3、se/se_click.mp3）。
 *   置いていないファイル（.ogg・効果音の差し替え）をネット越しに確かめない（公開サイトで 404 を出さない）ため
 * - `virtual:image-files`：public/images・public/packs・public/story の中の絵（v2.0。コイン・パック・ボスの絵。無ければ仮表示）
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
  const imageDirs = ['images', 'packs', 'story'].map((d) => resolve(import.meta.dirname, 'public', d));
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

export default defineConfig(({ command, isPreview }) => ({
  // 公開パス：GitHub Pages（https://<ユーザー名>.github.io/oteca/）用に、公開用ビルドと npm run preview は /oteca/。開発中は /
  // （preview は command が 'serve' になるので isPreview も見る。見ないと /oteca/ の中身が 404 になる）
  base: command === 'build' || isPreview ? '/oteca/' : '/',
  plugins: [react(), battleBgm()],
  test: {
    // テストは3つに分ける（CLAUDE.md・UPDATE_v2 §14）
    // - npm test：軽いテスト（tests/**/*.test.ts。1分以内）。作業中はこれ
    // - npm run test:slow：重いテスト（tests/**/*.slow.test.ts）。各回の最後のコミット前に動かす
    // - npm run ladder：CPU の強さの順番（tests-slow/。SLOW=1。とても時間がかかる）
    include: process.env.SLOW ? ['tests-slow/**/*.test.ts'] : process.env.TEST_SLOW ? ['tests/**/*.slow.test.ts'] : ['tests/**/*.test.ts'],
    exclude: process.env.SLOW || process.env.TEST_SLOW ? ['**/node_modules/**'] : ['**/node_modules/**', 'tests/**/*.slow.test.ts'],
    passWithNoTests: true,
    testTimeout: process.env.SLOW ? 6 * 60 * 60 * 1000 : process.env.TEST_SLOW ? 10 * 60 * 1000 : 30000,
  },
}));
