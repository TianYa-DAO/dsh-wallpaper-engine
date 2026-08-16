import { rename, rm } from 'node:fs/promises'

const dist = new URL('../dist/', import.meta.url)
const source = new URL('preload.js', dist)
const target = new URL('preload.mjs', dist)
await rm(target, { force: true })
await rename(source, target)
