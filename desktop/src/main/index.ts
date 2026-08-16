/**
 * DSH desktop shell main process: Electron window over the dsh web UI plus
 * the Wallpaper Engine library/runtime bridge. The window loads the local dsh
 * web server (http://127.0.0.1:3080); the shell adds only a window and the
 * preload bridge — it never re-hosts or rewrites the chat UI.
 *
 * @module apps/desktop/src/main
 */

import { execFile, spawn } from 'node:child_process'
import { existsSync, writeFileSync } from 'node:fs'
import { connect } from 'node:net'
import { app, BrowserWindow, desktopCapturer, dialog, ipcMain, Menu, nativeTheme, protocol, screen, shell, type IpcMainInvokeEvent, type IpcMainEvent } from 'electron'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dshHomePath } from './home-paths.ts'
import {
  WALLPAPER_ENGINE_SCHEME,
  WallpaperEngineLibrary,
} from './wallpaper-engine-library.ts'
import { WallpaperEngineRuntime } from './wallpaper-engine-runtime.ts'
import { DesktopModeRuntime, DesktopWallpaperRuntime } from './desktop-mode.ts'

const __dirname = fileURLToPath(new URL('.', import.meta.url))

const DESKTOP_WEB_URL = process.env.DSH_DESKTOP_URL ?? 'http://127.0.0.1:3080'
const ALLOWED_ORIGINS = new Set(['http://127.0.0.1:3080', 'http://localhost:3080'])

// Software rendering avoids GPU compositor black windows on remote desktops
// and virtual machines while keeping the chat UI and desktop capture working.
app.disableHardwareAcceleration()
app.setAppUserModelId('com.deepseek.dsh.desktop')
// Keep the native Windows title bar light while the web UI keeps its own theme.
nativeTheme.themeSource = 'light'

let mainWindow: BrowserWindow | null = null
let library: WallpaperEngineLibrary | null = null
let runtime: WallpaperEngineRuntime | null = null
let desktopWallpaper: DesktopWallpaperRuntime | null = null
let desktopMode: DesktopModeRuntime | null = null
let boundsTimer: NodeJS.Timeout | null = null

protocol.registerSchemesAsPrivileged([{
  scheme: WALLPAPER_ENGINE_SCHEME,
  privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true },
}])

/** IPC trust fence: main frame of our window and an allowed origin only. */
function isTrustedSender(event: IpcMainInvokeEvent | IpcMainEvent): boolean {
  if (mainWindow === null || mainWindow.isDestroyed()) return false
  const frame = event.senderFrame
  if (frame === null || frame !== event.sender.mainFrame) return false
  const url = new URL(frame.url)
  return ALLOWED_ORIGINS.has(url.origin) && event.sender === mainWindow.webContents
}

function stringArg(value: unknown): string { return typeof value === 'string' ? value : '' }

function failUntrusted(): { ok: false; error: string } {
  return { ok: false, error: 'DESKTOP_UNTRUSTED_CALLER' }
}

function isPortListening(port: number): Promise<boolean> {
  return new Promise((resolvePromise) => {
    const socket = connect({ port, host: '127.0.0.1', timeout: 1200 })
    const finish = (listening: boolean): void => {
      socket.destroy()
      resolvePromise(listening)
    }
    socket.once('connect', () => { finish(true) })
    socket.once('timeout', () => { finish(false) })
    socket.once('error', () => { finish(false) })
  })
}

interface InstallProgress {
  phase: 'checking' | 'installing-node' | 'installing-dsh' | 'done' | 'error'
  message: string
  detail?: string
}

let installerWindow: BrowserWindow | null = null
let installCancelRequested = false

function emitInstallProgress(payload: InstallProgress): void {
  if (installerWindow !== null && !installerWindow.isDestroyed()) {
    installerWindow.webContents.send('dsh-install-progress', payload)
  }
}

function runCommand(file: string, args: string[], timeoutMs = 120_000): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolvePromise) => {
    execFile(file, args, {
      encoding: 'utf8',
      windowsHide: true,
      timeout: timeoutMs,
      maxBuffer: 4 * 1024 * 1024,
    }, (error, stdout, stderr) => {
      resolvePromise({
        code: error === null ? 0 : Number((error as NodeJS.ErrnoException & { code?: unknown }).code) || 1,
        stdout: stdout || '',
        stderr: stderr || '',
      })
    })
  })
}

