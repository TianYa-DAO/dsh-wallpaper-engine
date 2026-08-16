import { describe, expect, test } from 'vitest'
import {
  windowParkScript,
  desktopPowerShellScript,
} from '../src/main/desktop-mode.ts'
import { WallpaperEngineRuntime, sanitizeMuteProperties } from '../src/main/wallpaper-engine-runtime.ts'
import type { WallpaperEngineLibrary } from '../src/main/wallpaper-engine-library.ts'
import { EventEmitter } from 'node:events'
import type { ChildProcess } from 'node:child_process'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

describe('windowParkScript', () => {
  test('validates the source id, title, and executable inputs', () => {
    expect(() => windowParkScript({ sourceId: 'screen:0:0', title: 't', executable: 'e' })).toThrow('DSH_DESKTOP_WINDOW_SOURCE_INVALID')
    expect(() => windowParkScript({ sourceId: 'window:42:0', title: '', executable: 'e' })).toThrow('DSH_DESKTOP_WINDOW_TITLE_INVALID')
    expect(() => windowParkScript({ sourceId: 'window:42:0', title: 't', executable: '' })).toThrow('DSH_DESKTOP_WINDOW_EXECUTABLE_INVALID')
  })

  test('embeds the shared Win32 class and the park body', () => {
    const script = windowParkScript({
      sourceId: 'window:42:0',
      title: 'DSH Wallpaper abc',
      executable: 'D:\\Steam\\steamapps\\common\\wallpaper_engine\\wallpaper64.exe',
    })
    expect(script).toContain('DshDesktopWin32')
    expect(script).toContain('ParseWindowHandle')
    expect(script).toContain('GetSystemMetrics')
    expect(script).toContain('SetWindowPos')
    expect(script).toContain('0x0414')
    expect(script).toContain('DSH_DESKTOP_WINDOW_PARK_UNVERIFIED')
    expect(script).toContain('window:42:0')
    // The parked scene must not raise a taskbar button.
    expect(script).toContain('$GWL_EXSTYLE = -20')
    expect(script).toContain('$WS_EX_APPWINDOW')
    expect(script).toContain('$WS_EX_TOOLWINDOW')
    expect(script).toContain('taskbarHidden = $true')
  })

  test('wraps through the standard desktop PowerShell shell', () => {
    const body = 'throw "DSH_DESKTOP_WINDOW_PARK_FAILED"'
    const script = desktopPowerShellScript(body)
    expect(script).toContain('$ErrorActionPreference = "Stop"')
    expect(script).toContain('SetThreadDpiAwarenessContext')
    expect(script).toContain(body)
  })
})

describe('sanitizeMuteProperties', () => {
  test('keeps JSON-safe entries and blocks prototype keys', () => {
    expect(sanitizeMuteProperties({ volume: 0, musicvolume: -60, muteaudio: true })).toEqual({
      volume: 0,
      musicvolume: -60,
      muteaudio: true,
    })
    expect(sanitizeMuteProperties({ '__proto__': 'bad', ok: 'x', weird: null })).toEqual({ volume: 0, ok: 'x' })
  })
})

