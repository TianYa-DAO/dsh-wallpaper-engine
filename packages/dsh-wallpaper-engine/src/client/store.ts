/**
 * Shared viewing/interaction state for the wallpaper UI: library snapshot,
 * active selection, and the native-scene capture session. Business data
 * (which files exist on disk, what WE is doing) stays in the desktop main
 * process; this store only mirrors the renderer-visible projection.
 */

import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-runtime/client'
import type { WallpaperProjectItem } from './api.ts'
import { readWallpaperSelection, writeWallpaperSelection, type WallpaperSelection } from './selection.ts'

export type WallpaperLibraryStatus = 'idle' | 'loading' | 'ready' | 'error'

export interface WallpaperSceneState {
  active: boolean
  sessionId: string
  sourceId: string
  error: string
  freeze: boolean
  windowParked: boolean
  parkError: string
}

export interface WallpaperEngineState {
  status: WallpaperLibraryStatus
  projects: WallpaperProjectItem[]
  manualRoots: Array<{ id: string; name: string }>
  mediaToken: string
  runtimeAvailable: boolean
  search: string
  selection: WallpaperSelection
  scene: WallpaperSceneState
  glassMode: boolean
  error: string
}

export type WallpaperEngineActions = {
  setLoading: (draft: WallpaperEngineState) => void
  setReady: (
    draft: WallpaperEngineState,
    projects: WallpaperProjectItem[],
    manualRoots: Array<{ id: string; name: string }>,
    mediaToken: string,
    runtimeAvailable: boolean,
  ) => void
  setError: (draft: WallpaperEngineState, message: string) => void
  setSearch: (draft: WallpaperEngineState, search: string) => void
  setSelection: (draft: WallpaperEngineState, selection: WallpaperSelection) => void
  setScene: (draft: WallpaperEngineState, scene: Partial<WallpaperSceneState>) => void
  setGlassMode: (draft: WallpaperEngineState, enabled: boolean) => void
  clearSceneError: (draft: WallpaperEngineState) => void
}

/**
 * Create the wallpaper UI store handle. The handle is constructed in apply
 * world and shared by the settings-section entry and the background entry, so
 * both read and write the same instance.
 * @returns the shared store handle.
 */
export function createWallpaperEngineStore(): EngineStoreHandle<WallpaperEngineState, WallpaperEngineActions> {
  return defineStore({
    init: (): WallpaperEngineState => ({
      status: 'idle',
      projects: [],
      manualRoots: [],
      mediaToken: '',
      runtimeAvailable: false,
      search: '',
      selection: readWallpaperSelection(),
      scene: { active: false, sessionId: '', sourceId: '', error: '', freeze: false, windowParked: false, parkError: '' },
      glassMode: readGlassMode(),
      error: '',
    }),
    actions: {
      setLoading: (d) => {
        d.status = 'loading'
        d.error = ''
      },
      setReady: (d, projects, manualRoots, mediaToken, runtimeAvailable) => {
        d.status = 'ready'
        d.projects = projects
        d.manualRoots = manualRoots
        d.mediaToken = mediaToken
        d.runtimeAvailable = runtimeAvailable
        d.error = ''
      },
      setError: (d, message) => {
        d.status = 'error'
        d.error = message
      },
      setSearch: (d, search) => {
        d.search = search
      },
      setSelection: (d, selection) => {
        d.selection = selection
        writeWallpaperSelection(selection)
      },
      setScene: (d, scene) => {
        d.scene = { ...d.scene, ...scene }
      },
      setGlassMode: (d, enabled) => {
        d.glassMode = enabled
        writeGlassMode(enabled)
      },
      clearSceneError: (d) => {
        d.scene.error = ''
      },
    },
  })
}

const GLASS_MODE_KEY = 'dsh.wallpaper-engine.glassMode'

function readGlassMode(): boolean {
  try { return localStorage.getItem(GLASS_MODE_KEY) === 'true' } catch { return false }
}

function writeGlassMode(enabled: boolean): void {
  try { localStorage.setItem(GLASS_MODE_KEY, enabled ? 'true' : 'false') } catch { /* quota */ }
}
