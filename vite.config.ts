import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

/**
 * The shared game engine (engine/) is imported as `@mahjong/engine`. It is a
 * pure-TypeScript package with no build step of its own, so we alias the bare
 * specifier straight to its source entry point. Vite resolves the engine's
 * internal `.js` import specifiers to their `.ts` sources automatically.
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@mahjong/engine': fileURLToPath(new URL('./engine/src/index.ts', import.meta.url)),
    },
  },
});
