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
  getWallpaperModeStatus: () => invoke('dsh-desktop-wallpaper-get-status'),
  setWallpaperMode: (payload: { enabled: boolean; url?: string; kind?: 'image' | 'video' }) => invoke('dsh-desktop-wallpaper-set-enabled', payload ?? {}),
  updateWallpaperMode: (payload: { url: string; kind: 'image' | 'video' }) => invoke('dsh-desktop-wallpaper-update', payload ?? {}),
  getDesktopModeStatus: () => invoke('dsh-desktop-mode-get-status'),
  setDesktopMode: (payload: { enabled: boolean; interactive?: boolean }) => invoke('dsh-desktop-mode-set-enabled', payload ?? {}),
  setDesktopIconsVisible: (visible: boolean) => invoke('dsh-desktop-mode-set-icons-visible', visible !== false),
  probeDesktopIcons: () => invoke('dsh-desktop-mode-probe-icons'),
  setDesktopSoftwareLocked: (locked: boolean) => invoke('dsh-desktop-mode-set-software-lock', locked === true),
  requestDesktopKeyboardFocus: () => invoke('dsh-desktop-mode-request-keyboard-focus'),
  updateDesktopPointerRoute: (payload: { overSoftwareUi: boolean; overDesktopControls: boolean }) => ipcRenderer.send('dsh-desktop-mode-pointer-route', payload ?? {}),
  onWallpaperModeState: (callback: (payload: unknown) => void) => {
    if (typeof callback !== 'function') return () => {}
    const listener = (_event: unknown, payload: unknown): void => callback(payload ?? {})
    ipcRenderer.on('dsh-desktop-mode-state', listener)
    return () => { ipcRenderer.removeListener('dsh-desktop-mode-state', listener) }
  },
    startDshInstall: () => invoke('dsh-install-start'),
  openDshInstallHelp: () => invoke('dsh-install-open-help'),
  cancelDshInstall: () => invoke('dsh-install-cancel'),
  onDshInstallProgress: (callback: (payload: unknown) => void) => {
    if (typeof callback !== 'function') return () => {}
    const listener = (_event: unknown, payload: unknown): void => callback(payload ?? {})
    ipcRenderer.on('dsh-install-progress', listener)
    return () => { ipcRenderer.removeListener('dsh-install-progress', listener) }
  },
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
