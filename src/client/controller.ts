/**
 * Apply-world controller: owns the shared store instance and the desktop
 * bridge. Components receive this controller through their inject face and
 * call its methods; every bridge result is projected into the shared store.
 */

import type { SnapshotSelectorHook } from '@deepseek-ai/dsh-client-ui-slots'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-web-react'
import { wallpaperMediaUrl, type DesktopWindowApi, type WallpaperProjectItem, type WallpaperSceneStartResult } from './api.ts'
import { createWallpaperEngineStore, type WallpaperEngineState } from './store.ts'
import { emptyWallpaperSelection, type WallpaperSelection, type WallpaperSelectionKind } from './selection.ts'

export class WallpaperEngineController {
  readonly store = createWallpaperEngineStore().create()
  private readonly api: DesktopWindowApi | null

  constructor(api: DesktopWindowApi | null) {
    this.api = api
  }

  get isDesktop(): boolean {
    return this.api !== null
  }

  get snapshot(): WallpaperEngineState {
    return this.store.getSnapshot()
  }

  /** Refresh the library snapshot from the desktop main process. */
  async load(force = false): Promise<void> {
    if (this.api === null) {
      this.store.actions.setError('DESKTOP_ONLY')
      return
    }
    this.store.actions.setLoading()
    try {
      const snapshot = await this.api.listWallpaperEngineProjects({ force })
      if (snapshot.ok) {
        this.store.actions.setReady(
          snapshot.projects,
          snapshot.manualRoots,
          snapshot.mediaToken,
          snapshot.runtime?.available === true,
        )
      } else {
        this.store.actions.setError('WALLPAPER_ENGINE_SCAN_FAILED')
      }
    } catch {
      this.store.actions.setError('WALLPAPER_ENGINE_SCAN_FAILED')
    }
  }

  /** Choose and import a directory, then refresh. */
  async chooseDirectory(): Promise<void> {
    if (this.api === null) return
    this.store.actions.setLoading()
    try {
      const snapshot = await this.api.chooseWallpaperEngineDirectory()
      if (snapshot.canceled === true) {
        void this.load()
        return
      }
      if (snapshot.ok) {
        this.store.actions.setReady(
          snapshot.projects,
          snapshot.manualRoots,
          snapshot.mediaToken,
          snapshot.runtime?.available === true,
        )
      } else {
        this.store.actions.setError(snapshot.error ?? 'WALLPAPER_ENGINE_IMPORT_FAILED')
      }
    } catch {
      this.store.actions.setError('WALLPAPER_ENGINE_IMPORT_FAILED')
    }
  }

  /** Choose and import a project.json or scene package, then refresh. */
  async chooseProjectFile(): Promise<void> {
    if (this.api === null) return
    this.store.actions.setLoading()
    try {
      const snapshot = await this.api.chooseWallpaperEngineProjectFile()
      if (snapshot.canceled === true) {
        void this.load()
        return
      }
      if (snapshot.ok) {
        this.store.actions.setReady(
          snapshot.projects,
          snapshot.manualRoots,
          snapshot.mediaToken,
          snapshot.runtime?.available === true,
        )
      } else {
        this.store.actions.setError(snapshot.error ?? 'WALLPAPER_ENGINE_IMPORT_PROJECT_FAILED')
      }
    } catch {
      this.store.actions.setError('WALLPAPER_ENGINE_IMPORT_PROJECT_FAILED')
    }
  }

  /** Remove a manual root and refresh. */
  async removeRoot(rootId: string): Promise<void> {
    if (this.api === null) return
    this.store.actions.setLoading()
    try {
      const snapshot = await this.api.removeWallpaperEngineDirectory(rootId)
      if (snapshot.ok) {
        this.store.actions.setReady(
          snapshot.projects,
          snapshot.manualRoots,
          snapshot.mediaToken,
          snapshot.runtime?.available === true,
        )
      } else {
        this.store.actions.setError('WALLPAPER_ENGINE_REMOVE_ROOT_FAILED')
      }
    } catch {
      this.store.actions.setError('WALLPAPER_ENGINE_REMOVE_ROOT_FAILED')
    }
  }

  /** Build the best selection for a project item. */
  selectProject(project: WallpaperProjectItem): WallpaperSelection {
    const kind: WallpaperSelectionKind = project.enginePlayable ? 'engine' : (project.playable ? 'media' : 'preview')
    const selection: WallpaperSelection = {
      ...emptyWallpaperSelection(),
      active: true,
      id: project.id,
      title: project.title,
      kind,
      mediaType: project.mediaType === 'video' ? 'video' : 'image',
      mediaAnimated: project.mediaAnimated,
      projectType: project.projectType,
      hasPreview: project.hasPreview,
      previewAnimated: project.previewAnimated,
      updatedAt: project.updatedAt,
    }
    this.store.actions.setSelection(selection)
    return selection
  }

