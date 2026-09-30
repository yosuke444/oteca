import { defineConfig } from 'vitest/config';
import type { Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * 音のファイルの一覧（SPEC §10）。public/audio/ の中を数えて渡す。
 * - `virtual:battle-bgm`：戦闘曲（public/audio/bgm/battle/ の .mp3）。曲を足す時はファイルを置くだけでよい
 * - `virtual:audio-files`：public/audio/ の中の全部の音のファイル（例 bgm/bgm_title.mp3、se/se_click.mp3）。
 *   置いていないファイル（.ogg・効果音の差し替え）をネット越しに確かめない（公開サイトで 404 を出さない）ため
 * 開発サーバー：フォルダを見張り、ファイルを足す・消すとページを読み込み直す。公開用ビルド：ビルドした時のファイルが入る
 */
function battleBgm(): Plugin {
  const id = 'virtual:battle-bgm';
  const resolved = '\0' + id;
  const filesId = 'virtual:audio-files';
  const filesResolved = '\0' + filesId;
  const audioDir = resolve(import.meta.dirname, 'public/audio');
  const dir = resolve(audioDir, 'bgm/battle');
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
    resolveId: (source) => (source === id ? resolved : source === filesId ? filesResolved : undefined),
    load: (source) => {
      if (source === resolved) return `export default ${JSON.stringify(list())};`;
      if (source === filesResolved) return `export default ${JSON.stringify(audioFiles())};`;
      return undefined;
    },
    configureServer(server) {
      server.watcher.add(audioDir);
      const onChange = (file: string) => {
        if (!resolve(file).startsWith(audioDir)) return;
        for (const r of [resolved, filesResolved]) {
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
    include: ['tests/**/*.test.ts'],
    passWithNoTests: true,
    testTimeout: 30000,
  },
}));
