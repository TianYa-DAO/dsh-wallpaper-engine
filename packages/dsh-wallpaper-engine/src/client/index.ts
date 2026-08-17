/**
 * Wallpaper Engine client plugin, browser half: registers two settings
 * sections (Desktop / Wallpaper) and the full-viewport background layer.
 * All three entries share one controller and store instance.
 */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import { WallpaperEngineController, bindWallpaperSnapshot } from './controller.ts'
import type { WallpaperSectionInjected } from './WallpaperSection.tsx'
import { WallpaperSection } from './WallpaperSection.tsx'
import type { DesktopCustomSectionInjected } from './DesktopCustomSection.tsx'
import { DesktopCustomSection } from './DesktopCustomSection.tsx'
import type { WallpaperBackgroundInjected } from './WallpaperBackground.tsx'
import { WallpaperBackground } from './WallpaperBackground.tsx'
import { getDesktopWindowApi } from './api.ts'
import { en, zh, type WallpaperKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'settings.wallpaper-engine': WallpaperKey
  }
}

const NS = 'settings.wallpaper-engine'

export const inject = ['slots', 'locale']

export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-wallpaper-engine: copy dictionaries')

  const t = ctx.locale.bind(NS) as WallpaperSectionInjected['t']
  const api = getDesktopWindowApi()
  const controller = new WallpaperEngineController(api)
  const useSnapshot = bindWallpaperSnapshot(controller)

  const libraryInjected = (): WallpaperSectionInjected => ({
    controller,
    useSnapshot,
    isDesktop: api !== null,
    t,
  })
  const desktopInjected = (): DesktopCustomSectionInjected => ({
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
    id: 'wallpaper-desktop',
    order: 900,
    label: () => t('desktopNav'),
    inject: desktopInjected,
  }, DesktopCustomSection))

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'wallpaper-library',
    order: 910,
    label: () => t('wallpaperNav'),
    inject: libraryInjected,
  }, WallpaperSection))

  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'wallpaper-engine-background',
    order: -100,
    inject: backgroundInjected,
  }, WallpaperBackground))
}
