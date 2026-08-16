/**
 * Simplified Wallpaper Engine native-scene runtime for the DSH desktop shell.
 * Design is informed by Mineradio's GPL-3.0 wallpaper-engine-runtime.js
 * (reference design only; this independent implementation covers the M4
 * scope: probe the WE installation, open a scene in a titled window, discover
 * the window through desktopCapturer so the renderer can capture it, apply
 * default-mute audio properties, and close the scene on stop). It does NOT
 * embed into WorkerW or manipulate desktop icons (deferred M5).
 *
 * @module apps/desktop/src/main/wallpaper-engine-runtime
 */

import { spawn as nodeSpawn, type ChildProcess } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { join, resolve } from 'node:path'
import { discoverSteamLibraries as discoverSteamLibrariesDefault } from './wallpaper-engine-library.ts'
import type { WallpaperEngineLibrary } from './wallpaper-engine-library.ts'

/** Launch bounds are clamped into the same range the reference shell uses. */
const MIN_WIDTH = 640
const MAX_WIDTH = 7680
const MIN_HEIGHT = 360
const MAX_HEIGHT = 4320

const SOURCE_POLL_INTERVAL_MS = 220
const SOURCE_TIMEOUT_MS = 12_000
const ENGINE_READY_DELAY_MS = 1200
const MUTE_RETRY_DELAYS_MS = [180, 420, 900]

interface DesktopCapturerSource {
  id: string
  name: string
}

interface DesktopCapturerLike {
  getSources(options: { types: Array<'window' | 'screen'>; thumbnailSize: { width: number; height: number }; fetchWindowIcons: boolean }): Promise<DesktopCapturerSource[]>
}

export interface WallpaperRuntimeStartOptions {
  width?: number
  height?: number
  x?: number
  y?: number
  fps?: number
}

interface ActiveSession {
  id: string
  sessionId: string
  locationTitle: string
  sourceId: string
  width: number
  height: number
  fps: number
  executable: string
  muteProperties: Record<string, string | number | boolean>
  launched: boolean
  stopping: boolean
  windowParked: boolean
  parkError: string
}

/** Result of parking the playback window off the virtual screen. */
export interface WindowParkResult {
  ok: boolean
  parked: boolean
  taskbarHidden: boolean
  targetWindowId: string
  x: number
  y: number
  width: number
  height: number
  error: string
}

/** Public renderer-facing status shape. */
export interface WallpaperRuntimeStatus {
  ok: true
  active: boolean
  id: string
  sessionId: string
  sourceId: string
  width: number
  height: number
  fps: number
  audioMuted: boolean
  windowParked: boolean
  parkError: string
}

function clampInteger(value: unknown, minimum: number, maximum: number, fallback: number): number {
  const numeric = Math.round(Number(value))
  return Number.isFinite(numeric) ? Math.max(minimum, Math.min(maximum, numeric)) : fallback
}

function safeRuntimeOptions(options: WallpaperRuntimeStartOptions = {}): Required<WallpaperRuntimeStartOptions> {
  return {
    width: clampInteger(options.width, MIN_WIDTH, MAX_WIDTH, 1280),
    height: clampInteger(options.height, MIN_HEIGHT, MAX_HEIGHT, 720),
    x: clampInteger(options.x, -16_000, 16_000, 0),
    y: clampInteger(options.y, -16_000, 16_000, 0),
    fps: clampInteger(options.fps, 1, 240, 30),
  }
}

/** Keep only valid, JSON-safe mute entries so malformed projects cannot inject keys. */
export function sanitizeMuteProperties(value: unknown): Record<string, string | number | boolean> {
  const output: Record<string, string | number | boolean> = { volume: 0 }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return output
  for (const [rawKey, rawValue] of Object.entries(value as Record<string, unknown>)) {
    if (!/^[a-z0-9_.-]{1,128}$/i.test(rawKey)) continue
    if (rawKey === '__proto__' || rawKey === 'prototype' || rawKey === 'constructor') continue
    if (typeof rawValue === 'boolean') output[rawKey] = rawValue
    else if (typeof rawValue === 'number' && Number.isFinite(rawValue)) output[rawKey] = rawValue
    else if (typeof rawValue === 'string') output[rawKey] = rawValue.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 512)
  }
  return output
}