  /** Restore the default app background. */
  clearSelection(): void {
    this.store.actions.setSelection(emptyWallpaperSelection())
  }

  /** Start a WE native scene through the main process. */
  async startScene(projectId: string): Promise<WallpaperSceneStartResult> {
    if (this.api === null) return { ok: false, error: 'DESKTOP_ONLY' }
    const result = await this.api.startWallpaperEngineScene({ id: projectId })
    if (result.ok && result.sessionId !== undefined) {
      this.store.actions.setScene({
        active: true,
        sessionId: result.sessionId,
        sourceId: result.sourceId ?? '',
        error: '',
      })
    } else {
      this.store.actions.setScene({ active: false, sessionId: '', sourceId: '', error: result.error ?? 'WALLPAPER_ENGINE_SCENE_START_FAILED' })
    }
    return result
  }

  /** Report the renderer's first-frame capture ACK to the main process. */
  async reportCapture(sessionId: string, ok: boolean): Promise<void> {
    if (this.api === null) return
    try {
      await this.api.reportWallpaperEngineCaptureResult({ sessionId, ok })
    } catch {
      // The main process stops the scene on a failed ACK; nothing else to do here.
    }
    if (!ok) this.store.actions.setScene({ active: false, sessionId: '', sourceId: '', error: 'WALLPAPER_ENGINE_CAPTURE_CONFIRM_FAILED' })
  }

  /** Stop the active native scene. */
  async stopScene(): Promise<void> {
    const { scene } = this.store.getSnapshot()
    if (this.api !== null) {
      try {
        await this.api.stopWallpaperEngineScene({ sessionId: scene.sessionId })
      } catch {
        // The WE window may already be gone; local state still resets below.
      }
    }
    this.store.actions.setScene({ active: false, sessionId: '', sourceId: '', error: '', freeze: false })
  }

  /** Compute the current wallpaper URL for the WorkerW desktop window. */
  private desktopWallpaperPayload(): { url: string; kind: 'image' | 'video' } {
    const state = this.store.getSnapshot()
    const project = state.projects.find(item => item.id === state.selection.id) ?? null
    const kind = state.selection.mediaType === 'video' ? 'video' as const : 'image' as const
    const url = wallpaperMediaUrl(project?.playable === true ? 'media' : 'preview', project, state.mediaToken)
    return { url, kind }
  }

  /** Get the WorkerW wallpaper-window status. */
  async getWallpaperModeStatus(): Promise<unknown> {
    return this.api === null ? { ok: false, supported: false, enabled: false } : this.api.getWallpaperModeStatus()
  }

  /** Enable or disable the WorkerW wallpaper window. */
  async setWallpaperMode(enabled: boolean): Promise<unknown> {
    if (this.api === null) return { ok: false, enabled: false }
    if (enabled) {
      const payload = this.desktopWallpaperPayload()
      if (payload.url === '') return { ok: false, enabled: false, error: 'WALLPAPER_SELECTION_REQUIRED' }
      return this.api.setWallpaperMode({ enabled: true, ...payload })
    }
    return this.api.setWallpaperMode({ enabled: false })
  }

  /** Get the full-desktop embed status. */
  async getDesktopModeStatus(): Promise<unknown> {
    return this.api === null ? { ok: false, supported: false, enabled: false } : this.api.getDesktopModeStatus()
  }

  /** Embed the main window into the desktop icon host. */
  async setDesktopMode(enabled: boolean, interactive = true): Promise<unknown> {
    if (this.api === null) return { ok: false, enabled: false }
    return this.api.setDesktopMode({ enabled, interactive })
  }

  async setDesktopIconsVisible(visible: boolean): Promise<unknown> {
    return this.api === null ? { ok: false } : this.api.setDesktopIconsVisible(visible)
  }

  async probeDesktopIcons(): Promise<unknown> {
    return this.api === null ? { ok: false, found: false } : this.api.probeDesktopIcons()
  }

  async setDesktopSoftwareLocked(locked: boolean): Promise<unknown> {
    return this.api === null ? { ok: false } : this.api.setDesktopSoftwareLocked(locked)
  }

  requestDesktopKeyboardFocus(): Promise<unknown> {
    return this.api === null
      ? Promise.resolve({ ok: false })
      : this.api.requestDesktopKeyboardFocus()
  }

  /** Open the WE/Steam workshop page for one project. */
  async openProjectDetails(project: WallpaperProjectItem): Promise<void> {
    if (this.api === null || project.workshopId === '') return
    await this.api.openWallpaperEngineProjectDetails(project.id, project.source === 'workshop' ? 'workshop' : 'we')
  }
}

/** Bind a snapshot selector hook to the shared store (apply-world only). */
export function bindWallpaperSnapshot(controller: WallpaperEngineController): SnapshotSelectorHook<WallpaperEngineState> {
  return bindSnapshotSelector(controller.store)
}
