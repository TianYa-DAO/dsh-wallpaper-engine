/**
 * Apply-world controller: owns the shared store instance and the desktop
 * bridge. Components receive this controller through their inject face and
 * call its methods; every bridge result is projected into the shared store.
 */
import type { SnapshotSelectorHook } from '@deepseek-ai/dsh-client-ui-slots';
import type { DesktopWindowApi, WallpaperProjectItem, WallpaperSceneStartResult } from './api.ts';
import { type WallpaperEngineState } from './store.ts';
import { type WallpaperSelection } from './selection.ts';
export declare class WallpaperEngineController {
    readonly store: import("@deepseek-ai/dsh-client-runtime/client").EngineStoreInstance<WallpaperEngineState, import("./store.ts").WallpaperEngineActions>;
    private readonly api;
    constructor(api: DesktopWindowApi | null);
    get isDesktop(): boolean;
    get snapshot(): WallpaperEngineState;
    /** Refresh the library snapshot from the desktop main process. */
    load(force?: boolean): Promise<void>;
    /** Choose and import a directory, then refresh. */
    chooseDirectory(): Promise<void>;
    /** Choose and import a project.json or scene package, then refresh. */
    chooseProjectFile(): Promise<void>;
    /** Remove a manual root and refresh. */
    removeRoot(rootId: string): Promise<void>;
    /** Build the best selection for a project item. */
    selectProject(project: WallpaperProjectItem): WallpaperSelection;
    /** Restore the default app background. */
    clearSelection(): void;
    /** Start a WE native scene through the main process. */
    startScene(projectId: string): Promise<WallpaperSceneStartResult>;
    /** Report the renderer's first-frame capture ACK to the main process. */
    reportCapture(sessionId: string, ok: boolean): Promise<void>;
    /** Stop the active native scene. */
    stopScene(): Promise<void>;
    /** Open the WE/Steam workshop page for one project. */
    openProjectDetails(project: WallpaperProjectItem): Promise<void>;
}
/** Bind a snapshot selector hook to the shared store (apply-world only). */
export declare function bindWallpaperSnapshot(controller: WallpaperEngineController): SnapshotSelectorHook<WallpaperEngineState>;
//# sourceMappingURL=controller.d.ts.map