interface RuntimeOptions {
  library: WallpaperEngineLibrary
  desktopCapturer?: DesktopCapturerLike | null
  discoverSteamLibraries?: () => Promise<string[]>
  spawn?: (command: string, args: string[], options: { windowsHide: boolean; stdio: 'ignore' }) => ChildProcess
  platform?: NodeJS.Platform
  arch?: string
  sleep?: (milliseconds: number) => Promise<void>
  parkWindow?: (input: { sourceId: string; title: string; executable: string }) => Promise<WindowParkResult>
}

interface InstallationProbe {
  ok: true
  available: boolean
  executable?: string
  reason?: string
}

/**
 * Wallpaper Engine runtime: probe, start, confirm, stop. Electron-free; the
 * desktopCapturer and spawn seams are injected by the main process.
 */
export class WallpaperEngineRuntime {
  private readonly library: WallpaperEngineLibrary
  private readonly desktopCapturer: DesktopCapturerLike | null
  private readonly discoverSteamLibraries: () => Promise<string[]>
  private readonly spawnImpl: (command: string, args: string[], options: { windowsHide: boolean; stdio: 'ignore' }) => ChildProcess
  private readonly platform: NodeJS.Platform
  private readonly arch: string
  private readonly sleepImpl: (milliseconds: number) => Promise<void>
  private readonly parkWindowImpl: ((input: { sourceId: string; title: string; executable: string }) => Promise<WindowParkResult>) | null
  private executableCache: { executable: string; available: true } | { available: false; reason: string } | null = null
  private active: ActiveSession | null = null
  private generation = 0
  private disposed = false

  constructor(options: RuntimeOptions) {
    this.library = options.library
    this.desktopCapturer = options.desktopCapturer ?? null
    this.discoverSteamLibraries = options.discoverSteamLibraries ?? discoverSteamLibrariesDefault
    this.spawnImpl = options.spawn ?? nodeSpawn
    this.platform = options.platform ?? process.platform
    this.arch = options.arch ?? process.arch
    this.sleepImpl = options.sleep ?? (milliseconds => new Promise(resolvePromise => setTimeout(resolvePromise, milliseconds)))
    this.parkWindowImpl = options.parkWindow ?? null
  }

  /** Candidate WE executables for one Steam library, in architecture order. */
  private candidateExecutables(libraries: string[]): string[] {
    const names = this.arch === 'x64' ? ['wallpaper64.exe', 'wallpaper32.exe'] : ['wallpaper32.exe', 'wallpaper64.exe']
    const seen = new Set<string>()
    const output: string[] = []
    for (const library of libraries) {
      const root = resolve(library.trim())
      if (!root) continue
      for (const name of names) {
        const executable = join(root, 'steamapps', 'common', 'wallpaper_engine', name)
        const key = executable.toLowerCase()
        if (seen.has(key)) continue
        seen.add(key)
        output.push(executable)
      }
    }
    return output
  }

  /** Find a WE installation by file existence across discovered Steam libraries. */
  async discoverExecutable(force = false): Promise<InstallationProbe> {
    if (this.platform !== 'win32') return { ok: true, available: false, reason: 'WALLPAPER_ENGINE_WINDOWS_ONLY' }
    if (force) this.executableCache = null
    if (this.executableCache !== null) return { ok: true, ...this.executableCache }
    let libraries: string[] = []
    try {
      libraries = await this.discoverSteamLibraries()
    } catch {
      libraries = []
    }
    for (const executable of this.candidateExecutables(libraries)) {
      try {
        const found = await import('node:fs/promises').then(({ stat }) => stat(executable))
        if (found.isFile()) {
          this.executableCache = { executable, available: true }
          return { ok: true, available: true, executable }
        }
      } catch {
        // keep scanning candidates
      }
    }
    this.executableCache = { available: false, reason: 'WALLPAPER_ENGINE_NOT_INSTALLED' }
    return { ok: true, available: false, reason: 'WALLPAPER_ENGINE_NOT_INSTALLED' }
  }

  /** Lightweight probe for the renderer status API. */
  async probe(force = false): Promise<InstallationProbe> {
    return this.discoverExecutable(force)
  }

