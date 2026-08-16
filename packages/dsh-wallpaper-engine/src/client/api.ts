/**
 * Desktop-bridge types and detection. The actual implementation is injected
 * by the Electron preload as `window.desktopWindow`; web builds without the
 * bridge keep working and show the "desktop only" hint.
 */

/** One library item as returned by the desktop main process. */
export interface WallpaperProjectItem {
  id: string
  title: string
  projectType: string
  mediaType: 'video' | 'image' | ''
  mediaAnimated: boolean
  playable: boolean
  enginePlayable: boolean
  previewOnly: boolean
  hasPreview: boolean
  previewAnimated: boolean
  source: 'workshop' | 'local' | 'imported'
  sourceLabel: string
  workshopId: string
  propertyCount: number
  audioPropertyCount: number
  mutedAudioPropertyCount: number
  updatedAt: number
  safetyMode: 'direct-media' | 'native-engine' | 'preview-only'
}

export interface WallpaperLibrarySnapshot {
  ok: boolean
  projects: WallpaperProjectItem[]
  count: number
  dynamicCount: number
  enginePlayableCount: number
  previewOnlyCount: number
  sourceCount: number
  manualRoots: Array<{ id: string; name: string }>
  scannedAt: number
  elapsedMs: number
  mediaToken: string
  runtime?: WallpaperRuntimeProbe
}

export interface WallpaperRuntimeProbe {
  ok: boolean
  available: boolean
  executable?: string
  reason?: string
}

export interface WallpaperSceneStartResult {
  ok: boolean
  active?: boolean
  sessionId?: string
  sourceId?: string
  width?: number
  height?: number
  fps?: number
  windowParked?: boolean
  parkError?: string
  error?: string
}

/** The bridge surface exposed by the DSH desktop preload. */
export interface DesktopWindowApi {
  isDesktop: boolean
  ping(): Promise<unknown>
  getVersion(): Promise<unknown>
  minimize(): Promise<unknown>
  restore(): Promise<unknown>
  toggleMaximize(): Promise<unknown>
  toggleFullscreen(): Promise<unknown>
  getState(): Promise<unknown>
  close(): Promise<unknown>
  listWallpaperEngineProjects(payload?: { force?: boolean }): Promise<WallpaperLibrarySnapshot>
  getWallpaperEngineProjectDetails(id: string): Promise<unknown>
  openWallpaperEngineProjectDetails(id: string, target: 'we' | 'workshop'): Promise<unknown>
  chooseWallpaperEngineDirectory(): Promise<WallpaperLibrarySnapshot & { canceled?: boolean; error?: string }>
  chooseWallpaperEngineProjectFile(): Promise<WallpaperLibrarySnapshot & { canceled?: boolean; error?: string }>
  removeWallpaperEngineDirectory(rootId: string): Promise<WallpaperLibrarySnapshot>
  getWallpaperEngineRuntimeStatus(payload?: { force?: boolean }): Promise<
    WallpaperRuntimeProbe & { active: boolean; sessionId: string; sourceId: string; windowParked: boolean; parkError: string }
  >
  startWallpaperEngineScene(payload: {
    id: string
    width?: number
    height?: number
    x?: number
    y?: number
    fps?: number
  }): Promise<WallpaperSceneStartResult>
  reportWallpaperEngineCaptureResult(payload: { sessionId: string; ok: boolean }): Promise<{ ok: boolean; captureReady: boolean }>
  stopWallpaperEngineScene(payload?: { sessionId?: string; all?: boolean }): Promise<{ ok: boolean; stopped?: boolean }>
  getWallpaperModeStatus(): Promise<WallpaperModeStatus>
  setWallpaperMode(payload: { enabled: boolean; url?: string; kind?: 'image' | 'video' }): Promise<WallpaperModeStatus>
  updateWallpaperMode(payload: { url: string; kind: 'image' | 'video' }): Promise<WallpaperModeStatus>
  getDesktopModeStatus(): Promise<DesktopModeStatus>
  setDesktopMode(payload: { enabled: boolean; interactive?: boolean }): Promise<DesktopModeStatus>
  setDesktopIconsVisible(visible: boolean): Promise<{ ok: boolean; visible: boolean; error: string }>
  probeDesktopIcons(): Promise<{ ok: boolean; found: boolean; visible: boolean; desktopListWindowId: string; error: string }>
  setDesktopSoftwareLocked(locked: boolean): Promise<DesktopModeStatus>
  requestDesktopKeyboardFocus(): Promise<{ ok: boolean; focused: boolean }>
  updateDesktopPointerRoute(payload: { overSoftwareUi: boolean; overDesktopControls: boolean }): void
  onWallpaperModeState(callback: (payload: DesktopModeStatus) => void): () => void
  onWallpaperEngineHostBoundsChanged(callback: (payload: HostBoundsPayload) => void): () => void
  onStateChange(callback: (payload: unknown) => void): () => void
}

export interface WallpaperModeStatus {
  ok: boolean
  supported: boolean
  enabled: boolean
  active: boolean
  windowId: number | null
  nativeWindowId: string
  parentWindowId: string
  parentClassName: string
  bounds: HostBoundsPayload | null
  error: string
}

export interface DesktopModeStatus {
  ok: boolean
  supported: boolean
  enabled: boolean
  interactive: boolean
  attached: boolean
  desktopIconsVisible: boolean
  softwareInteractionLocked: boolean
  ignoreMouseEvents: boolean
  error: string
}

export interface HostBoundsPayload {
  x: number
  y: number
  width: number
  height: number
  suspended: boolean
}

/** Read the optional bridge once and cache the verdict. */
export function getDesktopWindowApi(): DesktopWindowApi | null {
  const value = (window as { desktopWindow?: DesktopWindowApi }).desktopWindow
  return value !== undefined && value.isDesktop ? value : null
}

/** Build a `dsh-wallpaper://` media URL for an indexed project. */
export function wallpaperMediaUrl(kind: 'media' | 'preview', item: WallpaperProjectItem | null, token: string): string {
  if (item === null || token === '') return ''
  return `dsh-wallpaper://${kind}/${encodeURIComponent(item.id)}?v=${encodeURIComponent(String(item.updatedAt || 0))}&token=${encodeURIComponent(token)}`
}

declare global {
  interface Window {
    desktopWindow?: DesktopWindowApi
  }
}
