/**
 * Wallpaper Engine client plugin, browser half: registers the library panel
 * as a settings section and the full-viewport background layer as a
 * shell.overlay entry. The desktop bridge is optional — without it the panel
 * shows the "desktop version" hint and the background layer stays inert.
 * Export discipline: packages/client/AGENTS.md.
 */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the settings section and shell.overlay slot declarations.
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import { WallpaperEngineController, bindWallpaperSnapshot } from './controller.ts'
import type { WallpaperSectionInjected } from './WallpaperSection.tsx'
import { WallpaperSection } from './WallpaperSection.tsx'
import type { WallpaperBackgroundInjected } from './WallpaperBackground.tsx'
import { WallpaperBackground } from './WallpaperBackground.tsx'
import { getDesktopWindowApi } from './api.ts'
import { en, zh, type WallpaperKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Wallpaper Engine panel copy. */
    'settings.wallpaper-engine': WallpaperKey
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'settings.wallpaper-engine'

/** Required services (cordis fiber inject). */
export const inject = ['slots', 'locale']

/**
 * Register the wallpaper dictionary, settings section, and background layer.
 * Both entries share one controller (and therefore one store instance).
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-wallpaper-engine: copy dictionaries')

  const t = ctx.locale.bind(NS) as WallpaperSectionInjected['t']
  const api = getDesktopWindowApi()
  const controller = new WallpaperEngineController(api)
  const useSnapshot = bindWallpaperSnapshot(controller)
  const sectionInjected = (): WallpaperSectionInjected => ({
    controller,
    useSnapshot,
    isDesktop: api !== null,
    t,
  })
  const backgroundInjected = (): WallpaperBackgroundInjected => ({
    controller,
    useSnapshot,
    isDesktop: api !== null,
  })

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'wallpaper-engine',
    order: 900,
    label: () => t('nav'),
    inject: sectionInjected,
  }, WallpaperSection))

  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'wallpaper-engine-background',
    order: -100,
    inject: backgroundInjected,
  }, WallpaperBackground))
}
