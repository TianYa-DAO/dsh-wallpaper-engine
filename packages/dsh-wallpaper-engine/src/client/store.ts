/**
 * Shared viewing/interaction state for the wallpaper UI: library snapshot,
 * active selection, native-scene capture session, and desktop customisation
 * (opacity, blur, colour, radius, border, shadow). Business data stays in
 * the desktop main process; this store only mirrors the renderer-visible
 * projection.
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

/** Per-parameter UI customisation — every field maps to a CSS variable. */
export interface CustomStyle {
  panelOpacity: number
  panelBlur: number
  sidebarOpacity: number
  sidebarBlur: number
  tintColor: string
  accentColor: string
  radius: number
  borderWidth: number
  borderColor: string
  shadowStrength: number
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
  customStyle: CustomStyle
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
  setCustomStyle: (draft: WallpaperEngineState, style: CustomStyle) => void
  clearSceneError: (draft: WallpaperEngineState) => void
}

const CUSTOM_STYLE_KEY = 'dsh.wallpaper-engine.customStyle'

export const DEFAULT_CUSTOM_STYLE: CustomStyle = Object.freeze({
  panelOpacity: 1,
  panelBlur: 0,
  sidebarOpacity: 1,
  sidebarBlur: 0,
  tintColor: '',
  accentColor: '',
  radius: 0,
  borderWidth: 0,
  borderColor: '',
  shadowStrength: 0,
})

function readCustomStyle(): CustomStyle {
  try {
    const raw = JSON.parse(localStorage.getItem(CUSTOM_STYLE_KEY) ?? '{}') as Partial<CustomStyle>
    return {
      panelOpacity: clamp(raw.panelOpacity, 0, 1, 1),
      panelBlur: clamp(raw.panelBlur, 0, 40, 0),
      sidebarOpacity: clamp(raw.sidebarOpacity, 0, 1, 1),
      sidebarBlur: clamp(raw.sidebarBlur, 0, 40, 0),
      tintColor: hexColor(raw.tintColor),
      accentColor: hexColor(raw.accentColor),
      radius: clamp(raw.radius, 0, 24, 0),
      borderWidth: clamp(raw.borderWidth, 0, 4, 0),
      borderColor: hexColor(raw.borderColor),
      shadowStrength: clamp(raw.shadowStrength, 0, 1, 0),
    }
  } catch {
    return { ...DEFAULT_CUSTOM_STYLE }
  }
}

function writeCustomStyle(style: CustomStyle): void {
  try { localStorage.setItem(CUSTOM_STYLE_KEY, JSON.stringify(style)) } catch { /* quota */ }
}

function clamp(value: unknown, min: number, max: number, fallback: number): number {
  const n = Number(value)
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback
}

function hexColor(value: unknown): string {
  const s = String(value ?? '')
  return /^#[0-9a-f]{3,8}$/i.test(s) ? s.toLowerCase() : ''
}

/**
 * Create the wallpaper UI store handle. The handle is constructed in apply
 * world and shared by the desktop-customisation entry, the library entry,
 * and the background entry, so all three read and write the same instance.
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
      customStyle: readCustomStyle(),
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
      setCustomStyle: (d, style) => {
        d.customStyle = style
        writeCustomStyle(style)
      },
      clearSceneError: (d) => {
        d.scene.error = ''
      },
    },
  })
}