  /** Ask WE to reveal one workshop item in its browser (best effort). */
  async revealWorkshop(workshopId: string): Promise<{ ok: true; workshopId: string }> {
    const normalized = workshopId.trim()
    if (!/^\d{5,32}$/.test(normalized)) throw new Error('WALLPAPER_ENGINE_WORKSHOP_ID_INVALID')
    const installation = await this.discoverExecutable(false)
    if (!installation.available || installation.executable === undefined) {
      throw new Error(installation.reason ?? 'WALLPAPER_ENGINE_NOT_INSTALLED')
    }
    await this.ensureEngineReady(installation.executable)
    await this.spawnControl(installation.executable, ['-control', 'revealWallpaper', '-id', normalized])
    return { ok: true, workshopId: normalized }
  }

  getStatus(): WallpaperRuntimeStatus {
    const session = this.active
    if (session === null) {
      return {
        ok: true,
        active: false,
        id: '',
        sessionId: '',
        sourceId: '',
        width: 0,
        height: 0,
        fps: 0,
        audioMuted: false,
        windowParked: false,
        parkError: '',
      }
    }
    return {
      ok: true,
      active: true,
      id: session.id,
      sessionId: session.sessionId,
      sourceId: session.sourceId,
      width: session.width,
      height: session.height,
      fps: session.fps,
      audioMuted: true,
      windowParked: session.windowParked,
      parkError: session.parkError,
    }
  }

  private spawnControl(executable: string, args: string[]): Promise<void> {
    return new Promise((resolvePromise, reject) => {
      let settled = false
      const finish = (error: Error | null): void => {
        if (settled) return
        settled = true
        if (error !== null) reject(error)
        else resolvePromise()
      }
      let child: ChildProcess
      try {
        child = this.spawnImpl(executable, args, { windowsHide: true, stdio: 'ignore' })
      } catch (error) {
        finish(error as Error)
        return
      }
      child.once('error', finish)
      child.once('spawn', () => {
        child.unref()
        finish(null)
      })
    })
  }

  /** Make sure the WE main process is up before sending control commands. */
  private async ensureEngineReady(executable: string): Promise<void> {
    // The reference implementation performs a full process+IPC readiness
    // probe. M4 keeps the same two-step shape (launch, then wait) but skips
    // PowerShell process probing; the subsequent openWallpaper command and
    // window-source poll are the readiness signal.
    await this.spawnControl(executable, [])
    await this.sleepImpl(ENGINE_READY_DELAY_MS)
  }

  private async findWindowSource(locationTitle: string): Promise<DesktopCapturerSource> {
    if (this.desktopCapturer === null || typeof this.desktopCapturer.getSources !== 'function') {
      throw new Error('WALLPAPER_ENGINE_CAPTURE_UNAVAILABLE')
    }
    const deadline = Date.now() + SOURCE_TIMEOUT_MS
    while (Date.now() <= deadline) {
      if (this.disposed) throw new Error('WALLPAPER_ENGINE_RUNTIME_DISPOSED')
      let sources: DesktopCapturerSource[] = []
      try {
        sources = await this.desktopCapturer.getSources({
          types: ['window'],
          thumbnailSize: { width: 0, height: 0 },
          fetchWindowIcons: false,
        })
      } catch {
        sources = []
      }
      const exact = sources.find(source => source.name === locationTitle && source.id !== '')
      if (exact !== undefined) return exact
      await this.sleepImpl(SOURCE_POLL_INTERVAL_MS)
    }
    throw new Error('WALLPAPER_ENGINE_WINDOW_TIMEOUT')
  }

  private async applyMute(session: ActiveSession): Promise<void> {
    if (session.executable === '') return
    await this.spawnControl(session.executable, [
      '-control',
      'applyProperties',
      '-properties',
      `RAW~(${JSON.stringify(session.muteProperties)})~END`,
      '-location',
      session.locationTitle,
    ])
  }

  private async muteSession(session: ActiveSession): Promise<void> {
    let lastError: Error | null = null
    for (const delay of MUTE_RETRY_DELAYS_MS) {
      await this.sleepImpl(delay)
      if (this.active !== session && this.disposed) throw new Error('WALLPAPER_ENGINE_START_SUPERSEDED')
      try {
        await this.applyMute(session)
        return
      } catch (error) {
        lastError = error as Error
      }
    }
    if (lastError !== null) throw lastError
    throw new Error('WALLPAPER_ENGINE_AUDIO_SUPPRESSION_FAILED')
  }

