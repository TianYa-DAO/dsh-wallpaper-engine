/**
 * Apply-world controller: owns the shared store instance and the desktop
 * bridge. Components receive this controller through their inject face and
 * call its methods; every bridge result is projected into the shared store.
 */
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-web-react';
import { createWallpaperEngineStore } from "./store.js";
import { emptyWallpaperSelection } from "./selection.js";
export class WallpaperEngineController {
    store = createWallpaperEngineStore().create();
    api;
    constructor(api) {
        this.api = api;
    }
    get isDesktop() {
        return this.api !== null;
    }
    get snapshot() {
        return this.store.getSnapshot();
    }
    /** Refresh the library snapshot from the desktop main process. */
    async load(force = false) {
        if (this.api === null) {
            this.store.actions.setError('DESKTOP_ONLY');
            return;
        }
        this.store.actions.setLoading();
        try {
            const snapshot = await this.api.listWallpaperEngineProjects({ force });
            if (snapshot.ok) {
                this.store.actions.setReady(snapshot.projects, snapshot.manualRoots, snapshot.mediaToken, snapshot.runtime?.available === true);
            }
            else {
                this.store.actions.setError('WALLPAPER_ENGINE_SCAN_FAILED');
            }
        }
        catch {
            this.store.actions.setError('WALLPAPER_ENGINE_SCAN_FAILED');
        }
    }
    /** Choose and import a directory, then refresh. */
    async chooseDirectory() {
        if (this.api === null)
            return;
        this.store.actions.setLoading();
        try {
            const snapshot = await this.api.chooseWallpaperEngineDirectory();
            if (snapshot.canceled === true) {
                void this.load();
                return;
            }
            if (snapshot.ok) {
                this.store.actions.setReady(snapshot.projects, snapshot.manualRoots, snapshot.mediaToken, snapshot.runtime?.available === true);
            }
            else {
                this.store.actions.setError(snapshot.error ?? 'WALLPAPER_ENGINE_IMPORT_FAILED');
            }
        }
        catch {
            this.store.actions.setError('WALLPAPER_ENGINE_IMPORT_FAILED');
        }
    }
    /** Choose and import a project.json or scene package, then refresh. */
    async chooseProjectFile() {
        if (this.api === null)
            return;
        this.store.actions.setLoading();
        try {
            const snapshot = await this.api.chooseWallpaperEngineProjectFile();
            if (snapshot.canceled === true) {
                void this.load();
                return;
            }
            if (snapshot.ok) {
                this.store.actions.setReady(snapshot.projects, snapshot.manualRoots, snapshot.mediaToken, snapshot.runtime?.available === true);
            }
            else {
                this.store.actions.setError(snapshot.error ?? 'WALLPAPER_ENGINE_IMPORT_PROJECT_FAILED');
            }
        }
        catch {
            this.store.actions.setError('WALLPAPER_ENGINE_IMPORT_PROJECT_FAILED');
        }
    }
    /** Remove a manual root and refresh. */
    async removeRoot(rootId) {
        if (this.api === null)
            return;
        this.store.actions.setLoading();
        try {
            const snapshot = await this.api.removeWallpaperEngineDirectory(rootId);
            if (snapshot.ok) {
                this.store.actions.setReady(snapshot.projects, snapshot.manualRoots, snapshot.mediaToken, snapshot.runtime?.available === true);
            }
            else {
                this.store.actions.setError('WALLPAPER_ENGINE_REMOVE_ROOT_FAILED');
            }
        }
        catch {
            this.store.actions.setError('WALLPAPER_ENGINE_REMOVE_ROOT_FAILED');
        }
    }
    /** Build the best selection for a project item. */
    selectProject(project) {
        const kind = project.enginePlayable ? 'engine' : (project.playable ? 'media' : 'preview');
        const selection = {
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
        };
        this.store.actions.setSelection(selection);
        return selection;
    }
    /** Restore the default app background. */
    clearSelection() {
        this.store.actions.setSelection(emptyWallpaperSelection());
    }
    /** Start a WE native scene through the main process. */
    async startScene(projectId) {
        if (this.api === null)
            return { ok: false, error: 'DESKTOP_ONLY' };
        const result = await this.api.startWallpaperEngineScene({ id: projectId });
        if (result.ok && result.sessionId !== undefined) {
            this.store.actions.setScene({
                active: true,
                sessionId: result.sessionId,
                sourceId: result.sourceId ?? '',
                error: '',
            });
        }
        else {
            this.store.actions.setScene({ active: false, sessionId: '', sourceId: '', error: result.error ?? 'WALLPAPER_ENGINE_SCENE_START_FAILED' });
        }
        return result;
    }
    /** Report the renderer's first-frame capture ACK to the main process. */
    async reportCapture(sessionId, ok) {
        if (this.api === null)
            return;
        try {
            await this.api.reportWallpaperEngineCaptureResult({ sessionId, ok });
        }
        catch {
            // The main process stops the scene on a failed ACK; nothing else to do here.
        }
        if (!ok)
            this.store.actions.setScene({ active: false, sessionId: '', sourceId: '', error: 'WALLPAPER_ENGINE_CAPTURE_CONFIRM_FAILED' });
    }
    /** Stop the active native scene. */
    async stopScene() {
        const { scene } = this.store.getSnapshot();
        if (this.api !== null) {
            try {
                await this.api.stopWallpaperEngineScene({ sessionId: scene.sessionId });
            }
            catch {
                // The WE window may already be gone; local state still resets below.
            }
        }
        this.store.actions.setScene({ active: false, sessionId: '', sourceId: '', error: '', freeze: false });
    }
    /** Open the WE/Steam workshop page for one project. */
    async openProjectDetails(project) {
        if (this.api === null || project.workshopId === '')
            return;
        await this.api.openWallpaperEngineProjectDetails(project.id, project.source === 'workshop' ? 'workshop' : 'we');
    }
}
/** Bind a snapshot selector hook to the shared store (apply-world only). */
export function bindWallpaperSnapshot(controller) {
    return bindSnapshotSelector(controller.store);
}
//# sourceMappingURL=controller.js.map