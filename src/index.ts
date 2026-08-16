/** Host loader entry for the browser implementation exported from `./client`. */

import type { Context } from '@deepseek-ai/cordis'

/** Cordis plugin name (node half is intentionally empty for this UI package). */
export const name = 'client-ui-wallpaper-engine'

/**
 * Apply the host-side half. Wallpaper Engine capability lives in the desktop
 * main process; this plugin has no host behavior to register.
 * @param ctx - host context (unused).
 */
export function apply(_ctx: Context): void {}
