import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'tsdown'

const root = fileURLToPath(new URL('..', import.meta.url))

/**
 * Self-contained node-half build: transpiles src/index.ts and src/invariant.ts
 * directly, with no project references and no monorepo paths. Used by the
 * npm `prepare` script so `dsh plugin add github:...` works from a fresh
 * checkout of this repository.
 */
export default defineConfig({
  entry: {
    index: resolve(root, 'src/index.ts'),
    invariant: resolve(root, 'src/invariant.ts'),
  },
  outDir: resolve(root, 'lib'),
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  dts: false,
  clean: false,
  fixedExtension: false,
})
