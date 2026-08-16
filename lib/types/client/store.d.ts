/**
 * Shared viewing/interaction state for the wallpaper UI: library snapshot,
 * active selection, and the native-scene capture session. Business data
 * (which files exist on disk, what WE is doing) stays in the desktop main
 * process; this store only mirrors the renderer-visible projection.
 */
import { type EngineStoreHandle } from '@deepseek-ai/dsh-client-runtime/client';
import type { WallpaperProjectItem } from './api.ts';
import { type WallpaperSelection } from './selection.ts';
export type WallpaperLibraryStatus = 'idle' | 'loading' | 'ready' | 'error';
export interface WallpaperSceneState {
    active: boolean;
    sessionId: string;
    sourceId: string;
    error: string;
    freeze: boolean;
}
export interface WallpaperEngineState {
    status: WallpaperLibraryStatus;
    projects: WallpaperProjectItem[];
    manualRoots: Array<{
        id: string;
        name: string;
    }>;
    mediaToken: string;
    runtimeAvailable: boolean;
    search: string;
    selection: WallpaperSelection;
    scene: WallpaperSceneState;
    error: string;
}
export type WallpaperEngineActions = {
    setLoading: (draft: WallpaperEngineState) => void;
    setReady: (draft: WallpaperEngineState, projects: WallpaperProjectItem[], manualRoots: Array<{
        id: string;
        name: string;
    }>, mediaToken: string, runtimeAvailable: boolean) => void;
    setError: (draft: WallpaperEngineState, message: string) => void;
    setSearch: (draft: WallpaperEngineState, search: string) => void;
    setSelection: (draft: WallpaperEngineState, selection: WallpaperSelection) => void;
    setScene: (draft: WallpaperEngineState, scene: Partial<WallpaperSceneState>) => void;
    clearSceneError: (draft: WallpaperEngineState) => void;
};
/**
 * Create the wallpaper UI store handle. The handle is constructed in apply
 * world and shared by the settings-section entry and the background entry, so
 * both read and write the same instance.
 * @returns the shared store handle.
 */
export declare function createWallpaperEngineStore(): EngineStoreHandle<WallpaperEngineState, WallpaperEngineActions>;
//# sourceMappingURL=store.d.ts.map