/**
 * Shared viewing/interaction state for the wallpaper UI: library snapshot,
 * active selection, and the native-scene capture session. Business data
 * (which files exist on disk, what WE is doing) stays in the desktop main
 * process; this store only mirrors the renderer-visible projection.
 */
import { defineStore } from '@deepseek-ai/dsh-client-runtime/client';
import { readWallpaperSelection, writeWallpaperSelection } from "./selection.js";
/**
 * Create the wallpaper UI store handle. The handle is constructed in apply
 * world and shared by the settings-section entry and the background entry, so
 * both read and write the same instance.
 * @returns the shared store handle.
 */
export function createWallpaperEngineStore() {
    return defineStore({
        init: () => ({
            status: 'idle',
            projects: [],
            manualRoots: [],
            mediaToken: '',
            runtimeAvailable: false,
            search: '',
            selection: readWallpaperSelection(),
            scene: { active: false, sessionId: '', sourceId: '', error: '', freeze: false },
            error: '',
        }),
        actions: {
            setLoading: (d) => {
                d.status = 'loading';
                d.error = '';
            },
            setReady: (d, projects, manualRoots, mediaToken, runtimeAvailable) => {
                d.status = 'ready';
                d.projects = projects;
                d.manualRoots = manualRoots;
                d.mediaToken = mediaToken;
                d.runtimeAvailable = runtimeAvailable;
                d.error = '';
            },
            setError: (d, message) => {
                d.status = 'error';
                d.error = message;
            },
            setSearch: (d, search) => {
                d.search = search;
            },
            setSelection: (d, selection) => {
                d.selection = selection;
                writeWallpaperSelection(selection);
            },
            setScene: (d, scene) => {
                d.scene = { ...d.scene, ...scene };
            },
            clearSceneError: (d) => {
                d.scene.error = '';
            },
        },
    });
}
//# sourceMappingURL=store.js.map