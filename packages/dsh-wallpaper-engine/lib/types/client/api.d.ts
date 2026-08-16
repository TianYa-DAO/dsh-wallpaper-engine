/**
 * Desktop-bridge types and detection. The actual implementation is injected
 * by the Electron preload as `window.desktopWindow`; web builds without the
 * bridge keep working and show the "desktop only" hint.
 */
/** One library item as returned by the desktop main process. */
export interface WallpaperProjectItem {
    id: string;
    title: string;
    projectType: string;
    mediaType: 'video' | 'image' | '';
    mediaAnimated: boolean;
    playable: boolean;
    enginePlayable: boolean;
    previewOnly: boolean;
    hasPreview: boolean;
    previewAnimated: boolean;
    source: 'workshop' | 'local' | 'imported';
    sourceLabel: string;
    workshopId: string;
    propertyCount: number;
    audioPropertyCount: number;
    mutedAudioPropertyCount: number;
    updatedAt: number;
    safetyMode: 'direct-media' | 'native-engine' | 'preview-only';
}
export interface WallpaperLibrarySnapshot {
    ok: boolean;
    projects: WallpaperProjectItem[];
    count: number;
    dynamicCount: number;
    enginePlayableCount: number;
    previewOnlyCount: number;
    sourceCount: number;
    manualRoots: Array<{
        id: string;
        name: string;
    }>;
    scannedAt: number;
    elapsedMs: number;
    mediaToken: string;
    runtime?: WallpaperRuntimeProbe;
}
export interface WallpaperRuntimeProbe {
    ok: boolean;
    available: boolean;
    executable?: string;
    reason?: string;
}
export interface WallpaperSceneStartResult {
    ok: boolean;
    active?: boolean;
    sessionId?: string;
    sourceId?: string;
    width?: number;
    height?: number;
    fps?: number;
    error?: string;
}
/** The bridge surface exposed by the DSH desktop preload. */
export interface DesktopWindowApi {
    isDesktop: boolean;
    ping(): Promise<unknown>;
    getVersion(): Promise<unknown>;
    minimize(): Promise<unknown>;
    restore(): Promise<unknown>;
    toggleMaximize(): Promise<unknown>;
    toggleFullscreen(): Promise<unknown>;
    getState(): Promise<unknown>;
    close(): Promise<unknown>;
    listWallpaperEngineProjects(payload?: {
        force?: boolean;
    }): Promise<WallpaperLibrarySnapshot>;
    getWallpaperEngineProjectDetails(id: string): Promise<unknown>;
    openWallpaperEngineProjectDetails(id: string, target: 'we' | 'workshop'): Promise<unknown>;
    chooseWallpaperEngineDirectory(): Promise<WallpaperLibrarySnapshot & {
        canceled?: boolean;
        error?: string;
    }>;
    chooseWallpaperEngineProjectFile(): Promise<WallpaperLibrarySnapshot & {
        canceled?: boolean;
        error?: string;
    }>;
    removeWallpaperEngineDirectory(rootId: string): Promise<WallpaperLibrarySnapshot>;
    getWallpaperEngineRuntimeStatus(payload?: {
        force?: boolean;
    }): Promise<WallpaperRuntimeProbe & {
        active: boolean;
        sessionId: string;
        sourceId: string;
    }>;
    startWallpaperEngineScene(payload: {
        id: string;
        width?: number;
        height?: number;
        x?: number;
        y?: number;
        fps?: number;
    }): Promise<WallpaperSceneStartResult>;
    reportWallpaperEngineCaptureResult(payload: {
        sessionId: string;
        ok: boolean;
    }): Promise<{
        ok: boolean;
        captureReady: boolean;
    }>;
    stopWallpaperEngineScene(payload?: {
        sessionId?: string;
        all?: boolean;
    }): Promise<{
        ok: boolean;
        stopped?: boolean;
    }>;
    onWallpaperEngineHostBoundsChanged(callback: (payload: HostBoundsPayload) => void): () => void;
    onStateChange(callback: (payload: unknown) => void): () => void;
}
export interface HostBoundsPayload {
    x: number;
    y: number;
    width: number;
    height: number;
    suspended: boolean;
}
/** Read the optional bridge once and cache the verdict. */
export declare function getDesktopWindowApi(): DesktopWindowApi | null;
/** Build a `dsh-wallpaper://` media URL for an indexed project. */
export declare function wallpaperMediaUrl(kind: 'media' | 'preview', item: WallpaperProjectItem | null, token: string): string;
declare global {
    interface Window {
        desktopWindow?: DesktopWindowApi;
    }
}
//# sourceMappingURL=api.d.ts.map