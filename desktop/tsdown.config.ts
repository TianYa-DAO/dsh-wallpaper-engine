import { defineConfig } from 'tsdown'

/**
 * The desktop shell ships two Electron-side bundles: the main process entry
 * and the sandboxed preload. Both are ESM; the preload keeps the `.mjs`
 * extension Electron requires for ESM preload scripts.
 */
export default defineConfig({
  entry: {
    main: 'lib/types/src/main/index.js',
    preload: 'lib/types/src/preload.mjs',
  },
  outDir: 'dist',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  dts: false,
  clean: true,
  fixedExtension: false,
  external: ['electron'],
})
