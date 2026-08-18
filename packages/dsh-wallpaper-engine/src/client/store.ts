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

/** Per-panel UI customisation — every field maps to a CSS variable. */
export interface CustomStyle {
  mainOpacity: number
  mainBlur: number
  sidebarOpacity: number
  sidebarBlur: number
  chatOpacity: number
  chatBlur: number
  inputOpacity: number
  inputBlur: number
  panelOpacity: number
  panelBlur: number
  tintColor: string
  accentColor: string
  radius: number
  borderWidth: number
  borderColor: string
  shadowStrength: number
  scrimStrength: number
}

export type DedupStrategy = 'workshop' | 'manual' | 'none'

export interface CarouselPlaylist {
  id: string
  name: string
  wallpaperIds: string[]
  interval: number
  order: 'sequence' | 'random'
}

export interface CarouselState {
  enabled: boolean
  activePlaylistId: string
  playlists: CarouselPlaylist[]
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
  dedupStrategy: DedupStrategy
  carousel: CarouselState
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
  setDedupStrategy: (draft: WallpaperEngineState, strategy: DedupStrategy) => void
  setCarousel: (draft: WallpaperEngineState, carousel: CarouselState) => void
  clearSceneError: (draft: WallpaperEngineState) => void
}

const CUSTOM_STYLE_KEY = 'dsh.wallpaper-engine.customStyle'

export const DEFAULT_CUSTOM_STYLE: CustomStyle = Object.freeze({
  mainOpacity: 1,
  mainBlur: 0,
  sidebarOpacity: 1,
  sidebarBlur: 0,
  chatOpacity: 1,
  chatBlur: 0,
  inputOpacity: 1,
  inputBlur: 0,
  panelOpacity: 1,
  panelBlur: 0,
  tintColor: '',
  accentColor: '',
  radius: 0,
  borderWidth: 0,
  borderColor: '',
  shadowStrength: 0,
  scrimStrength: 0,
})

function readCustomStyle(): CustomStyle {
  try {
    const raw = JSON.parse(localStorage.getItem(CUSTOM_STYLE_KEY) ?? '{}') as Partial<CustomStyle>
    return {
      mainOpacity: clamp(raw.mainOpacity, 0, 1, 1),
      mainBlur: clamp(raw.mainBlur, 0, 40, 0),
      sidebarOpacity: clamp(raw.sidebarOpacity, 0, 1, 1),
      sidebarBlur: clamp(raw.sidebarBlur, 0, 40, 0),
      chatOpacity: clamp(raw.chatOpacity, 0, 1, 1),
      chatBlur: clamp(raw.chatBlur, 0, 40, 0),
      inputOpacity: clamp(raw.inputOpacity, 0, 1, 1),
      inputBlur: clamp(raw.inputBlur, 0, 40, 0),
      panelOpacity: clamp(raw.panelOpacity, 0, 1, 1),
      panelBlur: clamp(raw.panelBlur, 0, 40, 0),
      tintColor: colorValue(raw.tintColor),
      accentColor: colorValue(raw.accentColor),
      radius: clamp(raw.radius, 0, 24, 0),
      borderWidth: clamp(raw.borderWidth, 0, 4, 0),
      borderColor: colorValue(raw.borderColor),
      shadowStrength: clamp(raw.shadowStrength, 0, 1, 0),
      scrimStrength: clamp(raw.scrimStrength, 0, 1, 0),
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

function colorValue(value: unknown): string {
  const s = String(value ?? '').trim()
  if (/^#[0-9a-f]{3,8}$/i.test(s)) return s.toLowerCase()
  if (/^rgba?\([\d,.%\s]+\)$/i.test(s)) return s
  return ''
}

const DEDUP_KEY = 'dsh.wallpaper-engine.dedupStrategy'

function readDedupStrategy(): DedupStrategy {
  try {
    const v = localStorage.getItem(DEDUP_KEY)
    return v === 'manual' ? 'manual' : (v === 'none' ? 'none' : 'workshop')
  } catch { return 'workshop' }
}

function writeDedupStrategy(strategy: DedupStrategy): void {
  try { localStorage.setItem(DEDUP_KEY, strategy) } catch { /* quota */ }
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
      dedupStrategy: readDedupStrategy(),
      carousel: readCarousel(),
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
      setDedupStrategy: (d, strategy) => {
        d.dedupStrategy = strategy
        writeDedupStrategy(strategy)
      },
      setCarousel: (d, carousel) => {
        d.carousel = carousel
        writeCarousel(carousel)
      },
      clearSceneError: (d) => {
        d.scene.error = ''
      },
    },
  })
}

const CAROUSEL_KEY = 'dsh.wallpaper-engine.carousel'

function readCarousel(): CarouselState {
  try {
    const raw = JSON.parse(localStorage.getItem(CAROUSEL_KEY) ?? '{}')
    return {
      enabled: raw.enabled === true,
      activePlaylistId: typeof raw.activePlaylistId === 'string' ? raw.activePlaylistId : '',
      playlists: Array.isArray(raw.playlists)
        ? raw.playlists
            .filter((p: any) => p && typeof p.id === 'string' && p.id)
            .map((p: any) => ({
              id: p.id,
              name: typeof p.name === 'string' ? p.name : 'Playlist',
              wallpaperIds: Array.isArray(p.wallpaperIds) ? p.wallpaperIds.filter((id: any) => typeof id === 'string' && id) : [],
              interval: typeof p.interval === 'number' && p.interval >= 30 ? p.interval : 300,
              order: p.order === 'random' ? 'random' as const : 'sequence' as const,
            }))
        : [],
    }
  } catch { return { enabled: false, activePlaylistId: '', playlists: [] } }
}

function writeCarousel(carousel: CarouselState): void {
  try { localStorage.setItem(CAROUSEL_KEY, JSON.stringify(carousel)) } catch { /* quota */ }
}