import { defineConfig } from 'vitest/config';
import type { Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * 戦闘曲の一覧（SPEC §10-2）。public/audio/bgm/battle/ にある .mp3 を数えて、
 * `virtual:battle-bgm` として渡す。曲を足す時はファイルを置くだけでよい。
 * - 開発サーバー：フォルダを見張り、曲を足す・消すとページを読み込み直す
 * - 公開用ビルド：ビルドした時にある曲が入る
 */
function battleBgm(): Plugin {
  const id = 'virtual:battle-bgm';
  const resolved = '\0' + id;
  const dir = resolve(import.meta.dirname, 'public/audio/bgm/battle');
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
    resolveId: (source) => (source === id ? resolved : undefined),
    load: (source) => (source === resolved ? `export default ${JSON.stringify(list())};` : undefined),
    configureServer(server) {
      server.watcher.add(dir);
      const onChange = (file: string) => {
        if (!resolve(file).startsWith(dir)) return;
        const mod = server.moduleGraph.getModuleById(resolved);
        if (mod) server.moduleGraph.invalidateModule(mod);
        server.ws.send({ type: 'full-reload' });
      };
      server.watcher.on('add', onChange);
      server.watcher.on('unlink', onChange);
    },
  };
}

export default defineConfig({
  plugins: [react(), battleBgm()],
  test: {
    include: ['tests/**/*.test.ts'],
    passWithNoTests: true,
    testTimeout: 30000,
  },
});
