/**
 * DSH desktop preload: exposes `window.desktopWindow` through contextBridge.
 * API naming follows the Mineradio preload contract so the dsh web UI can
 * detect the same desktop capability surface (independent implementation).
 */

import { contextBridge, ipcRenderer } from 'electron'

const invoke = (channel: string, payload?: unknown): Promise<unknown> =>
  ipcRenderer.invoke(channel, payload ?? {})

contextBridge.exposeInMainWorld('desktopWindow', {
  isDesktop: true,
  ping: () => invoke('desktop-window-ping'),
  getVersion: () => invoke('desktop-window-get-version'),
  minimize: () => invoke('desktop-window-minimize'),
  restore: () => invoke('desktop-window-restore'),
  toggleMaximize: () => invoke('desktop-window-toggle-maximize'),
  toggleFullscreen: () => invoke('desktop-window-toggle-fullscreen'),
  getState: () => invoke('desktop-window-get-state'),
  close: () => invoke('desktop-window-close'),
  listWallpaperEngineProjects: (payload: { force?: boolean } = {}) => invoke('dsh-wallpaper-engine-list', payload),
  getWallpaperEngineProjectDetails: (id: string) => invoke('dsh-wallpaper-engine-project-details', String(id ?? '')),
  openWallpaperEngineProjectDetails: (id: string, target: 'we' | 'workshop') => invoke('dsh-wallpaper-engine-open-project-details', {
    id: String(id ?? ''),
    target: target === 'workshop' ? 'workshop' : 'we',
  }),
  chooseWallpaperEngineDirectory: () => invoke('dsh-wallpaper-engine-choose-directory'),
  chooseWallpaperEngineProjectFile: () => invoke('dsh-wallpaper-engine-choose-project-file'),
  removeWallpaperEngineDirectory: (rootId: string) => invoke('dsh-wallpaper-engine-remove-directory', String(rootId ?? '')),
  getWallpaperEngineRuntimeStatus: (payload: { force?: boolean } = {}) => invoke('dsh-wallpaper-engine-runtime-status', payload),
  startWallpaperEngineScene: (payload: { id: string; width?: number; height?: number; x?: number; y?: number; fps?: number }) => invoke('dsh-wallpaper-engine-start-scene', payload ?? {}),
  reportWallpaperEngineCaptureResult: (payload: { sessionId: string; ok: boolean }) => invoke('dsh-wallpaper-engine-capture-result', payload ?? {}),
  stopWallpaperEngineScene: (payload: { sessionId?: string; all?: boolean } = {}) => invoke('dsh-wallpaper-engine-stop-scene', payload),
  onWallpaperEngineHostBoundsChanged: (callback: (payload: unknown) => void) => {
    if (typeof callback !== 'function') return () => {}
    const listener = (_event: unknown, payload: unknown): void => callback(payload ?? {})
    ipcRenderer.on('dsh-wallpaper-engine-host-bounds-changed', listener)
    return () => { ipcRenderer.removeListener('dsh-wallpaper-engine-host-bounds-changed', listener) }
  },
  onStateChange: (callback: (payload: unknown) => void) => {
    if (typeof callback !== 'function') return () => {}
    const listener = (_event: unknown, payload: unknown): void => callback(payload ?? {})
    ipcRenderer.on('desktop-window-state', listener)
    return () => { ipcRenderer.removeListener('desktop-window-state', listener) }
  },
})

window.addEventListener('DOMContentLoaded', () => {
  document.documentElement.classList.add('desktop-shell-root')
  document.body.classList.add('desktop-shell')
})
