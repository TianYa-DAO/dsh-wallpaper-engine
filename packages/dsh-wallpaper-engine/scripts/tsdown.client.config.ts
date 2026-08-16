import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { clientConfig, clientOnly } from './tsdown.client.ts'

const root = fileURLToPath(new URL('..', import.meta.url))
const config = clientConfig('dsh-wallpaper-engine', resolve(root, 'src/client/index.ts'))

/**
 * Self-contained browser bundle: same closure-factory + CSS Modules pipeline
 * as the monorepo client packages, but transpiling src/client directly.
 */
export default clientOnly([{ ...config, outDir: resolve(root, 'lib') }])
