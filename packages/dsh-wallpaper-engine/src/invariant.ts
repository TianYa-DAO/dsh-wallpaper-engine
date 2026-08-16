/**
 * Package-owned invariant companion for `dsh-wallpaper-engine`.
 * @module dsh-wallpaper-engine/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = 'dsh-wallpaper-engine'

/** Cordis companion plugin name. */
export const name = 'client-ui-wallpaper-engine-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: slot conflicts fail loud in the slot core, and the
 * desktop bridge is an optional browser global the UI degrades without.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
