import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  root: resolve(__dirname),
  resolve: {
    alias: {
      // Resolve the package back to local sources during development so the
      // example always reflects the current working tree.
      'prosemirror-freeze-plugin': resolve(__dirname, '../src/index.ts'),
      'prosemirror-freeze-plugin/markdown': resolve(__dirname, '../src/markdown.ts'),
    },
  },
  build: {
    outDir: resolve(__dirname, 'dist'),
    emptyOutDir: true,
  },
  server: {
    host: '0.0.0.0',
    allowedHosts: ['.code.internal.local'],
  },
});