function findDshCommand(): string {
  const appData = process.env.APPDATA ?? ''
  const candidates = [
    join(appData, 'npm', 'dsh.cmd'),
    'dsh',
  ]
  for (const candidate of candidates) {
    if (candidate === 'dsh') {
      // PATH lookup happens by spawning below; prefer the known location.
      continue
    }
    if (existsSync(candidate)) return candidate
  }
  return 'dsh'
}

async function dshCommandWorks(command: string): Promise<boolean> {
  if (command === 'dsh') {
    const result = await runCommand('dsh', ['--version'], 10_000)
    return result.code === 0
  }
  return existsSync(command)
}

function setupWindowHtml(initialPhase: string): string {
  const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>DeepSeek Harness桌面版安装</title>
<style>
  body{margin:0;font-family:"Segoe UI","Microsoft YaHei UI",sans-serif;background:#f6f7f9;color:#1a1b1f;display:flex;align-items:center;justify-content:center;height:100vh}
  .card{width:460px;padding:28px;background:#fff;border-radius:16px;box-shadow:0 10px 40px rgba(0,0,0,.08)}
  h1{font-size:20px;margin:0 0 8px}
  p{font-size:14px;line-height:22px;color:#555}
  .status{margin:14px 0;padding:10px 12px;background:#f0f4ff;border-radius:8px;font-size:13px;line-height:20px}
  .error{background:#fff0f0;color:#b42318}
  button{border:0;padding:10px 16px;border-radius:8px;background:#3964fe;color:#fff;font-size:14px;cursor:pointer}
  button.ghost{background:#eef0f3;color:#333;margin-left:8px}
  button:disabled{opacity:.5;cursor:default}
</style></head>
<body><div class="card">
  <h1>DeepSeek Harness桌面版</h1>
  <p id="title">首次使用需要安装 DeepSeek Harness 运行环境。</p>
  <div class="status" id="status">${initialPhase === 'missing-dsh' ? '未检测到 dsh，点击下方按钮开始一键安装。' : '正在检查运行环境…'}</div>
  <div>
    <button id="install" type="button">一键安装</button>
    <button id="manual" class="ghost" type="button">手动安装说明</button>
    <button id="quit" class="ghost" type="button">退出</button>
  </div>
</div>
<script>
  const status = document.getElementById('status')
  const install = document.getElementById('install')
  const manual = document.getElementById('manual')
  const quit = document.getElementById('quit')
  window.desktopWindow.onDshInstallProgress(payload => {
    status.className = 'status' + (payload.phase === 'error' ? ' error' : '')
    status.textContent = payload.message
    install.disabled = ['installing-node','installing-dsh'].includes(payload.phase)
    if (payload.phase === 'done') setTimeout(() => window.close(), 700)
  })
  install.addEventListener('click', () => window.desktopWindow.startDshInstall())
  manual.addEventListener('click', () => window.desktopWindow.openDshInstallHelp())
  quit.addEventListener('click', () => window.desktopWindow.cancelDshInstall())
</script></body></html>`
  return 'data:text/html;charset=utf-8,' + encodeURIComponent(html)
}

async function showInstallerWindow(initialPhase: string): Promise<boolean> {
  if (installerWindow !== null && !installerWindow.isDestroyed()) {
    installerWindow.focus()
    return false
  }
  installCancelRequested = false
  const win = new BrowserWindow({
    width: 560,
    height: 420,
    resizable: false,
    frame: true,
    title: 'DeepSeek Harness桌面版安装',
    autoHideMenuBar: true,
    icon: join(__dirname, '..', 'assets', 'icon.ico'),
    webPreferences: { preload: join(__dirname, 'preload.mjs'), contextIsolation: true, nodeIntegration: false, sandbox: false },
  })
  installerWindow = win
  win.on('closed', () => {
    if (installerWindow === win) installerWindow = null
  })
  await win.loadURL(setupWindowHtml(initialPhase))
  return true
}

/**
 * Install the dsh CLI when it is missing. The installer uses winget for
 * Node.js (when needed), then `npm install -g @deepseek-ai/dsh`, and finally
 * asks the caller to start `dsh web` again.
 */
async function runDshInstall(): Promise<string> {
  emitInstallProgress({ phase: 'checking', message: '正在检查 Node.js 和 npm…' })
  let nodeExe = 'node'
  let npmCmd = 'npm'
  const programFiles = process.env.ProgramFiles ?? 'C:\\Program Files'
  const nodeExePath = join(programFiles, 'nodejs', 'node.exe')
  const npmCmdPath = join(programFiles, 'nodejs', 'npm.cmd')

  const nodeCheck = await runCommand(nodeExe, ['--version'], 15_000)
  if (nodeCheck.code !== 0) {
    if (existsSync(nodeExePath)) {
      nodeExe = nodeExePath
    } else {
      emitInstallProgress({ phase: 'installing-node', message: '未检测到 Node.js，正在用 winget 安装…' })
      const winget = await runCommand('winget.exe', [
        'install', '-e', '--id', 'OpenJS.NodeJS.LTS',
        '--scope', 'user', '--silent',
        '--accept-package-agreements', '--accept-source-agreements',
      ], 600_000)
      if (winget.code !== 0) {
        emitInstallProgress({ phase: 'error', message: 'Node.js 安装失败。', detail: winget.stderr || winget.stdout })
        return ''
      }
      nodeExe = existsSync(nodeExePath) ? nodeExePath : 'node'
    }
  }
  if (existsSync(npmCmdPath)) npmCmd = npmCmdPath

  emitInstallProgress({ phase: 'installing-dsh', message: '正在安装 DeepSeek Harness（首次安装需要下载，请稍候）…' })
  const install = await runCommand(npmCmd, ['install', '-g', '@deepseek-ai/dsh@0.1.0-rc.5'], 600_000)
  if (install.code !== 0) {
    emitInstallProgress({ phase: 'error', message: 'DeepSeek Harness 安装失败。', detail: install.stderr || install.stdout })
    return ''
  }
  const appData = process.env.APPDATA ?? ''
  const dshCmd = join(appData, 'npm', 'dsh.cmd')
  if (!existsSync(dshCmd)) {
    emitInstallProgress({ phase: 'error', message: '安装完成但找不到 dsh 命令，请重启电脑后重试。' })
    return ''
  }
  emitInstallProgress({ phase: 'done', message: '安装完成，正在启动…' })
  return dshCmd
}

/**
 * Start `dsh web` with a resolved command and wait for its port.
 * @param command - resolved dsh command path.
 */
async function startDshWeb(command: string): Promise<void> {
  const port = Number(new URL(DESKTOP_WEB_URL).port || 3080)
  if (await isPortListening(port)) return
  try {
    const child = spawn(command, ['web'], { detached: true, windowsHide: true, stdio: 'ignore' })
    child.on('error', () => {})
    child.unref()
  } catch {
    // keep the normal load path
  }
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (await isPortListening(port)) return
    await new Promise(resolvePromise => setTimeout(resolvePromise, 1000))
  }
}

/**
 * Bring up dsh web, installing the CLI first when necessary. Returns the
 * resolved dsh command, an empty string when the installer window took over.
 */
async function ensureDshWebRunning(): Promise<string> {
  const port = Number(new URL(DESKTOP_WEB_URL).port || 3080)
  if (process.env.DSH_DESKTOP_FORCE_INSTALLER === '1') {
    await showInstallerWindow('missing-dsh')
    return ''
  }
  if (await isPortListening(port)) return 'already-running'
  const command = findDshCommand()
  if (!(await dshCommandWorks(command))) {
    await showInstallerWindow('missing-dsh')
    return ''
  }
  await startDshWeb(command)
  return command
}

/** Send a debounced host-bounds update so the renderer can freeze/recover. */
function scheduleHostBoundsChanged(): void {
  if (boundsTimer !== null) clearTimeout(boundsTimer)
  boundsTimer = setTimeout(() => {
    boundsTimer = null
    if (mainWindow === null || mainWindow.isDestroyed()) return
    const bounds = mainWindow.getContentBounds()
    mainWindow.webContents.send('dsh-wallpaper-engine-host-bounds-changed', {
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      suspended: mainWindow.isMinimized() || !mainWindow.isVisible(),
    })
  }, 120)
}

/**
 * Wait for the dsh web boot to finish before showing the desktop window.
 * Readiness = the loader has left the boot page (no "Loading plugins" /
 * "Failed to load plugins") and the real UI root has children. The timeout is
 * a fallback so the window never stays invisible forever.
 */
async function waitForWebReady(window: BrowserWindow, onReady: () => void): Promise<void> {
  const timeoutMs = Math.max(5000, Number(process.env.DSH_DESKTOP_WEB_READY_TIMEOUT_MS) || 180_000)
  const deadline = Date.now() + timeoutMs
  const probe = [
    '(() => {',
    '  if (document.readyState !== "complete") return false',
    '  if (document.querySelector(\'button[aria-haspopup="dialog"]\') !== null) return true',
    '  const text = document.body ? document.body.innerText : ""',
    '  if (text.includes("Loading plugins") || text.includes("Failed to load plugins")) return false',
    '  const root = document.querySelector("#root")',
    '  return root !== null && root.childElementCount > 0',
    '})()',
  ].join('\n')
  while (Date.now() < deadline) {
    if (window.isDestroyed()) return
    let ready = false
    try {
      ready = await window.webContents.executeJavaScript(probe, true) === true
    } catch {
      ready = false
    }
    if (ready) {
      onReady()
      return
    }
    await new Promise(resolve => setTimeout(resolve, 500))
  }
  onReady()
}

function createMainWindow(): void {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 940,
    minHeight: 600,
    show: false,
    backgroundColor: '#0f1115',
    title: 'DeepSeek Harness桌面版',
    icon: join(__dirname, '..', 'assets', 'icon.ico'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, 'preload.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
    },
  })
  mainWindow = window
  let webReady = false
  let windowShown = false
  const showMainWindow = (): void => {
    if (windowShown || window.isDestroyed()) return
    windowShown = true
    window.show()
  }
  window.on('page-title-updated', (event) => { event.preventDefault() })
  window.once('ready-to-show', () => {
    if (process.env.DSH_DESKTOP_SMOKE === '1') {
      const marker = process.env.DSH_DESKTOP_SMOKE_FILE
      if (marker !== undefined) writeFileSync(marker, 'ready-to-show')
    }
    if (webReady) showMainWindow()
  })
  let loadAttempts = 0
  window.webContents.on('did-fail-load', (_event, code, description) => {
    if (process.env.DSH_DESKTOP_SMOKE === '1') {
      const marker = process.env.DSH_DESKTOP_SMOKE_FILE
      if (marker !== undefined) writeFileSync(marker, `did-fail-load:${code}:${description}`)
      app.quit()
      return
    }
    if (loadAttempts >= 5) return
    loadAttempts += 1
    setTimeout(() => { void window.loadURL(DESKTOP_WEB_URL) }, 900)
  })
  window.webContents.on('did-finish-load', () => {
    loadAttempts = 0
    if (process.env.DSH_DESKTOP_SMOKE !== '1') {
      void waitForWebReady(window, () => {
        webReady = true
        showMainWindow()
      })
      return
    }
    const marker = process.env.DSH_DESKTOP_SMOKE_FILE
    void window.webContents.executeJavaScript(
      'window.desktopWindow ? window.desktopWindow.ping() : { ok: false, error: "DESKTOP_BRIDGE_MISSING" }',
      true,
    ).then((result) => {
      if (marker !== undefined) writeFileSync(marker, JSON.stringify(result))
    }).catch((error: unknown) => {
      if (marker !== undefined) writeFileSync(marker, `bridge-error:${error instanceof Error ? error.message : String(error)}`)
    }).finally(() => {
      setTimeout(() => { app.quit() }, 300)
    })
  })
  window.on('resize', scheduleHostBoundsChanged)
  window.on('move', scheduleHostBoundsChanged)
  window.on('restore', scheduleHostBoundsChanged)
  window.on('minimize', scheduleHostBoundsChanged)
  window.on('maximize', scheduleHostBoundsChanged)
  void window.loadURL(DESKTOP_WEB_URL)
}

function registerWindowIpc(): void {
  ipcMain.handle('desktop-window-ping', (event) => {
    if (!isTrustedSender(event)) return failUntrusted()
    return { ok: true, isDesktop: true, version: app.getVersion(), platform: process.platform }
  })
  ipcMain.handle('desktop-window-get-version', (event) => {
    if (!isTrustedSender(event)) return failUntrusted()
    return { ok: true, version: app.getVersion(), electron: process.versions.electron }
  })
  ipcMain.handle('desktop-window-minimize', (event) => {
    if (!isTrustedSender(event)) return failUntrusted()
    mainWindow?.minimize()
    return { ok: true }
  })
  ipcMain.handle('desktop-window-restore', (event) => {
    if (!isTrustedSender(event)) return failUntrusted()
    if (mainWindow?.isMinimized() === true) mainWindow.restore()
    return { ok: true }
  })
  ipcMain.handle('desktop-window-toggle-maximize', (event) => {
    if (!isTrustedSender(event)) return failUntrusted()
    if (mainWindow?.isMaximized() === true) mainWindow.unmaximize()
    else mainWindow?.maximize()
    return { ok: true }
  })
  ipcMain.handle('desktop-window-toggle-fullscreen', (event) => {
    if (!isTrustedSender(event)) return failUntrusted()
    const win = mainWindow
    if (win !== null) win.setFullScreen(!win.isFullScreen())
    return { ok: true }
  })
  ipcMain.handle('desktop-window-get-state', (event) => {
    if (!isTrustedSender(event)) return failUntrusted()
    return {
      ok: true,
      minimized: mainWindow?.isMinimized() ?? false,
      maximized: mainWindow?.isMaximized() ?? false,
      fullscreen: mainWindow?.isFullScreen() ?? false,
      visible: mainWindow?.isVisible() ?? false,
    }
  })
  ipcMain.handle('desktop-window-close', (event) => {
    if (!isTrustedSender(event)) return failUntrusted()
    mainWindow?.close()
    return { ok: true }
  })
}

function registerWallpaperIpc(): void {
  if (library === null || runtime === null) throw new Error('desktop: wallpaper services not initialized')
  const lib = library
  const rt = runtime

  ipcMain.handle('dsh-wallpaper-engine-list', async (event, payload: { force?: boolean } = {}) => {
    if (!isTrustedSender(event)) return { ok: false, projects: [], count: 0, error: 'DESKTOP_UNTRUSTED_CALLER' }
    try {
      const snapshot = await lib.list({ force: payload.force === true })
      const runtimeProbe = await rt.probe(false)
      return { ...snapshot, runtime: runtimeProbe }
    } catch (error) {
      return { ok: false, projects: [], count: 0, error: error instanceof Error ? error.message : 'WALLPAPER_ENGINE_SCAN_FAILED' }
    }
  })

  ipcMain.handle('dsh-wallpaper-engine-project-details', async (event, id: unknown) => {
    if (!isTrustedSender(event)) return { ok: false, error: 'DESKTOP_UNTRUSTED_CALLER' }
    try {
      return await lib.getProjectDetails(stringArg(id))
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : 'WALLPAPER_ENGINE_PROJECT_DETAILS_FAILED' }
    }
  })

  ipcMain.handle('dsh-wallpaper-engine-open-project-details', async (event, payload: { id?: string; target?: string } = {}) => {
    if (!isTrustedSender(event)) return { ok: false, error: 'DESKTOP_UNTRUSTED_CALLER' }
    try {
      const details = await lib.getProjectDetails(payload.id ?? '')
      const workshopId = details.workshopId
      if (!/^\d{5,32}$/.test(workshopId)) return { ok: false, error: 'WALLPAPER_ENGINE_WORKSHOP_DETAILS_UNAVAILABLE' }
      const target = payload.target === 'workshop' ? 'workshop' : 'we'
      let revealError = ''
      if (target === 'we') {
        try {
          await rt.revealWorkshop(workshopId)
          return { ok: true, opened: 'wallpaper-engine', workshopId }
        } catch (error) {
          revealError = error instanceof Error ? error.message : 'WALLPAPER_ENGINE_REVEAL_FAILED'
        }
      }
      const steamUri = `steam://url/CommunityFilePage/${workshopId}`
      try {
        await shell.openExternal(steamUri)
        return { ok: true, opened: 'steam-workshop', workshopId, fallback: target === 'we', revealError }
      } catch {
        await shell.openExternal(`https://steamcommunity.com/sharedfiles/filedetails/?id=${workshopId}`)
        return { ok: true, opened: 'web-workshop', workshopId, fallback: target === 'we', revealError }
      }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : 'WALLPAPER_ENGINE_OPEN_PROJECT_DETAILS_FAILED' }
    }
  })

  ipcMain.handle('dsh-wallpaper-engine-choose-directory', async (event) => {
    if (!isTrustedSender(event)) return { ok: false, canceled: false, projects: [], count: 0, error: 'DESKTOP_UNTRUSTED_CALLER' }
    try {
      const options = { title: '识别并导入 Wallpaper Engine 项目', buttonLabel: '识别此目录', properties: ['openDirectory' as const] }
      const result = mainWindow !== null && !mainWindow.isDestroyed()
        ? await dialog.showOpenDialog(mainWindow, options)
        : await dialog.showOpenDialog(options)
      if (result.canceled || result.filePaths[0] === undefined) return { ok: true, canceled: true }
      const snapshot = await lib.addManualRoot(result.filePaths[0])
      return { ...snapshot, runtime: await rt.probe(false), canceled: false }
    } catch (error) {
      return { ok: false, canceled: false, projects: [], count: 0, error: error instanceof Error ? error.message : 'WALLPAPER_ENGINE_IMPORT_FAILED' }
    }
  })

  ipcMain.handle('dsh-wallpaper-engine-choose-project-file', async (event) => {
    if (!isTrustedSender(event)) return { ok: false, canceled: false, projects: [], count: 0, error: 'DESKTOP_UNTRUSTED_CALLER' }
    try {
      const options = {
        title: '选择 Wallpaper Engine 的 project.json 或场景包（.pkg/.pak）',
        buttonLabel: '导入此项目',
        properties: ['openFile' as const],
        filters: [{ name: 'Wallpaper Engine 项目', extensions: ['pkg', 'pak', 'json'] }],
      }
      const result = mainWindow !== null && !mainWindow.isDestroyed()
        ? await dialog.showOpenDialog(mainWindow, options)
        : await dialog.showOpenDialog(options)
      if (result.canceled || result.filePaths[0] === undefined) return { ok: true, canceled: true }
      const snapshot = await lib.addManualProjectFile(result.filePaths[0])
      return { ...snapshot, runtime: await rt.probe(false), canceled: false }
    } catch (error) {
      return { ok: false, canceled: false, projects: [], count: 0, error: error instanceof Error ? error.message : 'WALLPAPER_ENGINE_IMPORT_PROJECT_FAILED' }
    }
  })

  ipcMain.handle('dsh-wallpaper-engine-remove-directory', async (event, rootId: unknown) => {
    if (!isTrustedSender(event)) return { ok: false, projects: [], count: 0, error: 'DESKTOP_UNTRUSTED_CALLER' }
    try {
      const snapshot = await lib.removeManualRoot(stringArg(rootId))
      return { ...snapshot, runtime: await rt.probe(false) }
    } catch (error) {
      return { ok: false, projects: [], count: 0, error: error instanceof Error ? error.message : 'WALLPAPER_ENGINE_REMOVE_ROOT_FAILED' }
    }
  })

  ipcMain.handle('dsh-wallpaper-engine-runtime-status', async (event, payload: { force?: boolean } = {}) => {
    if (!isTrustedSender(event)) return { ok: false, available: false, error: 'DESKTOP_UNTRUSTED_CALLER' }
    try {
      const probe = await rt.probe(payload.force === true)
      return { ...probe, ...rt.getStatus() }
    } catch (error) {
      return { ok: false, available: false, error: error instanceof Error ? error.message : 'WALLPAPER_ENGINE_RUNTIME_PROBE_FAILED' }
    }
  })

  ipcMain.handle('dsh-wallpaper-engine-start-scene', async (event, payload: { id?: string; width?: number; height?: number; x?: number; y?: number; fps?: number } = {}) => {
    if (!isTrustedSender(event)) return { ok: false, error: 'DESKTOP_UNTRUSTED_CALLER' }
    try {
      const bounds = mainWindow?.getContentBounds() ?? { x: 0, y: 0, width: 1280, height: 720 }
      const startOptions: { width: number; height: number; x: number; y: number; fps?: number } = {
        width: payload.width ?? bounds.width,
        height: payload.height ?? bounds.height,
        x: payload.x ?? bounds.x,
        y: payload.y ?? bounds.y,
      }
      if (payload.fps !== undefined) startOptions.fps = payload.fps
      const status = await rt.start(payload.id ?? '', startOptions)
      return { ...status, capturePrepared: true, captureMode: 'desktop-capture' }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : 'WALLPAPER_ENGINE_SCENE_START_FAILED' }
    }
  })

  ipcMain.handle('dsh-wallpaper-engine-capture-result', async (event, payload: { sessionId?: string; ok?: boolean } = {}) => {
    if (!isTrustedSender(event)) return { ok: false, error: 'DESKTOP_UNTRUSTED_CALLER' }
    const sessionId = payload.sessionId ?? ''
    if (!/^[a-f0-9]{24}$/i.test(sessionId)) return { ok: false, error: 'WALLPAPER_ENGINE_SESSION_INVALID' }
    const confirmed = payload.ok === true && await rt.confirmCaptureReady(sessionId)
    if (!confirmed) await rt.stop(sessionId)
    return { ok: confirmed, captureReady: confirmed, error: confirmed ? '' : 'WALLPAPER_ENGINE_CAPTURE_CONFIRM_FAILED' }
  })

  ipcMain.handle('dsh-wallpaper-engine-stop-scene', async (event, payload: { sessionId?: string; all?: boolean } = {}) => {
    if (!isTrustedSender(event)) return { ok: false, error: 'DESKTOP_UNTRUSTED_CALLER' }
    try {
      return await rt.stop(payload.all === true || payload.sessionId === undefined ? '' : payload.sessionId)
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : 'WALLPAPER_ENGINE_SCENE_STOP_FAILED' }
    }
  })
}

function registerDesktopModeIpc(): void {
  if (desktopWallpaper === null || desktopMode === null) throw new Error('desktop: desktop-mode services not initialized')
  const wallpaper = desktopWallpaper
  const mode = desktopMode

  ipcMain.handle('dsh-desktop-wallpaper-get-status', (event) => {
    if (!isTrustedSender(event)) return failUntrusted()
    return wallpaper.getStatus()
  })

  ipcMain.handle('dsh-desktop-wallpaper-set-enabled', async (event, payload: { enabled?: boolean; url?: string; kind?: string } = {}) => {
    if (!isTrustedSender(event)) return failUntrusted()
    try {
      const enabled = payload.enabled === true
      if (!enabled) return await wallpaper.stop()
      const url = typeof payload.url === 'string' ? payload.url : ''
      if (url === '') return { ok: false, error: 'DSH_DESKTOP_WALLPAPER_URL_REQUIRED' }
      return await wallpaper.start(url, payload.kind === 'video' ? 'video' : 'image')
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : 'DSH_DESKTOP_WALLPAPER_START_FAILED' }
    }
  })

  ipcMain.handle('dsh-desktop-wallpaper-update', async (event, payload: { url?: string; kind?: string } = {}) => {
    if (!isTrustedSender(event)) return failUntrusted()
    const url = typeof payload.url === 'string' ? payload.url : ''
    if (url === '') return { ok: false, error: 'DSH_DESKTOP_WALLPAPER_URL_REQUIRED' }
    return await wallpaper.update(url, payload.kind === 'video' ? 'video' : 'image')
  })

  ipcMain.handle('dsh-desktop-mode-get-status', (event) => {
    if (!isTrustedSender(event)) return failUntrusted()
    return mode.getStatus()
  })

  ipcMain.handle('dsh-desktop-mode-set-enabled', async (event, payload: { enabled?: boolean; interactive?: boolean } = {}) => {
    if (!isTrustedSender(event)) return failUntrusted()
    const win = mainWindow
    if (win === null || win.isDestroyed()) return { ok: false, error: 'DSH_DESKTOP_WINDOW_UNAVAILABLE' }
    if (payload.enabled !== true) return await mode.disable('renderer-disabled')
    return await mode.enable(win, { interactive: payload.interactive !== false, reason: 'renderer-enabled' })
  })

  ipcMain.handle('dsh-desktop-mode-set-icons-visible', async (event, visible: unknown) => {
    if (!isTrustedSender(event)) return failUntrusted()
    return await mode.setDesktopIconsVisible(visible !== false)
  })

  ipcMain.handle('dsh-desktop-mode-probe-icons', async (event) => {
    if (!isTrustedSender(event)) return failUntrusted()
    return await mode.probeDesktopIcons()
  })

  ipcMain.handle('dsh-desktop-mode-set-software-lock', (event, locked: unknown) => {
    if (!isTrustedSender(event)) return failUntrusted()
    return mode.setSoftwareInteractionLocked(locked === true)
  })

  ipcMain.handle('dsh-desktop-mode-request-keyboard-focus', (event) => {
    if (!isTrustedSender(event)) return failUntrusted()
    return mode.requestKeyboardFocus()
  })

  ipcMain.on('dsh-desktop-mode-pointer-route', (event, payload: { overSoftwareUi?: boolean; overDesktopControls?: boolean } = {}) => {
    if (!isTrustedSender(event)) return
    mode.updatePointerRoute(payload)
  })

  mode.onStatus((status) => {
    if (mainWindow !== null && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('dsh-desktop-mode-state', status)
    }
  })
}