describe('WallpaperEngineRuntime park seam', () => {
  function makeFakeChildProcess(): ChildProcess & EventEmitter {
    const child = new EventEmitter() as ChildProcess & EventEmitter
    child.unref = () => {}
    return child
  }

  interface ParkInput { sourceId: string; title: string; executable: string }
  type ParkResult = { ok: boolean; parked: boolean; taskbarHidden: boolean; targetWindowId: string; x: number; y: number; width: number; height: number; error: string }

  async function makeRuntime(options: { parkWindow?: (input: ParkInput) => Promise<ParkResult> }): Promise<{ runtime: WallpaperEngineRuntime; base: string; executable: string }> {
    const base = await mkdtemp(join(tmpdir(), 'dsh-we-park-'))
    const steamRoot = join(base, 'Steam')
    const executable = join(steamRoot, 'steamapps', 'common', 'wallpaper_engine', 'wallpaper64.exe')
    await mkdir(dirname(executable), { recursive: true })
    await writeFile(executable, 'fake-exe')
    let sceneWindowTitle = ''
    const spawn = (_command: string, args: string[], _options: { windowsHide: boolean; stdio: 'ignore' }): ChildProcess => {
      if (args.includes('openWallpaper')) {
        const locationIndex = args.indexOf('-playInWindow') + 1
        sceneWindowTitle = args[locationIndex] ?? ''
      }
      const child = makeFakeChildProcess()
      queueMicrotask(() => child.emit('spawn'))
      return child
    }
    const library = {
      getNativeSceneTarget: async (id: string) => ({
        id: id.toLowerCase(),
        projectFile: join(base, 'project.json'),
        scenePackage: join(base, 'scene.pkg'),
        muteProperties: { volume: 0 },
        propertyCount: 1,
        audioPropertyCount: 1,
        mutedAudioPropertyCount: 1,
      }),
    } as unknown as WallpaperEngineLibrary
    const runtimeOptions: ConstructorParameters<typeof WallpaperEngineRuntime>[0] = {
      library,
      discoverSteamLibraries: async () => [steamRoot],
      desktopCapturer: {
        getSources: async () => [{ id: 'window:42:0', name: sceneWindowTitle }],
      },
      spawn,
      sleep: async () => {},
    }
    if (options.parkWindow !== undefined) runtimeOptions.parkWindow = options.parkWindow
    const runtime = new WallpaperEngineRuntime(runtimeOptions)
    return { runtime, base, executable }
  }

  test('records windowParked from the injected park seam', async () => {
    const { runtime, base } = await makeRuntime({
      parkWindow: async (input) => {
        expect(input.sourceId).toBe('window:42:0')
        expect(input.title).toMatch(/^DSH Wallpaper [a-f0-9]{24}$/)
        expect(input.executable).toContain('wallpaper64.exe')
        return { ok: true, parked: true, taskbarHidden: true, targetWindowId: '42', x: 3839, y: 2159, width: 1280, height: 720, error: '' }
      },
    })
    try {
      const started = await runtime.start('abcdef0123456789abcdef01', { width: 1280, height: 720 })
      expect(started.active).toBe(true)
      expect(started.windowParked).toBe(true)
      expect(started.parkError).toBe('')
      await runtime.stop(started.sessionId)
      await runtime.dispose()
    } finally {
      await rm(base, { recursive: true, force: true })
    }
  })

  test('reports park failure without failing the scene', async () => {
    const { runtime, base } = await makeRuntime({
      parkWindow: async () => ({ ok: false, parked: false, taskbarHidden: false, targetWindowId: '', x: 0, y: 0, width: 0, height: 0, error: 'DSH_DESKTOP_WINDOW_PARK_FAILED' }),
    })
    try {
      const started = await runtime.start('abcdef0123456789abcdef01', { width: 1280, height: 720 })
      expect(started.active).toBe(true)
      expect(started.windowParked).toBe(false)
      expect(started.parkError).toBe('DSH_DESKTOP_WINDOW_PARK_FAILED')
      await runtime.stop(started.sessionId)
      await runtime.dispose()
    } finally {
      await rm(base, { recursive: true, force: true })
    }
  })

  test('runs without a park seam (park disabled)', async () => {
    const { runtime, base } = await makeRuntime({})
    try {
      const started = await runtime.start('abcdef0123456789abcdef01', { width: 1280, height: 720 })
      expect(started.active).toBe(true)
      expect(started.windowParked).toBe(false)
      expect(started.parkError).toBe('')
      await runtime.stop(started.sessionId)
      await runtime.dispose()
    } finally {
      await rm(base, { recursive: true, force: true })
    }
  })
})