  /** Open a scene window and return its capture source id for the renderer. */
  async start(id: string, options: WallpaperRuntimeStartOptions = {}): Promise<WallpaperRuntimeStatus> {
    if (this.disposed) throw new Error('WALLPAPER_ENGINE_RUNTIME_DISPOSED')
    const generation = ++this.generation
    const runtimeOptions = safeRuntimeOptions(options)
    const sessionId = randomBytes(12).toString('hex')
    const target = await this.library.getNativeSceneTarget(id)
    const installation = await this.discoverExecutable(false)
    if (!installation.available || installation.executable === undefined) {
      throw new Error(installation.reason ?? 'WALLPAPER_ENGINE_NOT_INSTALLED')
    }
    const session: ActiveSession = {
      id: target.id,
      sessionId,
      locationTitle: `DSH Wallpaper ${sessionId}`,
      sourceId: '',
      width: runtimeOptions.width,
      height: runtimeOptions.height,
      fps: runtimeOptions.fps,
      executable: installation.executable,
      muteProperties: sanitizeMuteProperties(target.muteProperties),
      launched: false,
      stopping: false,
      windowParked: false,
      parkError: '',
    }

    try {
      await this.ensureEngineReady(session.executable)
      if (generation !== this.generation) throw new Error('WALLPAPER_ENGINE_START_SUPERSEDED')
      await this.spawnControl(session.executable, [
        '-control',
        'openWallpaper',
        '-file',
        target.scenePackage,
        '-playInWindow',
        session.locationTitle,
        '-width',
        String(session.width),
        '-height',
        String(session.height),
        '-x',
        String(runtimeOptions.x),
        '-y',
        String(runtimeOptions.y),
        '-borderless',
      ])
      session.launched = true
      const source = await this.findWindowSource(session.locationTitle)
      if (generation !== this.generation) throw new Error('WALLPAPER_ENGINE_START_SUPERSEDED')
      session.sourceId = source.id
      if (this.parkWindowImpl !== null) {
        try {
          const parked = await this.parkWindowImpl({
            sourceId: source.id,
            title: session.locationTitle,
            executable: session.executable,
          })
          session.windowParked = parked.ok === true && parked.parked === true
          if (!session.windowParked) session.parkError = parked.error || 'WALLPAPER_ENGINE_WINDOW_PARK_FAILED'
        } catch (error) {
          session.windowParked = false
          session.parkError = error instanceof Error ? error.message : 'WALLPAPER_ENGINE_WINDOW_PARK_FAILED'
        }
      }
      await this.muteSession(session)
      this.active = session
      return this.getStatus()
    } catch (error) {
      if (session.launched) await this.closeSession(session)
      throw error instanceof Error ? error : new Error('WALLPAPER_ENGINE_START_FAILED')
    }
  }

  /** Renderer ACK after its video element decoded the first captured frame. */
  async confirmCaptureReady(expectedSessionId: string): Promise<boolean> {
    const session = this.active
    if (session === null || expectedSessionId !== session.sessionId) return false
    try {
      await this.applyMute(session)
      return true
    } catch {
      return false
    }
  }

  private async closeSession(session: ActiveSession): Promise<void> {
    session.stopping = true
    if (session.launched && session.executable !== '') {
      try {
        await this.spawnControl(session.executable, ['-control', 'closeWallpaper', '-location', session.locationTitle])
      } catch {
        // Best-effort close; the WE process owns the window lifetime.
      }
    }
    if (this.active === session) this.active = null
  }

  /** Stop one session (or all sessions when sessionId is empty). */
  async stop(expectedSessionId = ''): Promise<{ ok: true; stopped: boolean; active: boolean; sessionId: string }> {
    const normalized = expectedSessionId
    const targets = this.active === null ? [] : [this.active]
    if (normalized !== '' && this.active?.sessionId !== normalized) {
      return { ok: true, stopped: false, active: this.active !== null, sessionId: this.active?.sessionId ?? '' }
    }
    for (const session of targets) await this.closeSession(session)
    return { ok: true, stopped: true, active: false, sessionId: '' }
  }

  /** Close everything and drop caches. */
  async dispose(): Promise<void> {
    this.disposed = true
    this.generation += 1
    await this.stop()
    this.executableCache = null
  }
}