async function runDesktopModeSmoke(): Promise<void> {
  const marker = process.env.DSH_DESKTOP_SMOKE_FILE
  const result: Record<string, unknown> = {}
  try {
    if (desktopMode === null) throw new Error('DSH_DESKTOP_MODE_UNAVAILABLE')
    result.iconProbe = await desktopMode.probeDesktopIcons()
    const testWindow = new BrowserWindow({ width: 640, height: 360, show: false })
    try {
      await testWindow.loadURL('data:text/html,<body style="background:%23000">dsh desktop mode smoke</body>')
      if (desktopWallpaper === null) throw new Error('DSH_DESKTOP_WALLPAPER_UNAVAILABLE')
      result.wallpaperStart = await desktopWallpaper.start(
        'data:image/svg+xml;charset=utf-8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16" fill="black"/></svg>'),
        'image',
      )
      result.wallpaperStop = await desktopWallpaper.stop()
    } finally {
      if (!testWindow.isDestroyed()) testWindow.destroy()
    }
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error)
  }
  if (marker !== undefined) writeFileSync(marker, JSON.stringify(result))
  app.quit()
}

function registerInstallerIpc(): void {
  const isInstallerSender = (event: IpcMainInvokeEvent): boolean =>
    installerWindow !== null && !installerWindow.isDestroyed() && event.sender === installerWindow.webContents

  ipcMain.handle('dsh-install-start', async (event) => {
    if (!isInstallerSender(event)) return { ok: false, error: 'DESKTOP_INSTALLER_UNTRUSTED' }
    if (installCancelRequested) return { ok: false, error: 'DESKTOP_INSTALL_CANCELLED' }
    const command = await runDshInstall()
    if (command === '') return { ok: false, error: 'DESKTOP_INSTALL_FAILED' }
    await startDshWeb(command)
    if (installerWindow !== null && !installerWindow.isDestroyed()) installerWindow.close()
    createMainWindow()
    return { ok: true }
  })

  ipcMain.handle('dsh-install-open-help', (event) => {
    if (!isInstallerSender(event)) return { ok: false }
    void shell.openExternal('https://deepseek-harness.github.io/deepseek-harness/')
    return { ok: true }
  })

  ipcMain.handle('dsh-install-cancel', (event) => {
    if (!isInstallerSender(event)) return { ok: false }
    installCancelRequested = true
    app.quit()
    return { ok: true }
  })
}

void app.whenReady().then(async () => {
  Menu.setApplicationMenu(null)
  const lib = new WallpaperEngineLibrary({ configPath: dshHomePath('wallpaper-engine-library.json') })
  library = lib
  runtime = new WallpaperEngineRuntime({
    library: lib,
    desktopCapturer,
    spawn,
  })
  desktopWallpaper = new DesktopWallpaperRuntime({ BrowserWindow, screen })
  desktopMode = new DesktopModeRuntime({ screen })
  if (process.env.DSH_DESKTOP_M5_SMOKE === '1') {
    void runDesktopModeSmoke()
    return
  }
  protocol.handle(WALLPAPER_ENGINE_SCHEME, request => lib.mediaResponse({
    url: request.url,
    method: request.method,
    headers: request.headers,
  }))
  registerWindowIpc()
  registerWallpaperIpc()
  registerDesktopModeIpc()
  registerInstallerIpc()
  const dshCommand = await ensureDshWebRunning()
  if (dshCommand === '') return
  createMainWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  if (desktopMode !== null) void desktopMode.dispose()
  if (desktopWallpaper !== null) void desktopWallpaper.dispose()
  if (runtime !== null) void runtime.dispose()
  if (library !== null) library.dispose()
})
